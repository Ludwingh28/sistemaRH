"""Vacía los DATOS DE VENDEDORES de la base del sistema RH (vendedores, contratos e historial) para volver a cargar el Excel.

    python limpiar_vendedores.py                # solo muestra qué borraría
    python limpiar_vendedores.py --confirmo     # lo borra de verdad

Se conservan: usuarios (el admin), estructura de regionales y equipos, feriados y la bitácora de seguridad.
NO toca la base del BI ni las carpetas de contratos de la unidad compartida (esas se borran a mano si hace falta).
Con ENTORNO=produccion exige además --produccion, para que no se ejecute por accidente en el servidor.
"""
import argparse
import sys

from sqlalchemy import text

TABLAS = ("historial_vendedor", "contratos", "vendedores")  # en orden de dependencia


def limpiar(engine, confirmado: bool) -> dict[str, int]:
    """Devuelve cuántas filas tenía cada tabla; solo las borra si `confirmado`."""
    with engine.begin() as c:
        existentes = {t for t in TABLAS if c.dialect.has_table(c, t)}
        conteo = {t: c.scalar(text(f"select count(*) from {t}")) for t in TABLAS if t in existentes}
        if confirmado:
            for t in TABLAS:
                if t in existentes:
                    c.execute(text(f"delete from {t}"))
    return conteo


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--confirmo", action="store_true", help="borrar de verdad (sin esto solo se muestra)")
    ap.add_argument("--produccion", action="store_true", help="permitir ejecutarlo con ENTORNO=produccion")
    a = ap.parse_args()

    from app.core.config import settings
    from app.core.database import engine

    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if settings.DB_NAME and settings.APP_DB_NAME == settings.DB_NAME:
        sys.exit("APP_DB_NAME coincide con la base del BI (DB_NAME): se aborta por seguridad.")
    if settings.es_produccion and a.confirmo and not a.produccion:
        sys.exit("ENTORNO=produccion: agrega --produccion si de verdad quieres vaciar los vendedores de ESTA base.")
    print(f"Base del sistema RH: {settings.APP_DB_NAME} en {settings.APP_DB_HOST} (entorno: {settings.ENTORNO})")
    antes = limpiar(engine, confirmado=a.confirmo)
    for t, n in antes.items():
        print(f"  {t:22s} {n} filas" + (" → borradas" if a.confirmo else ""))
    if not a.confirmo:
        print("\nNo se borró nada. Para borrar: python limpiar_vendedores.py --confirmo")
    else:
        print("\nListo. Se conservaron usuarios, estructura, feriados y bitácora. Las carpetas de la unidad compartida no se tocaron.")


if __name__ == "__main__":
    main()
