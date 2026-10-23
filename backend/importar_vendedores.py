"""Importa vendedores desde el Excel de RRHH por línea de comandos (lo mismo que el botón «Importar Excel» del sistema).

    python importar_vendedores.py "../recurses/9. Septiembre.xlsx"                  # simulación (no escribe)
    python importar_vendedores.py "../recurses/9. Septiembre.xlsx" --aplicar        # carga en la base
    python importar_vendedores.py archivo.xlsx --aplicar --corregir-fechas          # además corrige día/mes invertidos

Es repetible: crea los vendedores nuevos y actualiza los existentes. Ver app/services/importacion.py.
"""
import argparse
import sys
from pathlib import Path

from app.core.database import SessionLocal
from app.services import carpetas, importacion


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("archivo")
    ap.add_argument("--aplicar", action="store_true", help="escribir en la base (sin esto es solo simulación)")
    ap.add_argument("--corregir-fechas", action="store_true", help="invertir día/mes en fechas de ingreso futuras")
    a = ap.parse_args()
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    try:
        datos = importacion.leer_excel(Path(a.archivo).read_bytes())
    except (OSError, importacion.ErrorExcel) as e:
        sys.exit(f"No se pudo leer {a.archivo}: {e}")

    with SessionLocal() as db:
        plan = importacion.planificar(db, datos, a.corregir_fechas)
        r = importacion.resumen(plan)
        print(f"\nArchivo: {a.archivo}")
        print(f"Filas leídas: {r['filas_leidas']} | nuevos: {len(r['nuevos'])} | a actualizar: {len(r['actualizados'])} | "
              f"sin cambios: {r['sin_cambios']} | omitidas: {r['omitidos']} | bajas: {r['bajas']}")
        print("Nuevos por equipo:", r["por_equipo"])
        for c in r["actualizados"]:
            print(f"  [ACTUALIZA] fila {c['fila']:>3} · cód {c['codigo']:<6} · {c['nombre'][:30]:<30} · " + "; ".join(c["cambios"]))
        for o in r["observaciones"]:
            print(f"  [{o['nivel']:<9}] fila {o['fila']:>3} · cód {o['codigo']:<6} · {o['nombre'][:30]:<30} · {o['mensaje']}")
        if not a.aplicar:
            print("\nSIMULACIÓN: no se escribió nada. Usa --aplicar para cargar.")
            return
        creados = importacion.aplicar(db, plan, "importacion")["nuevos"]
        db.commit()
        if carpetas.configurada():
            for v in creados:
                carpetas.asegurar_al_crear(db, v)
            db.commit()
        print(f"\nCARGADO: {len(creados)} vendedores nuevos y {len(r['actualizados'])} actualizados.")


if __name__ == "__main__":
    main()
