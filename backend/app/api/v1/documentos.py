"""Contratos de cada vendedor en la unidad compartida de RH (ver services/carpetas.py).

Los archivos se leen en vivo de `Vendedores\\<NOMBRE>\\Contratos`; la base solo recuerda el nombre de la
carpeta de cada vendedor. Son datos personales: solo admin, DH y Analista DH, siempre a través de la API
(con sesión), nunca por un enlace directo al archivo.
"""
import difflib
import logging
import shutil
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import puede_escribir, requiere
from app.core.config import settings
from app.core.database import get_db
from app.models import Vendedor
from app.services import carpetas

router = APIRouter(tags=["documentos"], dependencies=[Depends(puede_escribir)])
log = logging.getLogger("rh.documentos")


class ArchivoOut(BaseModel):
    nombre: str
    tamano: int
    tipo: str
    modificado: datetime


class DocumentosVendedor(BaseModel):
    configurada: bool
    disponible: bool  # la unidad compartida responde
    existe_carpeta: bool
    carpeta: str | None = None  # nombre de la carpeta del vendedor
    ruta: str | None = None  # ruta tal como la ve RH
    archivos: list[ArchivoOut] = []
    aviso: str | None = None


class EstadoCarpetas(BaseModel):
    configurada: bool
    accesible: bool
    escribible: bool
    mensaje: str | None = None
    ruta: str | None = None
    vendedores: int = 0
    con_carpeta: int = 0
    sin_carpeta: int = 0


class SinVendedor(BaseModel):
    carpeta: str
    sugerencias: list[dict]  # [{id, nombre, similitud}]


class SinCarpeta(BaseModel):
    id: int
    codigo: str
    nombre: str
    vigente: bool


class Revision(BaseModel):
    sin_vendedor: list[SinVendedor]
    sin_carpeta: list[SinCarpeta]


class ResultadoCrear(BaseModel):
    vinculadas: int
    creadas: int
    errores: list[str]


class Vincular(BaseModel):
    vendedor_id: int
    carpeta: str


def _vendedor(db: Session, vendedor_id: int) -> Vendedor:
    v = db.get(Vendedor, vendedor_id)
    if not v:
        raise HTTPException(404, "Vendedor no encontrado")
    return v


def _escribible(base: Path) -> bool:
    try:
        prueba = base / ".prueba_escritura"
        prueba.write_text("ok")
        prueba.unlink()
        return True
    except OSError:
        return False


# ── Por vendedor ─────────────────────────────────────────────────────────────

@router.get("/vendedores/{vendedor_id}/documentos", response_model=DocumentosVendedor)
def listar(vendedor_id: int, categoria: str = "contratos", db: Session = Depends(get_db)):
    v = _vendedor(db, vendedor_id)
    carpetas.categoria(categoria)
    if not carpetas.configurada():
        return DocumentosVendedor(configurada=False, disponible=False, existe_carpeta=False,
                                  aviso="La carpeta de contratos aún no está configurada en el servidor.")
    try:
        ruta = carpetas.ruta_contratos(db, v, clave=categoria)
    except HTTPException as e:
        return DocumentosVendedor(configurada=True, disponible=False, existe_carpeta=False, aviso=str(e.detail))
    db.commit()  # por si se vinculó sola una carpeta que ya existía
    return DocumentosVendedor(
        configurada=True, disponible=True, existe_carpeta=ruta is not None,
        carpeta=v.carpeta_contratos, ruta=carpetas.ruta_red(v.carpeta_contratos, categoria) if v.carpeta_contratos else None,
        archivos=[ArchivoOut(**a) for a in carpetas.listar(ruta)],
    )


@router.post("/vendedores/{vendedor_id}/documentos/carpeta", response_model=DocumentosVendedor, status_code=201)
def crear_carpeta(vendedor_id: int, categoria: str = "contratos", db: Session = Depends(get_db)):
    v = _vendedor(db, vendedor_id)
    carpetas.categoria(categoria)
    for clave in carpetas.CATEGORIAS:
        carpetas.ruta_contratos(db, v, crear=True, clave=clave)
    db.commit()
    return listar(vendedor_id, categoria, db)


