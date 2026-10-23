"""Panel de documentación: qué documentos le faltan entregar a cada vendedor (Kardex, CI, Fachada, Ubicación…).

Un documento figura como entregado SOLO si hay al menos un archivo en su subcarpeta de la carpeta del vendedor
(`<regional>\\Vendedores\\<nombre>\\<Documento>\\`): aunque exista en físico, debe estar subido al sistema. Por ahora no hay
forma de marcar un documento como «no aplica» ni como entregado sin archivo: todos deben entregar todo.
"""
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.api.deps import requiere_permiso
from app.core.alcance import alcance_de
from app.core.database import get_db
from app.models import EquipoDTS, Vendedor
from app.services import carpetas

router = APIRouter(prefix="/documentacion", tags=["documentacion"])

Estado = Literal["ok", "falta"]


class Categoria(BaseModel):
    clave: str
    titulo: str
    corto: str
    extensiones: list[str]


class Celda(BaseModel):
    estado: Estado
    archivos: int = 0


class FilaDoc(BaseModel):
    vendedor_id: int
    codigo: str
    nombre: str
    equipo: str
    regional: str
    vigente: bool
    docs: dict[str, Celda]
    faltan: int


class ResumenDoc(BaseModel):
    vendedores: int
    completos: int
    por_documento: dict[str, dict[str, int]]  # clave -> {ok, falta}


class MatrizDoc(BaseModel):
    columnas: list[Categoria]
    filas: list[FilaDoc]
    resumen: ResumenDoc
    unidad_disponible: bool
    aviso: str | None = None


def _categoria_out(clave: str) -> Categoria:
    c = carpetas.CATEGORIAS[clave]
    return Categoria(clave=clave, titulo=c["titulo"], corto=c.get("corto", c["titulo"]), extensiones=sorted(c["extensiones"]))


@router.get("/categorias", response_model=list[Categoria], dependencies=[Depends(requiere_permiso("documentos.ver", "documentacion.panel"))])
def categorias():
    """Tipos de documento (el contrato primero) que se guardan en la carpeta de cada vendedor."""
    return [_categoria_out(k) for k in carpetas.CATEGORIAS]


@router.get("/matriz", response_model=MatrizDoc, dependencies=[Depends(requiere_permiso("documentacion.panel"))])
def matriz(
    regional_id: int | None = None,
    equipo_id: int | None = None,
    estado: Literal["vigentes", "retirados", "todos"] = "vigentes",
    q: str | None = None,
    solo_faltantes: bool = False,
    db: Session = Depends(get_db),
):
    consulta = alcance_de(db).filtrar(select(Vendedor).options(joinedload(Vendedor.equipo).joinedload(EquipoDTS.regional)))
    if equipo_id:
        consulta = consulta.where(Vendedor.equipo_id == equipo_id)
    elif regional_id:
        consulta = consulta.join(EquipoDTS, Vendedor.equipo_id == EquipoDTS.id).where(EquipoDTS.regional_id == regional_id)
    if estado == "vigentes":
        consulta = consulta.where(Vendedor.fecha_baja.is_(None))
    elif estado == "retirados":
        consulta = consulta.where(Vendedor.fecha_baja.is_not(None))
    vendedores = list(db.scalars(consulta).unique())
    if q and q.strip():
        t = carpetas.normalizar(q)
        vendedores = [
            v for v in vendedores
            if t in carpetas.normalizar(f"{v.nombre} {v.codigo_vendedor} {v.equipo.nombre} {v.equipo.regional.nombre}")
        ]
    vendedores.sort(key=lambda v: (v.equipo.regional.nombre, v.equipo.nombre, v.nombre))

    base, existentes, aviso = None, {}, None
    if not carpetas.configurada():
        aviso = "La carpeta de contratos no está configurada en el servidor: no se pueden ver los archivos."
    else:
        try:
            base = carpetas.raiz()
            existentes = carpetas.carpetas_existentes()
        except HTTPException as e:
            aviso = f"{e.detail} No se pueden ver los archivos."

    claves = carpetas.DOCUMENTACION
    resumen = {k: {"ok": 0, "falta": 0} for k in claves}
    filas: list[FilaDoc] = []
    completos = 0
    for v in vendedores:
        rutas = carpetas.rutas_categorias(v, base, existentes) if base is not None else {}
        docs: dict[str, Celda] = {}
        for k in claves:
            n = len(carpetas.listar(rutas.get(k)))
            est: Estado = "ok" if n > 0 else "falta"
            docs[k] = Celda(estado=est, archivos=n)
            resumen[k][est] += 1
        faltan = sum(1 for c in docs.values() if c.estado == "falta")
        if faltan == 0:
            completos += 1
        if solo_faltantes and faltan == 0:
            continue
        filas.append(FilaDoc(
            vendedor_id=v.id, codigo=v.codigo_vendedor, nombre=v.nombre, equipo=v.equipo.nombre, regional=v.equipo.regional.nombre,
            vigente=v.vigente, docs=docs, faltan=faltan,
        ))
    return MatrizDoc(
        columnas=[_categoria_out(k) for k in claves], filas=filas,
        resumen=ResumenDoc(vendedores=len(vendedores), completos=completos, por_documento=resumen),
        unidad_disponible=base is not None, aviso=aviso,
    )
