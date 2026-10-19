from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import AfterValidator, BaseModel, Field, field_validator, model_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import requiere, sesion_actual, usuario_base
from app.core import ratelimit
from app.core.config import settings
from app.core.database import get_db
from app.core.security import (
    crear_token, hash_password, leer_token, problema_clave, segundos_restantes, verify_password,
)
from app.models import Auditoria, Rol, Usuario

router = APIRouter(tags=["auth"])



def _mayus(v):
    return v.strip().upper() if isinstance(v, str) else v


Nombre = Annotated[str, AfterValidator(_mayus)]  # los nombres se guardan en MAYÚSCULAS


def _username(v: str) -> str:
    v = "".join(v.split()).lower()
    if not v:
        raise ValueError("El nombre de usuario es requerido")
    return v


class Login(BaseModel):
    username: str
    password: str


class UsuarioOut(BaseModel):
    id: int
    username: str
    nombre: str
    email: str | None = None
    rol: Rol
    activo: bool
    ultimo_acceso: datetime | None = None
    debe_cambiar_clave: bool = False
    bloqueado: bool = False  # bloqueo por intentos fallidos vigente (solo en el listado)

    model_config = {"from_attributes": True}


class UsuarioCrear(BaseModel):
    username: str
    nombre: Nombre = Field(min_length=1)
    email: str | None = None
    password: str
    rol: Rol

    _norm = field_validator("username")(_username)

    @model_validator(mode="after")
    def _politica(self):
        if (motivo := problema_clave(self.password, self.username)):
            raise ValueError(motivo)
        return self


class UsuarioActualizar(BaseModel):
    username: str | None = None
    nombre: Nombre | None = Field(default=None, min_length=1)
    email: str | None = None
    rol: Rol | None = None
    activo: bool | None = None

    @field_validator("username")
    @classmethod
    def _norm(cls, v):
        return _username(v) if v is not None else v


class NuevaClave(BaseModel):
    new_password: str

    @field_validator("new_password")
    @classmethod
    def _politica(cls, v):
        if (motivo := problema_clave(v)):
            raise ValueError(motivo)
        return v


class CambiarClave(NuevaClave):
    current_password: str


def _token(user: Usuario, inicio: float | None = None) -> dict:
    token = crear_token(user.username, user.password_hash, inicio)
    return {"access_token": token, "token_type": "bearer", "expires_in": segundos_restantes(leer_token(token))}


def _ip(request: Request) -> str:
    # Detrás de un proxy en la misma máquina uvicorn puede dejar el host en None: nunca devolver None
    return (request.client.host if request.client else None) or "?"


def auditar(db: Session, evento: str, usuario: str | None, request: Request | None = None,
            actor: str | None = None, detalle: str | None = None) -> None:
    """Registra un evento de seguridad (se confirma junto con el resto de la operación)."""
    db.add(Auditoria(
        evento=evento, usuario=(usuario or "")[:60] or None, actor=actor, detalle=(detalle or "")[:300] or None,
        ip=_ip(request)[:45] if request else None,
    ))


@router.get("/auth/politica")
def politica():
    """Reglas de seguridad vigentes (las usa la pantalla para validar antes de enviar)."""
    return {
        "password_min": settings.PASSWORD_MIN,
        "token_minutos": settings.TOKEN_MINUTES,
        "sesion_max_horas": settings.SESION_MAX_HORAS,
    }


@router.post("/auth/login")
def login(data: Login, request: Request, db: Session = Depends(get_db)):
    ip = _ip(request)
    nombre = data.username.strip().lower()
    espera = ratelimit.segundos_bloqueado(ip, data.username)
    if espera:
        auditar(db, "login_bloqueado", nombre, request)
        db.commit()
        raise HTTPException(429, f"Demasiados intentos fallidos. Espera {-(-espera // 60)} min e inténtalo de nuevo.")
    user = db.scalar(select(Usuario).where(Usuario.username == nombre))
    if not user or not user.activo or not verify_password(data.password, user.password_hash):
        ratelimit.registrar_fallo(ip, data.username)
        auditar(db, "login_fallo", nombre, request, detalle="cuenta inactiva" if user and not user.activo else None)
        if ratelimit.segundos_bloqueado(ip, data.username):
            auditar(db, "cuenta_bloqueada", nombre, request, detalle=f"{settings.LOGIN_MAX_INTENTOS} intentos fallidos")
        db.commit()
        raise HTTPException(401, "Usuario o contraseña incorrectos")
    ratelimit.registrar_exito(ip, data.username)
    user.ultimo_acceso = datetime.now(timezone.utc).replace(tzinfo=None)  # UTC
    auditar(db, "login_ok", user.username, request)
    db.commit()
    return _token(user)


