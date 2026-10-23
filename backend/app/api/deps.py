from datetime import datetime, timedelta, timezone

from fastapi import Depends, HTTPException
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.core.security import huella, leer_token
from app.core.alcance import alcance_de_usuario
from app.core.permisos import permisos_efectivos
from app.models import Rol, Usuario

oauth2 = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login")


def sesion_valida(token: str, db: Session) -> tuple[Usuario, dict]:
    """Valida el token contra el estado actual de la cuenta. Falla con 401 si ya no sirve."""
    datos = leer_token(token)
    user = db.scalar(select(Usuario).where(Usuario.username == datos.get("sub"))) if datos else None
    if not user or not user.activo or datos.get("pv") != huella(user.password_hash):
        raise HTTPException(401, "Credenciales inválidas")
    ahora = datetime.now(timezone.utc)
    # «Cerrar sesiones» del administrador: los tokens emitidos antes de esa marca ya no valen
    if user.sesiones_desde and datos["ts"] < user.sesiones_desde.replace(tzinfo=timezone.utc).timestamp():
        raise HTTPException(401, "Tu sesión fue cerrada por un administrador")
    # Tope absoluto de la sesión, aunque el token se renueve
    if ahora.timestamp() > datos["orig"] + settings.SESION_MAX_HORAS * 3600:
        raise HTTPException(401, "Tu sesión expiró")
    # Marca de actividad (como mucho una vez por minuto)
    naive = ahora.replace(tzinfo=None)  # UTC sin zona (columna naive)
    if not user.ultimo_acceso or naive - user.ultimo_acceso > timedelta(minutes=1):
        user.ultimo_acceso = naive
        db.commit()
    return user, datos


def sesion_actual(token: str = Depends(oauth2), db: Session = Depends(get_db)) -> tuple[Usuario, dict]:
    """Sesión válida aunque la persona aún deba cambiar su contraseña (para /auth/*)."""
    return sesion_valida(token, db)


def usuario_base(sesion: tuple[Usuario, dict] = Depends(sesion_actual)) -> Usuario:
    return sesion[0]


def usuario_actual(user: Usuario = Depends(usuario_base), db: Session = Depends(get_db)) -> Usuario:
    """Usuario autenticado. Mientras deba cambiar su contraseña, solo puede usar /auth/*.
    También fija su alcance geográfico (nacional o regionales) para todas las consultas de la petición."""
    if user.debe_cambiar_clave:
        raise HTTPException(403, "Debes cambiar tu contraseña antes de continuar")
    db.info["alcance"] = alcance_de_usuario(user)
    return user


def requiere(*roles: Rol):
    """Dependencia que exige uno de los roles (admin siempre pasa)."""
    permitidos = {*roles, Rol.admin}

    def check(user: Usuario = Depends(usuario_actual)) -> Usuario:
        if user.rol not in permitidos:
            raise HTTPException(403, "No tienes permiso para esta acción")
        return user

    return check


def requiere_permiso(*codigos: str):
    """Dependencia que exige AL MENOS UNO de los permisos indicados (el admin siempre pasa). Ver core/permisos.py."""

    def check(user: Usuario = Depends(usuario_actual), db: Session = Depends(get_db)) -> Usuario:
        efectivos = permisos_efectivos(db, user)
        if not any(c in efectivos for c in codigos):
            raise HTTPException(403, "No tienes permiso para esta acción")
        return user

    return check
