"""Gestión de permisos (solo administrador): qué puede hacer cada rol y cada usuario con los paneles."""
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import delete
from sqlalchemy.orm import Session

from app.api.deps import requiere
from app.api.v1.auth import auditar
from app.core import permisos as perm
from app.core.database import get_db
from app.models import Rol, RolConfig, Usuario, UsuarioPermiso

router = APIRouter(tags=["permisos"])


class PermisoOut(BaseModel):
    codigo: str
    etiqueta: str
    grupo: str
    descripcion: str = ""


class PermisosRoles(BaseModel):
    catalogo: list[PermisoOut]
    roles: dict[str, list[str]]  # permisos vigentes de cada rol editable
    defecto: dict[str, list[str]]  # los de fábrica (para «restablecer»)
    personalizados: list[str]  # roles cuyos permisos ya fueron editados


class PermisosRol(BaseModel):
    permisos: list[str]


class PermisosUsuario(BaseModel):
    rol: str
    del_rol: list[str]
    permitir: list[str]
    denegar: list[str]
    efectivos: list[str]


class AjustesUsuario(BaseModel):
    permitir: list[str] = []
    denegar: list[str] = []


def _validar(codigos: list[str]) -> set[str]:
    desconocidos = sorted(set(codigos) - perm.CODIGOS)
    if desconocidos:
        raise HTTPException(422, "Permiso desconocido: " + ", ".join(desconocidos))
    return set(codigos)


def _rol(valor: str) -> Rol:
    try:
        rol = Rol(valor)
    except ValueError as e:
        raise HTTPException(404, "Rol desconocido") from e
    if rol == Rol.admin:
        raise HTTPException(400, "El administrador siempre tiene todos los permisos y no se puede restringir.")
    return rol


@router.get("/permisos", response_model=PermisosRoles, dependencies=[Depends(requiere())])
def ver_permisos(db: Session = Depends(get_db)):
    editados = {f.rol for f in db.query(RolConfig).all()}
    return PermisosRoles(
        catalogo=[PermisoOut(**p.__dict__) for p in perm.CATALOGO],
        roles={r.value: sorted(perm.permisos_de_rol(db, r)) for r in perm.ROLES_EDITABLES},
        defecto={r.value: sorted(perm.DEFECTO[r]) for r in perm.ROLES_EDITABLES},
        personalizados=sorted(editados),
    )


@router.put("/permisos/roles/{rol}", response_model=PermisosRol)
def guardar_rol(rol: str, data: PermisosRol, request: Request, actor: Usuario = Depends(requiere()), db: Session = Depends(get_db)):
    r = _rol(rol)
    nuevos = _validar(data.permisos)
    antes = perm.permisos_de_rol(db, r)
    perm.guardar_permisos_de_rol(db, r, nuevos)
    agregados, quitados = sorted(nuevos - antes), sorted(antes - nuevos)
    detalle = "; ".join(x for x in (("+ " + ", ".join(agregados)) if agregados else "", ("− " + ", ".join(quitados)) if quitados else "") if x)
    auditar(db, "permisos_rol_modificados", rol, request, actor.username, detalle or "sin cambios")
    db.commit()
    return PermisosRol(permisos=sorted(nuevos))


@router.post("/permisos/roles/{rol}/restablecer", response_model=PermisosRol)
def restablecer_rol(rol: str, request: Request, actor: Usuario = Depends(requiere()), db: Session = Depends(get_db)):
    r = _rol(rol)
    db.execute(delete(RolConfig).where(RolConfig.rol == r.value))
    auditar(db, "permisos_rol_modificados", rol, request, actor.username, "restablecidos a los de fábrica")
    db.commit()
    return PermisosRol(permisos=sorted(perm.permisos_de_rol(db, r)))


def _usuario(db: Session, usuario_id: int) -> Usuario:
    u = db.get(Usuario, usuario_id)
    if not u:
        raise HTTPException(404, "Usuario no encontrado")
    return u


def _estado_usuario(db: Session, u: Usuario) -> PermisosUsuario:
    permitir, denegar = perm.ajustes_de_usuario(db, u.id)
    return PermisosUsuario(
        rol=u.rol.value, del_rol=sorted(perm.permisos_de_rol(db, u.rol)), permitir=sorted(permitir), denegar=sorted(denegar),
        efectivos=sorted(perm.permisos_efectivos(db, u)),
    )


@router.get("/usuarios/{usuario_id}/permisos", response_model=PermisosUsuario, dependencies=[Depends(requiere())])
def ver_usuario(usuario_id: int, db: Session = Depends(get_db)):
    return _estado_usuario(db, _usuario(db, usuario_id))


@router.put("/usuarios/{usuario_id}/permisos", response_model=PermisosUsuario)
def guardar_usuario(
    usuario_id: int, data: AjustesUsuario, request: Request, actor: Usuario = Depends(requiere()), db: Session = Depends(get_db),
):
    u = _usuario(db, usuario_id)
    if u.rol == Rol.admin:
        raise HTTPException(400, "El administrador siempre tiene todos los permisos y no se puede restringir.")
    permitir, denegar = _validar(data.permitir), _validar(data.denegar)
    if permitir & denegar:
        raise HTTPException(422, "Un permiso no puede estar a la vez permitido y denegado")
    del_rol = perm.permisos_de_rol(db, u.rol)
    # Solo se guardan ajustes que de verdad cambian algo respecto al rol
    permitir, denegar = permitir - del_rol, denegar & del_rol
    antes = perm.ajustes_de_usuario(db, u.id)
    db.execute(delete(UsuarioPermiso).where(UsuarioPermiso.usuario_id == u.id))
    for c in sorted(permitir):
        db.add(UsuarioPermiso(usuario_id=u.id, permiso=c, permitido=True))
    for c in sorted(denegar):
        db.add(UsuarioPermiso(usuario_id=u.id, permiso=c, permitido=False))
    db.flush()
    partes = []
    if permitir:
        partes.append("permite: " + ", ".join(sorted(permitir)))
    if denegar:
        partes.append("deniega: " + ", ".join(sorted(denegar)))
    if (permitir, denegar) != antes:
        auditar(db, "permisos_usuario_modificados", u.username, request, actor.username, "; ".join(partes) or "sin ajustes (usa los de su rol)")
    db.commit()
    return _estado_usuario(db, u)
