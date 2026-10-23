"""Carpetas de contratos de cada vendedor en la unidad compartida de RH.

    <CONTRATOS_DIR>\\<REGIONAL>\\Vendedores\\<NOMBRE DEL VENDEDOR>\\Contratos\\<archivos>

    p. ej.  E:\\Docs_RRHH\\Santa Cruz\\Vendedores\\JUAN PEREZ\\Contratos\\Contrato 2026.pdf

Cada regional (Santa Cruz, Cochabamba, La Paz…) tiene su carpeta; si se abre otra regional, su carpeta se crea
sola al registrar a su primer vendedor. La base guarda solo la ruta relativa de la carpeta del vendedor
(`vendedores.carpeta_contratos`, p. ej. «Santa Cruz/JUAN PEREZ»), nunca una ruta absoluta: así el sistema sigue
funcionando si cambia la letra de la unidad o el servidor, y no se rompe si luego se corrige el nombre del
vendedor ni si el vendedor pasa a otra regional (su carpeta se queda donde está; no se mueve nada solo). Los
archivos se leen en vivo de la carpeta: RH puede dejar ahí los contratos directamente, sin pasar por el sistema.
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
    "contratos": {"titulo": "Contratos firmados", "carpeta": settings.CONTRATOS_CARPETA_FINAL, "extensiones": {".pdf"}, "corto": "Contrato"},
    # Documentación que cada vendedor debe entregar (panel «Documentación»): una subcarpeta por documento, todos en PDF.
    "kardex": {"titulo": "Kardex", "carpeta": "Kardex", "extensiones": {".pdf"}, "corto": "Kardex"},
    "ci": {"titulo": "Cédula de identidad (CI)", "carpeta": "CI", "extensiones": {".pdf"}, "corto": "CI"},
    "fachada": {"titulo": "Fachada", "carpeta": "Fachada", "extensiones": {".pdf"}, "corto": "Fachada"},
    "ubicacion": {"titulo": "Ubicación", "carpeta": "Ubicación", "extensiones": {".pdf"}, "corto": "Ubicación"},
}
# Documentos que entran en la matriz del panel (el contrato se gestiona aparte, en la ficha del vendedor)
DOCUMENTACION = ["kardex", "ci", "fachada", "ubicacion"]
TIPOS = {".pdf": "application/pdf", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
         ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ".doc": "application/msword"}
CARPETA_ELIMINADOS = "_eliminados"
_INVALIDOS = re.compile(r'[<>:"/\\|?*\x00-\x1f]')


def normalizar(texto: str) -> str:
    """Para comparar nombres: sin acentos, en mayúsculas y con espacios simples."""
    t = unicodedata.normalize("NFKD", texto).encode("ascii", "ignore").decode().upper()
    return re.sub(r"\s+", " ", t).strip()


def partes_rel(rel: str) -> list[str]:
    """«Santa Cruz/JUAN PEREZ» -> ['Santa Cruz', 'JUAN PEREZ'] (acepta / y \\)."""
    return [p for p in re.split(r"[\\/]", rel) if p and p not in (".", "..")]


def normalizar_rel(rel: str) -> str:
    return "/".join(normalizar(p) for p in partes_rel(rel))


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
    """<CONTRATOS_DIR>: la unidad de RH, donde viven las carpetas de cada regional. Debe existir (la crea RH o
    el administrador, no el sistema)."""
    if not settings.CONTRATOS_DIR:
        raise HTTPException(409, "La carpeta de contratos no está configurada (CONTRATOS_DIR en el .env del backend).")
    base = Path(settings.CONTRATOS_DIR)
    try:
        existe = base.is_dir()
    except OSError:
        existe = False
    if not existe:
        raise HTTPException(503, "La unidad de contratos no está disponible. Revisa que la red compartida esté conectada.")
    return base


def categoria(clave: str) -> dict:
    datos = CATEGORIAS.get(clave)
    if not datos:
        raise HTTPException(404, "Tipo de documento desconocido")
    return datos


def regional_de(v: Vendedor) -> str:
    return v.equipo.regional.nombre


def ruta_red(rel: str | None = None, clave: str = "contratos", regional: str | None = None) -> str | None:
    """Ruta tal como la ven RH en sus PCs (para mostrarla), no la del servidor."""
    base = settings.CONTRATOS_RUTA_RED or settings.CONTRATOS_DIR
    if not base:
        return None
    partes = [base.rstrip("\\/")]
    if rel:
        p = partes_rel(rel)
        reg, nombre = (p[0], p[-1]) if len(p) >= 2 else (regional or "", p[0] if p else "")
        partes += [x for x in (reg, settings.CONTRATOS_SUBCARPETA, nombre, categoria(clave)["carpeta"]) if x]
    return "\\".join(partes)


def _dentro(base: Path, ruta: Path) -> Path:
    r = ruta.resolve()
    if base.resolve() not in r.parents and r != base.resolve():
        raise HTTPException(400, "Ruta no válida")
    return r


def _ruta_vendedor(base: Path, rel: str, regional_defecto: str) -> Path:
    """Carpeta del vendedor (sin la subcarpeta del tipo de documento). Un valor antiguo sin regional
    («JUAN PEREZ») se busca dentro de la regional actual del vendedor."""
    p = partes_rel(rel)
    reg, nombre = (p[0], p[-1]) if len(p) >= 2 else (regional_defecto, p[0] if p else "")
    return base / reg / settings.CONTRATOS_SUBCARPETA / nombre


def _es_vendedores(nombre: str) -> bool:
    return normalizar(nombre) == normalizar(settings.CONTRATOS_SUBCARPETA)


def regional_real(base: Path, regional: str) -> str:
    """Nombre con el que la regional ya existe en la unidad (sin importar mayúsculas ni acentos); si no
    existe todavía, el nombre de la regional tal cual."""
    norm_ = normalizar(regional)
    try:
        for p in base.iterdir():
            if p.is_dir() and normalizar(p.name) == norm_:
                return p.name
    except OSError:
        pass
    return nombre_de_carpeta(regional)


def carpetas_existentes() -> dict[str, str]:
    """{«regional/vendedor» normalizado: «Regional/Vendedor» real} de las carpetas de vendedores de todas las
    regionales (<unidad>\\<regional>\\Vendedores\\<vendedor>)."""
    base = raiz()
    salida: dict[str, str] = {}
    try:
        regionales = [p for p in base.iterdir() if p.is_dir() and not p.name.startswith(("_", "."))]
        for reg in regionales:
            for sub in reg.iterdir():
                if sub.is_dir() and _es_vendedores(sub.name):
                    for vend in sub.iterdir():
                        if vend.is_dir() and not vend.name.startswith(("_", ".")):
                            salida[f"{normalizar(reg.name)}/{normalizar(vend.name)}"] = f"{reg.name}/{vend.name}"
    except OSError as e:
        log.warning("No se pudo leer la unidad de contratos: %s", e)
    return salida


def clave_vendedor(v: Vendedor) -> str:
    return f"{normalizar(regional_de(v))}/{normalizar(v.nombre)}"


def _ocupada(db: Session, real: str, v: Vendedor) -> bool:
    """¿Otro vendedor ya usa esa carpeta? (dos personas con el mismo nombre no comparten carpeta)."""
    return db.scalar(select(Vendedor.id).where(Vendedor.carpeta_contratos == real, Vendedor.id != v.id).limit(1)) is not None


def tiene_carpeta(v: Vendedor, base: Path, existentes: dict[str, str]) -> bool:
    """Solo consulta (no vincula nada): ¿el vendedor tiene su carpeta, ya vinculada o con su nombre exacto?"""
    if v.carpeta_contratos and _ruta_vendedor(base, v.carpeta_contratos, regional_de(v)).is_dir():
        return True
    return clave_vendedor(v) in existentes


def rutas_categorias(v: Vendedor, base: Path, existentes: dict[str, str]) -> dict[str, Path | None]:
    """Solo consulta (no crea ni vincula nada): la carpeta de cada tipo de documento del vendedor, o None si no existe."""
    rel = v.carpeta_contratos if v.carpeta_contratos and _ruta_vendedor(base, v.carpeta_contratos, regional_de(v)).is_dir() else existentes.get(clave_vendedor(v))
    if not rel:
        return {k: None for k in CATEGORIAS}
    raiz_v = _ruta_vendedor(base, rel, regional_de(v))
    return {k: (raiz_v / c["carpeta"] if (raiz_v / c["carpeta"]).is_dir() else None) for k, c in CATEGORIAS.items()}


def carpeta_de(db: Session, v: Vendedor, base: Path | None = None, existentes: dict[str, str] | None = None) -> str | None:
    """Ruta relativa de la carpeta del vendedor («Regional/NOMBRE»), si ya existe. Si coincide EXACTO por regional
    y nombre (sin acentos ni mayúsculas) con una carpeta de RH que nadie más usa, la toma y la deja guardada en
    `v.carpeta_contratos`."""
    base = base or raiz()
    if v.carpeta_contratos and _ruta_vendedor(base, v.carpeta_contratos, regional_de(v)).is_dir():
        return v.carpeta_contratos
    existentes = carpetas_existentes() if existentes is None else existentes
    real = existentes.get(clave_vendedor(v))
    if real and not _ocupada(db, real, v):
        v.carpeta_contratos = real
        return real
    return None


def ruta_contratos(db: Session, v: Vendedor, crear: bool = False, clave: str = "contratos") -> Path | None:
    """Carpeta `…\\<regional>\\Vendedores\\<nombre>\\Contratos` del vendedor. Con `crear=True` la crea si falta
    (y también la carpeta de la regional, si es la primera vez que se usa)."""
    base = raiz()
    rel = carpeta_de(db, v, base)
    if rel is None:
        if not crear:
            return None
        existentes = carpetas_existentes()
        reg = regional_real(base, regional_de(v))
        nombre = nombre_de_carpeta(v.nombre)
        rel = f"{reg}/{nombre}"
        if normalizar_rel(rel) in existentes:
            rel = f"{reg}/{nombre} ({v.codigo_vendedor})"  # homónimo: otra carpeta ya usa ese nombre
        v.carpeta_contratos = rel
    destino = _dentro(base, _ruta_vendedor(base, rel, regional_de(v)) / categoria(clave)["carpeta"])
    if crear:
        try:
            destino.mkdir(parents=True, exist_ok=True)
        except OSError as e:
            log.error("No se pudo crear %s: %s", destino, e)
            raise HTTPException(503, "No se pudo crear la carpeta en la unidad compartida (revisa permisos y conexión).") from e
    return destino if destino.is_dir() else None


def estructura_vendedor(db: Session, v: Vendedor) -> tuple[bool, int]:
    """Deja completa la estructura del vendedor: su carpeta (si falta) y la subcarpeta de cada tipo de documento.
    Devuelve (¿se creó su carpeta?, cuántas subcarpetas de documento se crearon). No toca lo que ya existe."""
    existia = carpeta_de(db, v) is not None
    creadas = 0
    for clave in CATEGORIAS:
        if ruta_contratos(db, v, crear=False, clave=clave) is None:
            ruta_contratos(db, v, crear=True, clave=clave)
            creadas += 1
    return (not existia, creadas)


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
