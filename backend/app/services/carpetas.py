"""Carpetas de contratos de cada vendedor en la unidad compartida de RH.

    <CONTRATOS_DIR>\\Vendedores\\<NOMBRE DEL VENDEDOR>\\Contratos\\<archivos>

La base guarda solo el nombre de la carpeta del vendedor (`vendedores.carpeta_contratos`, relativo a
`Vendedores`), nunca una ruta absoluta: así el sistema sigue funcionando si cambia la letra de la unidad o
el servidor, y no se rompe si luego se corrige el nombre del vendedor. Los archivos se leen en vivo de la
carpeta: RH puede dejar ahí los contratos directamente, sin pasar por el sistema.
"""
import logging
import re
import unicodedata
from datetime import datetime
from pathlib import Path

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models import Vendedor

log = logging.getLogger("rh.carpetas")

# Firma (primeros bytes) de cada formato: un «.pdf» debe empezar como PDF.
FIRMAS = {".pdf": b"%PDF-", ".jpg": b"\xff\xd8\xff", ".jpeg": b"\xff\xd8\xff", ".png": b"\x89PNG", ".docx": b"PK", ".doc": b"\xd0\xcf\x11\xe0"}

# Tipos de documento que se guardan en la carpeta de cada vendedor. Hoy solo contratos, en PDF. Para sumar otro
# (p. ej. documentos personales) basta agregar una entrada aquí: se crea su subcarpeta junto a «Contratos» y el
# panel puede mostrarla con <Documentos categoria="..."/>. Lo que RH ya tenga en la carpeta siempre se lista.
CATEGORIAS: dict[str, dict] = {
    "contratos": {"titulo": "Contratos firmados", "carpeta": settings.CONTRATOS_CARPETA_FINAL, "extensiones": {".pdf"}},
}
TIPOS = {".pdf": "application/pdf", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
         ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ".doc": "application/msword"}
CARPETA_ELIMINADOS = "_eliminados"
_INVALIDOS = re.compile(r'[<>:"/\\|?*\x00-\x1f]')


def normalizar(texto: str) -> str:
    """Para comparar nombres: sin acentos, en mayúsculas y con espacios simples."""
    t = unicodedata.normalize("NFKD", texto).encode("ascii", "ignore").decode().upper()
    return re.sub(r"\s+", " ", t).strip()


def nombre_de_carpeta(nombre: str) -> str:
    """Nombre válido en Windows a partir del nombre del vendedor (conserva acentos y Ñ)."""
    limpio = re.sub(r"\s+", " ", _INVALIDOS.sub(" ", nombre)).strip().rstrip(". ")
    return limpio[:150] or "SIN NOMBRE"


def nombre_de_archivo(nombre: str) -> str:
    base = Path(nombre.replace("\\", "/")).name  # nunca una ruta
    return nombre_de_carpeta(base) or "archivo"


def configurada() -> bool:
    return bool(settings.CONTRATOS_DIR)


def raiz() -> Path:
    """<CONTRATOS_DIR>\\Vendedores. Debe existir (la crea RH o el administrador, no el sistema)."""
    if not settings.CONTRATOS_DIR:
        raise HTTPException(409, "La carpeta de contratos no está configurada (CONTRATOS_DIR en el .env del backend).")
    base = Path(settings.CONTRATOS_DIR)
    try:
        existe = base.is_dir()
    except OSError:
        existe = False
    if not existe:
        raise HTTPException(503, "La unidad de contratos no está disponible. Revisa que la red compartida esté conectada.")
    return base / settings.CONTRATOS_SUBCARPETA


def categoria(clave: str) -> dict:
    datos = CATEGORIAS.get(clave)
    if not datos:
        raise HTTPException(404, "Tipo de documento desconocido")
    return datos


def ruta_red(carpeta: str | None = None, clave: str = "contratos") -> str | None:
    """Ruta tal como la ven RH en sus PCs (para mostrarla), no la del servidor."""
    base = settings.CONTRATOS_RUTA_RED or settings.CONTRATOS_DIR
    if not base:
        return None
    partes = [base.rstrip("\\/"), settings.CONTRATOS_SUBCARPETA]
    if carpeta:
        partes += [carpeta, categoria(clave)["carpeta"]]
    return "\\".join(partes)


def _dentro(base: Path, ruta: Path) -> Path:
    r = ruta.resolve()
    if base.resolve() not in r.parents and r != base.resolve():
        raise HTTPException(400, "Ruta no válida")
    return r