@router.post("/vendedores/{vendedor_id}/documentos", response_model=ArchivoOut, status_code=201)
async def subir(vendedor_id: int, categoria: str = "contratos", archivo: UploadFile = File(...), db: Session = Depends(get_db)):
    v = _vendedor(db, vendedor_id)
    limite = settings.CONTRATOS_MAX_MB * 1024 * 1024
    contenido = await archivo.read(limite + 1)
    if len(contenido) > limite:
        raise HTTPException(413, f"El archivo supera el máximo de {settings.CONTRATOS_MAX_MB} MB")
    nombre = carpetas.nombre_de_archivo(archivo.filename or "contrato.pdf")
    ext = carpetas.validar_contenido(nombre, contenido, categoria)
    ruta = carpetas.ruta_contratos(db, v, crear=True, clave=categoria)
    destino, k = ruta / nombre, 1
    while destino.exists():  # nunca se pisa un archivo de RH
        k += 1
        destino = ruta / f"{Path(nombre).stem} ({k}){ext}"
    try:
        temporal = destino.with_suffix(".tmp")
        temporal.write_bytes(contenido)
        temporal.replace(destino)
    except OSError as e:
        log.error("No se pudo guardar %s: %s", destino, e)
        raise HTTPException(503, "No se pudo guardar el archivo en la carpeta compartida (revisa permisos y conexión).") from e
    db.commit()
    return next(ArchivoOut(**a) for a in carpetas.listar(ruta) if a["nombre"] == destino.name)


@router.get("/vendedores/{vendedor_id}/documentos/archivo")
def ver(vendedor_id: int, nombre: str, descargar: bool = False, categoria: str = "contratos", db: Session = Depends(get_db)):
    v = _vendedor(db, vendedor_id)
    carpetas.categoria(categoria)
    ruta = carpetas.ruta_contratos(db, v, clave=categoria)
    if ruta is None:
        raise HTTPException(404, "El vendedor aún no tiene carpeta de contratos")
    f = carpetas.archivo_seguro(ruta, nombre)
    return FileResponse(
        f, media_type=carpetas.TIPOS.get(f.suffix.lower(), "application/octet-stream"), filename=f.name,
        content_disposition_type="attachment" if descargar else "inline", headers={"Cache-Control": "no-store"},
    )


@router.delete("/vendedores/{vendedor_id}/documentos", status_code=204)
def quitar(vendedor_id: int, nombre: str, categoria: str = "contratos", db: Session = Depends(get_db)):
    """No borra: aparta el archivo en `_eliminados` (por si fue un error)."""
    v = _vendedor(db, vendedor_id)
    carpetas.categoria(categoria)
    ruta = carpetas.ruta_contratos(db, v, clave=categoria)
    if ruta is None:
        raise HTTPException(404, "El vendedor aún no tiene carpeta de contratos")
    f = carpetas.archivo_seguro(ruta, nombre)
    destino = carpetas.raiz().parent / carpetas.CARPETA_ELIMINADOS / (v.carpeta_contratos or "") / categoria / f"{datetime.now():%Y%m%d-%H%M%S}_{f.name}"
    try:
        destino.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(f), str(destino))
    except OSError as e:
        raise HTTPException(503, "No se pudo mover el archivo en la carpeta compartida") from e


# ── Administración de las carpetas (solo admin) ──────────────────────────────

@router.get("/documentos/carpetas/estado", response_model=EstadoCarpetas)
def estado(db: Session = Depends(get_db), user=Depends(puede_escribir)):
    vendedores = list(db.scalars(select(Vendedor)))
    if not carpetas.configurada():
        return EstadoCarpetas(configurada=False, accesible=False, escribible=False, vendedores=len(vendedores),
                              mensaje="La carpeta de contratos no está configurada.")
    try:
        base = carpetas.raiz()
        accesible = base.parent.is_dir()
    except HTTPException:
        accesible, base = False, None
    escribible = bool(accesible and base is not None and base.is_dir() and _escribible(base))
    con = 0
    if accesible and base is not None and base.is_dir():
        reales = carpetas.carpetas_existentes()
        con = sum(1 for v in vendedores if (v.carpeta_contratos and (base / v.carpeta_contratos).is_dir()) or carpetas.normalizar(v.nombre) in reales)
    return EstadoCarpetas(
        configurada=True, accesible=accesible, escribible=escribible, vendedores=len(vendedores), con_carpeta=con,
        sin_carpeta=len(vendedores) - con, ruta=carpetas.ruta_red() if user.rol.value == "admin" else None,
        mensaje=None if escribible else "La carpeta «Vendedores» no existe o no se puede escribir" if accesible else "No se puede abrir la unidad",
    )


