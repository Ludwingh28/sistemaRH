import hashlib
import re
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt

from app.core.config import settings


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode(), hashed.encode())


def huella(password_hash: str) -> str:
    """Identifica la contraseña vigente: si cambia, los tokens anteriores dejan de valer."""
    return hashlib.sha256(password_hash.encode()).hexdigest()[:16]


def problema_clave(password: str, username: str | None = None) -> str | None:
    """Política de contraseñas: None si es válida; si no, el motivo (en español)."""
    if len(password) < settings.PASSWORD_MIN:
        return f"La contraseña debe tener al menos {settings.PASSWORD_MIN} caracteres"
    if not re.search(r"[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]", password) or not re.search(r"\d", password):
        return "La contraseña debe incluir letras y números"
    if username and password.strip().lower() == username.strip().lower():
        return "La contraseña no puede ser igual al nombre de usuario"
    return None


def crear_token(username: str, password_hash: str, inicio: float | None = None) -> str:
    """Token de acceso de corta vida (TOKEN_MINUTES), renovable mientras la persona trabaja.

    `inicio` es el momento (epoch) del ingreso con contraseña; se conserva al renovar para que ninguna sesión
    dure más de SESION_MAX_HORAS. `ts` (con decimales) permite que «cerrar sesiones» invalide los tokens anteriores.
    """
    ahora = datetime.now(timezone.utc)
    inicio = inicio or ahora.timestamp()
    tope = datetime.fromtimestamp(inicio, timezone.utc) + timedelta(hours=settings.SESION_MAX_HORAS)
    exp = min(ahora + timedelta(minutes=settings.TOKEN_MINUTES), tope)
    payload = {
        "sub": username, "pv": huella(password_hash),
        "iat": int(ahora.timestamp()), "ts": ahora.timestamp(), "orig": inicio, "exp": exp,
    }
    return jwt.encode(payload, settings.SECRET_KEY, algorithm="HS256")


def leer_token(token: str) -> dict | None:
    """Datos del token, o None si es inválido, está vencido o le faltan las marcas obligatorias."""
    try:
        datos = jwt.decode(
            token, settings.SECRET_KEY, algorithms=["HS256"], options={"require": ["sub", "exp", "iat"]}
        )
    except jwt.PyJWTError:
        return None
    if not isinstance(datos.get("ts"), (int, float)) or not isinstance(datos.get("orig"), (int, float)):
        return None
    return datos


def segundos_restantes(datos: dict) -> int:
    return max(0, int(datos["exp"] - datetime.now(timezone.utc).timestamp()))