def carpetas_existentes() -> dict[str, str]:
    """{nombre normalizado: nombre real} de las carpetas dentro de Vendedores."""
    base = raiz()
    if not base.is_dir():
        return {}
    return {normalizar(p.name): p.name for p in base.iterdir() if p.is_dir() and not p.name.startswith(("_", "."))}


def _ocupada(db: Session, real: str, v: Vendedor) -> bool:
    """¿Otro vendedor ya usa esa carpeta? (dos personas con el mismo nombre no comparten carpeta)."""
    return db.scalar(select(Vendedor.id).where(Vendedor.carpeta_contratos == real, Vendedor.id != v.id).limit(1)) is not None


def carpeta_de(db: Session, v: Vendedor, base: Path | None = None) -> str | None:
    """Nombre real de la carpeta del vendedor, si ya existe. Si coincide EXACTO por nombre (sin acentos ni
    mayúsculas) con una carpeta de RH que nadie más usa, la toma y la deja guardada en `v.carpeta_contratos`."""
    base = base or raiz()
    if v.carpeta_contratos and (base / v.carpeta_contratos).is_dir():
        return v.carpeta_contratos
    real = carpetas_existentes().get(normalizar(v.nombre))
    if real and not _ocupada(db, real, v):
        v.carpeta_contratos = real
        return real
    return None


def ruta_contratos(db: Session, v: Vendedor, crear: bool = False, clave: str = "contratos") -> Path | None:
    """Carpeta `…\<nombre>\Contratos` del vendedor. Con `crear=True` la crea si falta."""
    base = raiz()
    nombre = carpeta_de(db, v, base)
    if nombre is None:
        if not crear:
            return None
        nombre = nombre_de_carpeta(v.nombre)
        if normalizar(nombre) in carpetas_existentes():
            nombre = f"{nombre} ({v.codigo_vendedor})"  # homónimo: otra carpeta ya usa ese nombre
        v.carpeta_contratos = nombre
    destino = _dentro(base, base / nombre / categoria(clave)["carpeta"])
    if crear:
        try:
            destino.mkdir(parents=True, exist_ok=True)
        except OSError as e:
            log.error("No se pudo crear %s: %s", destino, e)
            raise HTTPException(503, "No se pudo crear la carpeta en la unidad compartida (revisa permisos y conexión).") from e
    return destino if destino.is_dir() else None


def asegurar_al_crear(db: Session, v: Vendedor) -> str | None:
    """Al registrar un vendedor nuevo se crea su carpeta. Si la unidad no está disponible, el alta NO falla:
    la carpeta se crea después (botón en la ficha o «Crear carpetas faltantes»). Devuelve un aviso o None."""
    if not configurada():
        return None
    try:
        for clave in CATEGORIAS:  # la carpeta del vendedor con una subcarpeta por tipo de documento
            ruta_contratos(db, v, crear=True, clave=clave)
        return None
    except HTTPException as e:
        log.warning("Carpeta de contratos de %s no creada: %s", v.codigo_vendedor, e.detail)
        return str(e.detail)


def listar(ruta: Path | None) -> list[dict]:
    if ruta is None or not ruta.is_dir():
        return []
    archivos = []
    for p in sorted(ruta.iterdir(), key=lambda x: x.name.lower()):
        if p.is_file() and not p.name.startswith((".", "~$")) and p.suffix.lower() != ".tmp":
            st = p.stat()
            archivos.append({
                "nombre": p.name, "tamano": st.st_size, "tipo": TIPOS.get(p.suffix.lower(), "application/octet-stream"),
                "modificado": datetime.fromtimestamp(st.st_mtime),
            })
    return archivos


def archivo_seguro(ruta: Path, nombre: str) -> Path:
    """Archivo dentro de la carpeta del vendedor; rechaza cualquier intento de salir de ella."""
    if not nombre or nombre != Path(nombre.replace("\\", "/")).name:
        raise HTTPException(400, "Nombre de archivo no válido")
    destino = _dentro(ruta, ruta / nombre)
    if not destino.is_file():
        raise HTTPException(404, "El archivo ya no está en la carpeta")
    return destino


def validar_contenido(nombre: str, contenido: bytes, clave: str = "contratos") -> str:
    """Extensión permitida para ese tipo de documento y contenido coherente con ella."""
    ext = Path(nombre).suffix.lower()
    permitidas = categoria(clave)["extensiones"]
    if ext not in permitidas:
        raise HTTPException(422, "Solo se aceptan archivos " + ", ".join(sorted(e[1:].upper() for e in permitidas)) + ".")
    if not contenido.startswith(FIRMAS[ext]):
        raise HTTPException(422, f"El archivo no es un {ext[1:].upper()} válido")
    return ext