@router.get("/auth/me", response_model=UsuarioOut)
def me(user: Usuario = Depends(usuario_base)):
    return user


@router.post("/auth/refresh")
def renovar(sesion=Depends(sesion_actual)):
    """Renueva el token mientras la sesión siga viva (conserva el tope de SESION_MAX_HORAS desde el ingreso)."""
    user, datos = sesion
    return _token(user, datos["orig"])


@router.post("/auth/change-password")
def cambiar_clave(
    data: CambiarClave, request: Request, user: Usuario = Depends(usuario_base), db: Session = Depends(get_db),
):
    """El propio usuario cambia su contraseña. Devuelve un token nuevo: los anteriores dejan de valer."""
    if not verify_password(data.current_password, user.password_hash):
        raise HTTPException(400, "La contraseña actual es incorrecta")
    if data.current_password == data.new_password:
        raise HTTPException(400, "La nueva contraseña debe ser distinta a la actual")
    if (motivo := problema_clave(data.new_password, user.username)):
        raise HTTPException(400, motivo)
    user.password_hash = hash_password(data.new_password)
    user.debe_cambiar_clave = False
    auditar(db, "clave_cambiada", user.username, request)
    db.commit()
    return _token(user)


@router.get("/usuarios", response_model=list[UsuarioOut], dependencies=[Depends(requiere())])
def listar(db: Session = Depends(get_db)):
    bloq = ratelimit.bloqueados()
    out = []
    for u in db.scalars(select(Usuario).order_by(Usuario.nombre, Usuario.username)):
        o = UsuarioOut.model_validate(u)
        o.bloqueado = u.username in bloq
        out.append(o)
    return out


@router.post("/usuarios", response_model=UsuarioOut, status_code=201, dependencies=[Depends(requiere())])
def crear(data: UsuarioCrear, request: Request, actor: Usuario = Depends(requiere()), db: Session = Depends(get_db)):
    if db.scalar(select(Usuario).where(Usuario.username == data.username)):
        raise HTTPException(409, f'El usuario "{data.username}" ya existe')
    u = Usuario(
        username=data.username, nombre=data.nombre.strip(), email=(data.email or "").strip() or None,
        rol=data.rol, password_hash=hash_password(data.password), debe_cambiar_clave=True,
    )
    db.add(u)
    auditar(db, "usuario_creado", u.username, request, actor.username, f"rol {data.rol.value}")
    db.commit()
    db.refresh(u)
    return u


def _otro_usuario(db: Session, actor: Usuario, usuario_id: int) -> Usuario:
    """Usuario a gestionar. El admin no se modifica ni elimina a sí mismo desde aquí."""
    if actor.id == usuario_id:
        raise HTTPException(403, "No puedes modificar tu propia cuenta desde aquí")
    u = db.get(Usuario, usuario_id)
    if not u:
        raise HTTPException(404, "Usuario no encontrado")
    return u


