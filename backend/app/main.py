import logging
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text

from app.api.v1 import asistencia, auth, documentos, estructura, rotacion, vendedores
from app.core.config import settings
from app.core.database import engine

VERSION = "0.0.0.2"
log = logging.getLogger("rh")

PROD = settings.es_produccion


def _validar_produccion():
    """En producción se rechaza arrancar con configuración insegura."""
    problemas = []
    if len(settings.SECRET_KEY) < 32 or "cambia" in settings.SECRET_KEY.lower():
        problemas.append("SECRET_KEY debe tener al menos 32 caracteres y no ser el valor de ejemplo (genera una con: python -c \"import secrets; print(secrets.token_hex(32))\")")
    if not settings.APP_DB_PASSWORD or settings.APP_DB_PASSWORD.lower() in ("postgres", "password", "1234"):
        problemas.append("APP_DB_PASSWORD es débil o está vacía")
    if problemas:
        raise RuntimeError("Configuración de producción insegura:\n - " + "\n - ".join(problemas))


if PROD:
    _validar_produccion()

# En producción no se publica la documentación interactiva de la API.
app = FastAPI(
    title="Cruzimex - Sistema RH Canal DTS",
    version=VERSION,
    docs_url=None if PROD else "/docs",
    redoc_url=None if PROD else "/redoc",
    openapi_url=None if PROD else "/openapi.json",
)

# CORS: en producción el frontend sale del mismo origen (no hace falta); solo se abre si se indica.
if not PROD:
    app.add_middleware(
        CORSMiddleware, allow_origin_regex=settings.CORS_ORIGIN_REGEX, allow_methods=["*"], allow_headers=["*"]
    )
elif settings.CORS_ORIGINS.strip():
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[o.strip() for o in settings.CORS_ORIGINS.split(",") if o.strip()],
        allow_methods=["*"],
        allow_headers=["*"],
    )


@app.middleware("http")
async def cabeceras_de_seguridad(request: Request, call_next):
    respuesta = await call_next(request)
    respuesta.headers.setdefault("X-Content-Type-Options", "nosniff")
    respuesta.headers.setdefault("X-Frame-Options", "DENY")
    respuesta.headers.setdefault("Referrer-Policy", "same-origin")
    if request.url.path.startswith("/api/"):
        respuesta.headers.setdefault("Cache-Control", "no-store")  # datos de personas: no se guardan en caché
    return respuesta


app.include_router(auth.router, prefix="/api/v1")
app.include_router(vendedores.router, prefix="/api/v1")
app.include_router(estructura.router, prefix="/api/v1")
app.include_router(asistencia.router, prefix="/api/v1")
app.include_router(rotacion.router, prefix="/api/v1")
app.include_router(documentos.router, prefix="/api/v1")


@app.get("/api/health", include_in_schema=False)
def salud():
    """Para monitoreo: responde 200 si el servicio y su base de datos funcionan."""
    try:
        with engine.connect() as c:
            c.execute(text("SELECT 1"))
    except Exception as e:  # noqa: BLE001
        log.error("health: la BD no responde: %s", e)
        raise HTTPException(503, "Base de datos no disponible") from e
    return {"estado": "ok", "version": VERSION}


# ── Frontend compilado (producción): todo en un solo puerto ──────────────────
def _carpeta_frontend() -> Path | None:
    if not PROD:
        return None
    base = Path(settings.FRONTEND_DIST) if settings.FRONTEND_DIST else Path(__file__).resolve().parents[2] / "frontend" / "dist"
    return base if (base / "index.html").is_file() else None


_dist = _carpeta_frontend()
if PROD and _dist is None:
    log.info("Modo solo API: no hay frontend compilado junto al backend (lo sirve otro servidor, p. ej. nginx).")
if _dist is not None:
    if (_dist / "assets").is_dir():
        app.mount("/assets", StaticFiles(directory=_dist / "assets"), name="assets")

    @app.get("/{ruta:path}", include_in_schema=False)
    def frontend(ruta: str):
        if ruta.startswith("api/"):
            raise HTTPException(404, "No encontrado")
        archivo = (_dist / ruta).resolve()
        if ruta and archivo.is_file() and _dist.resolve() in archivo.parents:
            return FileResponse(archivo)
        return FileResponse(_dist / "index.html", headers={"Cache-Control": "no-cache"})  # SPA: rutas de React
