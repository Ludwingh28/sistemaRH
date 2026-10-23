"""Permisos del sistema: qué puede hacer cada rol y cada usuario con los paneles.

  permisos efectivos de un usuario = (permisos de su rol  +  los que el admin le permite)  −  los que le deniega

- El **administrador** siempre tiene todo (no se puede restringir) y es el único que gestiona usuarios y permisos.
- Los permisos de cada rol los edita el admin; mientras no los toque se usan los de `DEFECTO` (equivalen al
  comportamiento de antes: Jefe RRHH, Jefe DDHH y Analista DH gestionan todo lo de RRHH; Lector solo consulta).
- Además el admin puede dar o quitar permisos puntuales a un usuario.
"""
import json
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Rol, RolConfig, Usuario, UsuarioPermiso


@dataclass(frozen=True)
class Permiso:
    codigo: str
    etiqueta: str
    grupo: str
    descripcion: str = ""


CATALOGO: list[Permiso] = [
    Permiso("vendedores.ver", "Ver el panel de vendedores", "Vendedores", "Lista, fichas y contratos registrados de cada vendedor."),
    Permiso("vendedores.crear", "Registrar vendedores nuevos", "Vendedores"),
    Permiso("vendedores.editar", "Editar datos de un vendedor", "Vendedores", "Incluye corregir su código."),
    Permiso("vendedores.baja", "Dar de baja a un vendedor", "Vendedores"),
    Permiso("vendedores.importar", "Importar el Excel de RRHH", "Vendedores", "Cargar el Excel mensual de vendedores."),
    Permiso("contratos.gestionar", "Crear, renovar, editar y eliminar contratos", "Contratos"),
    Permiso("asistencia.ver", "Ver el panel de asistencia", "Asistencia"),
    Permiso("asistencia.exportar", "Descargar la asistencia en Excel", "Asistencia"),
    Permiso("feriados.gestionar", "Gestionar los feriados", "Asistencia", "Crear, activar, desactivar y sincronizar feriados."),
    Permiso("rotacion.ver", "Ver el panel de rotación", "Rotación"),
    Permiso("documentacion.panel", "Ver el panel de documentación", "Documentación", "Qué documentos le faltan entregar a cada vendedor."),
    Permiso("documentos.ver", "Ver y descargar los PDF de los vendedores", "Documentos", "Contratos y demás documentos (son datos personales)."),
    Permiso("documentos.subir", "Subir PDF a la carpeta de un vendedor", "Documentos"),
    Permiso("documentos.eliminar", "Quitar PDF de la carpeta de un vendedor", "Documentos", "Los archivos se apartan, no se borran."),
    Permiso("carpetas.administrar", "Administrar las carpetas de la unidad compartida", "Documentos", "Vincular carpetas y crear las que falten."),
]
CODIGOS: set[str] = {p.codigo for p in CATALOGO}

DEFECTO: dict[Rol, set[str]] = {
    Rol.jefe_rrhh: CODIGOS - {"carpetas.administrar"},
    Rol.dh: CODIGOS - {"carpetas.administrar"},
    Rol.analista_dh: CODIGOS - {"carpetas.administrar"},
    Rol.lector: {"vendedores.ver", "asistencia.ver", "rotacion.ver"},
}
ROLES_EDITABLES = [Rol.jefe_rrhh, Rol.dh, Rol.analista_dh, Rol.lector]


def permisos_de_rol(db: Session, rol: Rol) -> set[str]:
    if rol == Rol.admin:
        return set(CODIGOS)
    fila = db.get(RolConfig, rol.value)
    if fila is None:
        return set(DEFECTO.get(rol, set()))
    try:
        return {c for c in json.loads(fila.permisos) if c in CODIGOS}
    except ValueError:
        return set(DEFECTO.get(rol, set()))


def guardar_permisos_de_rol(db: Session, rol: Rol, codigos: set[str]) -> None:
    fila = db.get(RolConfig, rol.value)
    texto = json.dumps(sorted(codigos))
    if fila is None:
        db.add(RolConfig(rol=rol.value, permisos=texto))
    else:
        fila.permisos = texto


def ajustes_de_usuario(db: Session, usuario_id: int) -> tuple[set[str], set[str]]:
    """(permitidos, denegados) puntuales del usuario."""
    permitir, denegar = set(), set()
    for a in db.scalars(select(UsuarioPermiso).where(UsuarioPermiso.usuario_id == usuario_id)):
        if a.permiso in CODIGOS:
            (permitir if a.permitido else denegar).add(a.permiso)
    return permitir, denegar


def permisos_efectivos(db: Session, user: Usuario) -> set[str]:
    if user.rol == Rol.admin:
        return set(CODIGOS)
    permitir, denegar = ajustes_de_usuario(db, user.id)
    return (permisos_de_rol(db, user.rol) | permitir) - denegar