@router.get("/documentos/carpetas/revision", response_model=Revision)
def revision(db: Session = Depends(get_db), _admin=Depends(requiere())):
    """Qué carpetas de RH no tienen vendedor y qué vendedores no tienen carpeta, con sugerencias por parecido."""
    carpetas.raiz()
    reales = carpetas.carpetas_existentes()  # normalizado -> real
    vendedores = list(db.scalars(select(Vendedor)))
    usadas = set()
    sin_carpeta = []
    for v in vendedores:
        nombre = carpetas.carpeta_de(db, v)
        if nombre:
            usadas.add(carpetas.normalizar(nombre))
        else:
            sin_carpeta.append(SinCarpeta(id=v.id, codigo=v.codigo_vendedor, nombre=v.nombre, vigente=v.vigente))
    db.commit()
    sin_vendedor = []
    candidatos = {carpetas.normalizar(s.nombre): s for s in sin_carpeta}
    for norm_, real in sorted(reales.items(), key=lambda x: x[1]):
        if norm_ in usadas:
            continue
        cerca = difflib.get_close_matches(norm_, list(candidatos), n=3, cutoff=0.8)
        sin_vendedor.append(SinVendedor(carpeta=real, sugerencias=[
            {"id": candidatos[c].id, "nombre": candidatos[c].nombre,
             "similitud": round(difflib.SequenceMatcher(None, norm_, c).ratio(), 2)} for c in cerca
        ]))
    return Revision(sin_vendedor=sin_vendedor, sin_carpeta=sin_carpeta)


@router.post("/documentos/carpetas/vincular", status_code=204)
def vincular(data: Vincular, db: Session = Depends(get_db), _admin=Depends(requiere())):
    """Confirma a mano que una carpeta de RH es de cierto vendedor (nombres escritos distinto)."""
    v = _vendedor(db, data.vendedor_id)
    base = carpetas.raiz()
    if carpetas.carpetas_existentes().get(carpetas.normalizar(data.carpeta)) is None:
        raise HTTPException(404, "Esa carpeta no existe")
    real = carpetas.carpetas_existentes()[carpetas.normalizar(data.carpeta)]
    otro = db.scalar(select(Vendedor).where(Vendedor.carpeta_contratos == real, Vendedor.id != v.id))
    if otro:
        raise HTTPException(409, f"Esa carpeta ya está vinculada a {otro.nombre}")
    v.carpeta_contratos = real
    carpetas._dentro(base, base / real)
    db.commit()


@router.post("/documentos/carpetas/crear-faltantes", response_model=ResultadoCrear)
def crear_faltantes(solo_vigentes: bool = True, db: Session = Depends(get_db), _admin=Depends(requiere())):
    """Crea la carpeta de cada vendedor que no la tenga (equivale al .bat de RH) y vincula las que ya existen."""
    carpetas.raiz()
    vinculadas = creadas = 0
    errores: list[str] = []
    for v in db.scalars(select(Vendedor)):
        if solo_vigentes and not v.vigente:
            continue
        antes = carpetas.carpeta_de(db, v)
        if antes:
            vinculadas += 1
            continue
        try:
            carpetas.ruta_contratos(db, v, crear=True)
            creadas += 1
        except HTTPException as e:
            errores.append(f"{v.nombre}: {e.detail}")
            break  # si la unidad falla, no tiene sentido seguir con los demás
    db.commit()
    return ResultadoCrear(vinculadas=vinculadas, creadas=creadas, errores=errores)
