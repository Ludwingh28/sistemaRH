"""Revisa los retirados cuya fecha de baja no cuadra con el fin de su último contrato. Solo LEE: no cambia nada.

Sirve para encontrar vendedores a los que se les editó el «Fin» del contrato (antes de que existiera «Corregir baja»)
y cuya baja quedó con la fecha vieja: la asistencia y la rotación usan la baja, no el fin del contrato.

Uso (desde la carpeta backend, con el mismo entorno que el sistema):
    .\\.venv\\Scripts\\python.exe revisar_bajas.py

Por cada vendedor de la lista, ábrelo en el sistema y usa «Corregir baja» con la fecha que corresponda.
"""
import sys
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.core.database import SessionLocal
from app.models import Vendedor
from app.services.calculos import fin_contrato_por_defecto

sys.stdout.reconfigure(encoding="utf-8")


def main() -> None:
    hallados = 0
    with SessionLocal() as db:
        consulta = (
            select(Vendedor)
            .where(Vendedor.fecha_baja.is_not(None))
            .options(selectinload(Vendedor.contratos), selectinload(Vendedor.historial))
            .order_by(Vendedor.codigo_vendedor)
        )
        for v in db.scalars(consulta).unique():
            c = v.contrato_actual
            if not c or c.fecha_fin in (v.fecha_baja, v.fecha_baja - timedelta(days=1)):
                continue  # baja y contrato cuadran
            completo = c.fecha_fin >= fin_contrato_por_defecto(c.fecha_inicio)
            if completo and v.fecha_baja <= c.fecha_fin:
                continue  # se retiró antes de cumplir su año: es lo normal, no hay nada que revisar
            ediciones = [h for h in v.historial if h.evento == "contrato_editado"]
            hallados += 1
            print(f"{v.codigo_vendedor}  {v.nombre}")
            print(f"    baja registrada: {v.fecha_baja:%d/%m/%Y}   |   contrato nº {c.numero}: {c.fecha_inicio:%d/%m/%Y} -> {c.fecha_fin:%d/%m/%Y}")
            if c.fecha_fin < v.fecha_baja:
                print(f"    la asistencia corta el {c.fecha_fin:%d/%m/%Y} (fin del contrato) aunque la baja dice {v.fecha_baja:%d/%m/%Y}")
            for h in ediciones:
                print(f"    contrato modificado el {h.fecha:%d/%m/%Y} por {h.usuario or '?'}")
    if hallados:
        print(f"\n{hallados} vendedor(es) para revisar. Ábrelos y usa «Corregir baja» con la fecha correcta.")
    else:
        print("Todas las bajas cuadran con sus contratos.")


if __name__ == "__main__":
    main()
