"""Prepara la base de datos: crea las tablas, la estructura DTS y el usuario administrador inicial.

    python seed.py

Es seguro repetirlo: no duplica nada ni toca datos existentes. No carga vendedores ni datos de prueba
(para cargar los vendedores desde el Excel de RRHH está importar_vendedores.py).
En producción exige una contraseña de administrador segura.
"""
import sys

from sqlalchemy import select, text

from app import models  # noqa: F401
from app.core.config import settings
from app.core.database import Base, SessionLocal, engine
from app.core.security import hash_password

ESTRUCTURA = {
    "La Paz": ["DTS El Alto", "DTS La Paz"],
    "Cochabamba": ["DTS Cochabamba"],
    "Santa Cruz": ["DTS 1", "DTS 2"],
}
CLAVES_DEBILES = {"cambia-esta-clave", "admin", "admin123", "password", "123456", "12345678", "1234", "postgres"}


def clave_admin_valida(clave: str | None) -> str | None:
    """Mensaje de error si la clave del administrador no sirve para producción; None si está bien."""
    if not clave:
        return "ADMIN_PASSWORD está vacía."
    if len(clave) < 10:
        return "ADMIN_PASSWORD debe tener al menos 10 caracteres."
    if clave.lower() in CLAVES_DEBILES or "cambia" in clave.lower():
        return "ADMIN_PASSWORD es una clave de ejemplo o muy común."
    return None


if settings.es_produccion:
    problema = clave_admin_valida(settings.ADMIN_PASSWORD)
    if problema and settings.ADMIN_USERNAME:
        sys.exit(f"No se crea el administrador en producción: {problema}")

Base.metadata.create_all(engine)

# create_all no agrega columnas a tablas que ya existen: migraciones ligeras para bases anteriores.
with engine.begin() as conn:
    conn.execute(text("ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS email VARCHAR(120)"))
    conn.execute(text("ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS ultimo_acceso TIMESTAMP"))
    conn.execute(text("ALTER TABLE feriados ADD COLUMN IF NOT EXISTS origen VARCHAR(20) NOT NULL DEFAULT 'manual'"))
    conn.execute(text("ALTER TABLE feriados ADD COLUMN IF NOT EXISTS tipo VARCHAR(60)"))
    conn.execute(text("ALTER TABLE feriados ADD COLUMN IF NOT EXISTS activo BOOLEAN NOT NULL DEFAULT true"))
    conn.execute(text("ALTER TABLE feriados ALTER COLUMN descripcion TYPE VARCHAR(160)"))
    conn.execute(text("ALTER TABLE vendedores ADD COLUMN IF NOT EXISTS carpeta_contratos VARCHAR(200)"))
    conn.execute(text("ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS debe_cambiar_clave BOOLEAN NOT NULL DEFAULT false"))
    conn.execute(text("ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS sesiones_desde TIMESTAMP"))
    conn.execute(text("DROP TABLE IF EXISTS contrato_documentos"))  # versión anterior: ahora se lee la carpeta directamente

with SessionLocal() as db:
    for regional, equipos in ESTRUCTURA.items():
        r = db.scalar(select(models.Regional).where(models.Regional.nombre == regional))
        if not r:
            r = models.Regional(nombre=regional)
            db.add(r)
            db.flush()
        for nombre in equipos:
            if not db.scalar(select(models.EquipoDTS).where(models.EquipoDTS.nombre == nombre)):
                db.add(models.EquipoDTS(nombre=nombre, regional_id=r.id))
    db.commit()
print("Estructura DTS lista.")

username, password = (settings.ADMIN_USERNAME or "").strip().lower(), settings.ADMIN_PASSWORD
with SessionLocal() as db:
    if username and password and not db.scalar(select(models.Usuario).where(models.Usuario.username == username)):
        db.add(models.Usuario(username=username, nombre="ADMINISTRADOR", rol=models.Rol.admin,
                              password_hash=hash_password(password)))
        db.commit()
        print(f"Administrador «{username}» creado.")
    else:
        print("Administrador: ya existía o no se definió ADMIN_USERNAME/ADMIN_PASSWORD (no se cambió nada).")
