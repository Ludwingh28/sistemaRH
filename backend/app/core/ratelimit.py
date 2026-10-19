"""Límite de intentos de inicio de sesión (en memoria, por usuario + dirección).

Frena a quien intenta adivinar contraseñas: tras LOGIN_MAX_INTENTOS fallos seguidos bloquea ese usuario
desde esa dirección durante LOGIN_BLOQUEO_MIN minutos. Un acceso correcto borra el contador. Se reinicia
al reiniciar el servicio (aceptable para un sistema interno de un solo proceso).
"""
import time
from threading import Lock

from app.core.config import settings

_fallos: dict[tuple[str, str], list[float]] = {}
_bloqueados: dict[tuple[str, str], float] = {}
_lock = Lock()


def _clave(ip: str, usuario: str) -> tuple[str, str]:
    return (ip, usuario.strip().lower())


def segundos_bloqueado(ip: str, usuario: str) -> int:
    """Segundos que faltan para poder reintentar (0 si no está bloqueado)."""
    with _lock:
        hasta = _bloqueados.get(_clave(ip, usuario), 0)
        resto = int(hasta - time.time())
        if resto <= 0:
            _bloqueados.pop(_clave(ip, usuario), None)
            return 0
        return resto


def registrar_fallo(ip: str, usuario: str) -> None:
    ventana = settings.LOGIN_BLOQUEO_MIN * 60
    ahora = time.time()
    k = _clave(ip, usuario)
    with _lock:
        recientes = [t for t in _fallos.get(k, []) if ahora - t < ventana] + [ahora]
        _fallos[k] = recientes
        if len(recientes) >= settings.LOGIN_MAX_INTENTOS:
            _bloqueados[k] = ahora + ventana
            _fallos.pop(k, None)


def registrar_exito(ip: str, usuario: str) -> None:
    with _lock:
        _fallos.pop(_clave(ip, usuario), None)


def liberar(usuario: str) -> int:
    """Quita el bloqueo y los fallos de ese usuario desde cualquier dirección. Devuelve cuántos bloqueos levantó."""
    u = usuario.strip().lower()
    with _lock:
        for k in [k for k in _fallos if k[1] == u]:
            _fallos.pop(k, None)
        bloq = [k for k in _bloqueados if k[1] == u]
        for k in bloq:
            _bloqueados.pop(k, None)
        return len(bloq)


def bloqueados() -> set[str]:
    """Usuarios con un bloqueo vigente (desde cualquier dirección)."""
    ahora = time.time()
    with _lock:
        return {k[1] for k, hasta in _bloqueados.items() if hasta > ahora}
