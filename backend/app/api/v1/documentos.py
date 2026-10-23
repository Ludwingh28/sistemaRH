"""Contratos de cada vendedor en la unidad compartida de RH (ver services/carpetas.py).

Los archivos se leen en vivo de `<REGIONAL>\\Vendedores\\<NOMBRE>\\Contratos`; la base solo recuerda la ruta
relativa de la carpeta de cada vendedor («Regional/NOMBRE»). Son datos personales: solo admin, DH y Analista DH, siempre a través de la API
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
from sqlalchemy.orm import Session, joinedload

from app.api.deps import requiere_permiso
from app.core.alcance import alcance_de
from app.core.config import settings
from app.core.database import get_db
from app.models import EquipoDTS, Vendedor
from app.services import carpetas

router = APIRouter(tags=["documentos"])
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
    carpeta: str | None = None  # carpeta del vendedor, relativa a la unidad: «Regional/NOMBRE»
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
    subcarpetas: int = 0  # subcarpetas de documentos (Kardex, CI…) creadas en carpetas de vendedor
    errores: list[str]


class Vincular(BaseModel):
    vendedor_id: int
    carpeta: str


def _todos(db: Session) -> list[Vendedor]:
    consulta = select(Vendedor).options(joinedload(Vendedor.equipo).joinedload(EquipoDTS.regional))
    return list(db.scalars(alcance_de(db).filtrar(consulta)))


def _vendedor(db: Session, vendedor_id: int) -> Vendedor:
    v = db.get(Vendedor, vendedor_id)
    if not v or not alcance_de(db).permite(v.equipo.regional_id):
        raise HTTPException(404, "Vendedor no encontrado")
    return v


def _solo_nacional(db: Session) -> None:
    """Las herramientas de la unidad compartida ven carpetas de todas las regionales: requieren alcance nacional."""
    if not alcance_de(db).nacional:
        raise HTTPException(403, "Esta herramienta requiere alcance nacional.")


def _escribible(base: Path) -> bool:
    try:
        prueba = base / ".prueba_escritura"
        prueba.write_text("ok")
        prueba.unlink()
        return True
    except OSError:
        return False


# ── Por vendedor ─────────────────────────────────────────────────────────────

@router.get("/vendedores/{vendedor_id}/documentos", response_model=DocumentosVendedor, dependencies=[Depends(requiere_permiso("documentos.ver"))])
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
        carpeta=v.carpeta_contratos,
        ruta=carpetas.ruta_red(v.carpeta_contratos, categoria, carpetas.regional_de(v)) if v.carpeta_contratos else None,
        archivos=[ArchivoOut(**a) for a in carpetas.listar(ruta)],
    )


@router.post("/vendedores/{vendedor_id}/documentos/carpeta", response_model=DocumentosVendedor, status_code=201, dependencies=[Depends(requiere_permiso("documentos.subir"))])
def crear_carpeta(vendedor_id: int, categoria: str = "contratos", db: Session = Depends(get_db)):
    v = _vendedor(db, vendedor_id)
    carpetas.categoria(categoria)
    for clave in carpetas.CATEGORIAS:
        carpetas.ruta_contratos(db, v, crear=True, clave=clave)
    db.commit()
    return listar(vendedor_id, categoria, db)


@router.post("/vendedores/{vendedor_id}/documentos", response_model=ArchivoOut, status_code=201, dependencies=[Depends(requiere_permiso("documentos.subir"))])
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


@router.get("/vendedores/{vendedor_id}/documentos/archivo", dependencies=[Depends(requiere_permiso("documentos.ver"))])
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


@router.delete("/vendedores/{vendedor_id}/documentos", status_code=204, dependencies=[Depends(requiere_permiso("documentos.eliminar"))])
def quitar(vendedor_id: int, nombre: str, categoria: str = "contratos", db: Session = Depends(get_db)):
    """No borra: aparta el archivo en `_eliminados` (por si fue un error)."""
    v = _vendedor(db, vendedor_id)
    carpetas.categoria(categoria)
    ruta = carpetas.ruta_contratos(db, v, clave=categoria)
    if ruta is None:
        raise HTTPException(404, "El vendedor aún no tiene carpeta de contratos")
    f = carpetas.archivo_seguro(ruta, nombre)
    destino = carpetas.raiz().joinpath(carpetas.CARPETA_ELIMINADOS, *carpetas.partes_rel(v.carpeta_contratos or ""), categoria,
                                       f"{datetime.now():%Y%m%d-%H%M%S}_{f.name}")
    try:
        destino.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(f), str(destino))
    except OSError as e:
        raise HTTPException(503, "No se pudo mover el archivo en la carpeta compartida") from e


# ── Administración de las carpetas (solo admin) ──────────────────────────────

@router.get("/documentos/carpetas/estado", response_model=EstadoCarpetas, dependencies=[Depends(requiere_permiso("documentos.ver"))])
def estado(db: Session = Depends(get_db), user=Depends(requiere_permiso("documentos.ver"))):
    vendedores = _todos(db)
    if not carpetas.configurada():
        return EstadoCarpetas(configurada=False, accesible=False, escribible=False, vendedores=len(vendedores),
                              mensaje="La carpeta de contratos no está configurada.")
    try:
        base = carpetas.raiz()
        accesible = True
    except HTTPException:
        accesible, base = False, None
    escribible = bool(accesible and base is not None and _escribible(base))
    con = 0
    if accesible and base is not None:
        reales = carpetas.carpetas_existentes()
        con = sum(1 for v in vendedores if carpetas.tiene_carpeta(v, base, reales))
    return EstadoCarpetas(
        configurada=True, accesible=accesible, escribible=escribible, vendedores=len(vendedores), con_carpeta=con,
        sin_carpeta=len(vendedores) - con, ruta=carpetas.ruta_red() if user.rol.value == "admin" else None,
        mensaje=None if escribible else "La unidad de contratos no se puede escribir (revisa los permisos)" if accesible else "No se puede abrir la unidad",
    )


@router.get("/documentos/carpetas/revision", response_model=Revision, dependencies=[Depends(requiere_permiso("carpetas.administrar"))])
def revision(db: Session = Depends(get_db), _u=Depends(requiere_permiso("carpetas.administrar"))):
    _solo_nacional(db)
    """Qué carpetas de RH no tienen vendedor y qué vendedores no tienen carpeta, con sugerencias por parecido
    (se busca por «regional/nombre», así una carpeta de Santa Cruz se parece más a un vendedor de Santa Cruz)."""
    base = carpetas.raiz()
    reales = carpetas.carpetas_existentes()  # «regional/nombre» normalizado -> real
    usadas = set()
    sin_carpeta = []
    sin_obj = []
    for v in _todos(db):
        rel = carpetas.carpeta_de(db, v, base, reales)
        if rel:
            usadas.add(carpetas.normalizar_rel(rel))
        else:
            sin_obj.append(v)
            sin_carpeta.append(SinCarpeta(id=v.id, codigo=v.codigo_vendedor, nombre=v.nombre, vigente=v.vigente))
    db.commit()
    sin_vendedor = []
    candidatos = {carpetas.clave_vendedor(v): s_ for v, s_ in zip(sin_obj, sin_carpeta)}
    for norm_, real in sorted(reales.items(), key=lambda x: x[1]):
        if norm_ in usadas:
            continue
        cerca = difflib.get_close_matches(norm_, list(candidatos), n=3, cutoff=0.8)
        sin_vendedor.append(SinVendedor(carpeta=real, sugerencias=[
            {"id": candidatos[c].id, "nombre": candidatos[c].nombre,
             "similitud": round(difflib.SequenceMatcher(None, norm_, c).ratio(), 2)} for c in cerca
        ]))
    return Revision(sin_vendedor=sin_vendedor, sin_carpeta=sin_carpeta)


@router.post("/documentos/carpetas/vincular", status_code=204, dependencies=[Depends(requiere_permiso("carpetas.administrar"))])
def vincular(data: Vincular, db: Session = Depends(get_db), _u=Depends(requiere_permiso("carpetas.administrar"))):
    _solo_nacional(db)
    """Confirma a mano que una carpeta de RH es de cierto vendedor (nombres escritos distinto)."""
    v = _vendedor(db, data.vendedor_id)
    base = carpetas.raiz()
    reales = carpetas.carpetas_existentes()
    real = reales.get(carpetas.normalizar_rel(data.carpeta))
    if real is None:
        raise HTTPException(404, "Esa carpeta no existe")
    otro = db.scalar(select(Vendedor).where(Vendedor.carpeta_contratos == real, Vendedor.id != v.id))
    if otro:
        raise HTTPException(409, f"Esa carpeta ya está vinculada a {otro.nombre}")
    v.carpeta_contratos = real
    carpetas._dentro(base, carpetas._ruta_vendedor(base, real, carpetas.regional_de(v)))
    db.commit()


@router.post("/documentos/carpetas/crear-faltantes", response_model=ResultadoCrear, dependencies=[Depends(requiere_permiso("carpetas.administrar"))])
def crear_faltantes(solo_vigentes: bool = True, db: Session = Depends(get_db), _u=Depends(requiere_permiso("carpetas.administrar"))):
    """Deja completa la estructura de cada vendedor: su carpeta y la subcarpeta de cada tipo de documento (Contratos,
    Kardex, CI, Fachada, Ubicación). Lo que ya existe no se toca; las carpetas de RH con el mismo nombre se reconocen."""
    _solo_nacional(db)
    carpetas.raiz()
    vinculadas = creadas = subcarpetas = 0
    errores: list[str] = []
    for v in _todos(db):
        if solo_vigentes and not v.vigente:
            continue
        try:
            nueva, sub = carpetas.estructura_vendedor(db, v)
        except HTTPException as e:
            errores.append(f"{v.nombre}: {e.detail}")
            break  # si la unidad falla, no tiene sentido seguir con los demás
        creadas += nueva
        vinculadas += not nueva
        subcarpetas += sub
    db.commit()
    return ResultadoCrear(vinculadas=vinculadas, creadas=creadas, subcarpetas=subcarpetas, errores=errores)
