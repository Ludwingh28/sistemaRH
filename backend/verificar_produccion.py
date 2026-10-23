"""Revisa que el servidor esté listo para producción. Ejecutar dentro de backend/ con el .env de producción:

    python verificar_produccion.py

Termina con código 0 si todo está bien y 1 si hay algo que corregir.
"""
import sys
from pathlib import Path

from sqlalchemy import create_engine, inspect, text

from app.core.config import settings

problemas: list[str] = []
avisos: list[str] = []


def ok(msg: str):
    print(f"  [OK]    {msg}")


def mal(msg: str):
    problemas.append(msg)
    print(f"  [FALLA] {msg}")


def aviso(msg: str):
    avisos.append(msg)
    print(f"  [AVISO] {msg}")


print("Configuración")
(ok if settings.es_produccion else mal)(f"ENTORNO = {settings.ENTORNO}" + ("" if settings.es_produccion else " (debe ser «produccion»)"))
if len(settings.SECRET_KEY) >= 32 and "cambia" not in settings.SECRET_KEY.lower():
    ok("SECRET_KEY segura")
else:
    mal("SECRET_KEY corta o de ejemplo (usa: python -c \"import secrets; print(secrets.token_hex(32))\")")
if settings.APP_DB_PASSWORD and settings.APP_DB_PASSWORD.lower() not in ("postgres", "password", "1234"):
    ok("APP_DB_PASSWORD definida y no trivial")
else:
    mal("APP_DB_PASSWORD vacía o débil")
if settings.ADMIN_PASSWORD:
    aviso("ADMIN_PASSWORD sigue en el .env: tras crear el administrador con seed.py, bórrala del archivo.")

print("Base de datos del sistema")
try:
    with create_engine(settings.DATABASE_URL, connect_args={"connect_timeout": 8}).connect() as c:
        c.execute(text("SELECT 1"))
    ok(f"conecta a {settings.APP_DB_HOST}:{settings.APP_DB_PORT}/{settings.APP_DB_NAME}")
    tablas = set(inspect(create_engine(settings.DATABASE_URL)).get_table_names())
    faltan = {"usuarios", "vendedores", "contratos", "equipos_dts", "feriados"} - tablas
    (mal if faltan else ok)("faltan tablas: " + ", ".join(sorted(faltan)) + " (ejecuta python seed.py)" if faltan else "tablas creadas")
    with create_engine(settings.DATABASE_URL).connect() as c:
        admins = c.execute(text("SELECT count(*) FROM usuarios WHERE rol = 'admin' AND activo")).scalar() if "usuarios" in tablas else 0
        (ok if admins else mal)(f"{admins} administrador(es) activo(s)" if admins else "no hay ningún administrador (ejecuta python seed.py)")
except Exception as e:  # noqa: BLE001
    mal(f"no se pudo conectar: {type(e).__name__}: {str(e)[:120]}")

print("BI (asistencia y ausentismo)")
if settings.BI_DATABASE_URL:
    try:
        with create_engine(settings.BI_DATABASE_URL, connect_args={"connect_timeout": 8}).connect() as c:
            c.execute(text("SELECT 1 FROM dual.fact_detalle_pedidos LIMIT 1"))
        ok("conecta y lee dual.fact_detalle_pedidos")
        if settings.DB_USER and "lector" not in settings.DB_USER.lower() and "readonly" not in settings.DB_USER.lower():
            aviso(f"el usuario del BI es «{settings.DB_USER}»: conviene uno de solo lectura creado para este sistema.")
    except Exception as e:  # noqa: BLE001
        mal(f"no se pudo leer el BI: {type(e).__name__}: {str(e)[:120]}")
else:
    mal("DB_HOST/DB_NAME/DB_USER del BI sin definir: Asistencia no funcionará")

print("Contratos (unidad compartida de RH)")
if settings.CONTRATOS_DIR:
    base = Path(settings.CONTRATOS_DIR)
    if base.is_dir():
        try:
            prueba = base / ".prueba_escritura"
            prueba.write_text("ok")
            prueba.unlink()
            ok(f"unidad {base} accesible y con permiso de escritura")
        except OSError as e:
            mal(f"la unidad {base} existe pero el servicio no puede escribir en ella: {e}")
        regionales, carpetas_v = 0, 0
        for reg in base.iterdir():
            if reg.is_dir() and not reg.name.startswith(("_", ".")):
                sub = reg / settings.CONTRATOS_SUBCARPETA
                if sub.is_dir():
                    regionales += 1
                    carpetas_v += sum(1 for p in sub.iterdir() if p.is_dir())
        if regionales:
            ok(f"{regionales} regional(es) con carpeta «{settings.CONTRATOS_SUBCARPETA}» y {carpetas_v} carpetas de vendedores")
        else:
            aviso(f"no hay ninguna «<regional>\\{settings.CONTRATOS_SUBCARPETA}» en {base}: se creará al registrar el primer vendedor o con «Crear las carpetas que faltan».")
    else:
        mal(f"la unidad {base} no existe o no es accesible (¿red compartida conectada?)")
else:
    aviso("CONTRATOS_DIR sin definir: no se podrán ver ni adjuntar contratos.")

print("Frontend")
dist = Path(settings.FRONTEND_DIST) if settings.FRONTEND_DIST else Path(__file__).resolve().parents[1] / "frontend" / "dist"
(ok if (dist / "index.html").is_file() else mal)(f"{dist} compilado" if (dist / "index.html").is_file() else f"no hay frontend compilado en {dist} (en frontend/: npm run build)")

print()
print(f"Resultado: {len(problemas)} falla(s), {len(avisos)} aviso(s).")
sys.exit(1 if problemas else 0)