@router.patch("/usuarios/{usuario_id}", response_model=UsuarioOut)
def actualizar(
    usuario_id: int, data: UsuarioActualizar, request: Request,
    actor: Usuario = Depends(requiere()), db: Session = Depends(get_db),
):
    u = _otro_usuario(db, actor, usuario_id)
    cambios = data.model_dump(exclude_unset=True)
    nuevo = cambios.get("username")
    if nuevo and nuevo != u.username:
        if db.scalar(select(Usuario).where(Usuario.username == nuevo)):
            raise HTTPException(409, f'El usuario "{nuevo}" ya está en uso')
    if "nombre" in cambios:
        cambios["nombre"] = cambios["nombre"].strip()
    if "email" in cambios:
        cambios["email"] = (cambios["email"] or "").strip() or None
    antes = {k: getattr(u, k) for k in cambios}
    for k, val in cambios.items():
        setattr(u, k, val)
    if cambios.get("activo") is False and antes.get("activo") is not False:
        u.sesiones_desde = datetime.now(timezone.utc).replace(tzinfo=None)
    resumen = ", ".join(f"{k}: {getattr(antes[k], 'value', antes[k])} → {getattr(v, 'value', v)}"
                        for k, v in cambios.items() if antes[k] != v)
    auditar(db, "usuario_modificado", u.username, request, actor.username, resumen or None)
    db.commit()
    db.refresh(u)
    return u


@router.post("/usuarios/{usuario_id}/password")
def fijar_clave(
    usuario_id: int, data: NuevaClave, request: Request,
    actor: Usuario = Depends(requiere()), db: Session = Depends(get_db),
):
    """El admin fija una contraseña nueva sin pedir la actual. Cierra las sesiones de esa persona."""
    if actor.id == usuario_id:
        raise HTTPException(403, "Usa «Cambiar contraseña» para cambiar la tuya")
    u = _otro_usuario(db, actor, usuario_id)
    if (motivo := problema_clave(data.new_password, u.username)):
        raise HTTPException(400, motivo)
    u.password_hash = hash_password(data.new_password)
    u.debe_cambiar_clave = True  # la persona elige la suya al ingresar
    auditar(db, "clave_restablecida", u.username, request, actor.username)
    db.commit()
    return {"ok": True}


@router.post("/usuarios/{usuario_id}/cerrar-sesiones")
def cerrar_sesiones(
    usuario_id: int, request: Request, actor: Usuario = Depends(requiere()), db: Session = Depends(get_db),
):
    """Invalida todos los tokens ya emitidos de esa persona (sigue pudiendo ingresar de nuevo)."""
    u = _otro_usuario(db, actor, usuario_id)
    u.sesiones_desde = datetime.now(timezone.utc).replace(tzinfo=None)
    auditar(db, "sesiones_cerradas", u.username, request, actor.username)
    db.commit()
    return {"ok": True}


@router.post("/usuarios/{usuario_id}/desbloquear")
def desbloquear(
    usuario_id: int, request: Request, actor: Usuario = Depends(requiere()), db: Session = Depends(get_db),
):
    """Levanta el bloqueo por intentos fallidos sin reiniciar el servicio."""
    u = _otro_usuario(db, actor, usuario_id)
    n = ratelimit.liberar(u.username)
    auditar(db, "cuenta_desbloqueada", u.username, request, actor.username)
    db.commit()
    return {"ok": True, "bloqueos_levantados": n}


class AuditoriaOut(BaseModel):
    id: int
    fecha: datetime
    evento: str
    usuario: str | None = None
    actor: str | None = None
    detalle: str | None = None
    ip: str | None = None

    model_config = {"from_attributes": True}


@router.get("/auditoria", response_model=list[AuditoriaOut], dependencies=[Depends(requiere())])
def bitacora(usuario: str | None = None, limite: int = 100, db: Session = Depends(get_db)):
    """Últimos eventos de seguridad (solo admin), del más reciente al más antiguo."""
    q = select(Auditoria).order_by(Auditoria.fecha.desc(), Auditoria.id.desc()).limit(max(1, min(limite, 500)))
    if usuario:
        q = q.where(Auditoria.usuario == usuario.strip().lower())
    return list(db.scalars(q))


@router.delete("/usuarios/{usuario_id}", status_code=204)
def eliminar(
    usuario_id: int, request: Request, actor: Usuario = Depends(requiere()), db: Session = Depends(get_db),
):
    u = _otro_usuario(db, actor, usuario_id)
    auditar(db, "usuario_eliminado", u.username, request, actor.username)
    db.delete(u)
    db.commit()
