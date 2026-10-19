"""Feriados de Bolivia (nacionales y departamentales) generados con la librería `holidays`.

Funciona sin internet, sin clave ni cuotas, y conoce los feriados de cada departamento
(14/9 Cochabamba, 24/9 Santa Cruz, 16/7 La Paz...). Se calculan una vez por año y se guardan en
`feriados` con origen "holidays"; se regeneran solos cuando cambia la versión de la librería (que es
como entran los decretos nuevos). Los manuales nunca se tocan y los automáticos se pueden desactivar.

Los "puentes" que el Gobierno decreta cada año (p. ej. el día siguiente a un feriado) no están en la
librería: se cargan a mano.
"""
import logging
from datetime import date, datetime, timezone

import holidays
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Feriado, FeriadoSync, Regional

log = logging.getLogger(__name__)

PAIS = "BO"
FUENTE = f"python-holidays {holidays.__version__}"

# Regional del sistema -> código de departamento (ISO 3166-2:BO). El Alto pertenece a La Paz.
REGIONAL_A_DEPARTAMENTO = {"Cochabamba": "C", "La Paz": "L", "Santa Cruz": "S"}
ORIGEN = "holidays"


def _ahora() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)  # UTC sin zona, como las demás columnas


def _de(anio: int, departamento: str | None) -> dict[date, str]:
    return dict(holidays.country_holidays(PAIS, subdiv=departamento, years=anio, language="es"))


def generar(anio: int, regionales: list[Regional]) -> list[dict]:
    """Feriados del año: los nacionales (regional_id=None) y los exclusivos de cada departamento."""
    nacionales = _de(anio, None)
    filas = [
        {"fecha": f, "regional_id": None, "descripcion": nombre.upper()[:160], "tipo": "Nacional"}
        for f, nombre in sorted(nacionales.items())
    ]
    for r in regionales:
        depto = REGIONAL_A_DEPARTAMENTO.get(r.nombre)
        if not depto:
            continue
        for f, nombre in sorted(_de(anio, depto).items()):
            if f not in nacionales:  # solo lo propio del departamento
                filas.append({"fecha": f, "regional_id": r.id, "descripcion": nombre.upper()[:160], "tipo": "Departamental"})
    return filas


# ── Estado y sincronización ──────────────────────────────────────────────────

def ultima_sync(db: Session, anio: int) -> FeriadoSync | None:
    return db.scalar(
        select(FeriadoSync).where(FeriadoSync.anio == anio, FeriadoSync.ok.is_(True)).order_by(FeriadoSync.fecha_hora.desc()).limit(1)
    )


def desactualizado(db: Session, anio: int) -> bool:
    """True si el año nunca se generó o se generó con otra versión de la librería."""
    ultima = ultima_sync(db, anio)
    return ultima is None or (ultima.mensaje or "") != FUENTE


def sincronizar(db: Session, anio: int, usuario: str | None = None) -> FeriadoSync:
    """Regenera los feriados automáticos del año. Conserva el interruptor `activo` de los que siguen existiendo."""
    rango = (date(anio, 1, 1), date(anio, 12, 31))
    regionales = list(db.scalars(select(Regional)))
    filas = generar(anio, regionales)

    del_anio = list(db.scalars(select(Feriado).where(Feriado.fecha.between(*rango))))
    automaticos = {(f.fecha, f.regional_id): f for f in del_anio if f.origen == ORIGEN}
    manuales = {(f.fecha, f.regional_id) for f in del_anio if f.origen == "manual"}

    vigentes, guardados = set(), 0
    for fila in filas:
        clave = (fila["fecha"], fila["regional_id"])
        if clave in manuales:
            continue  # ya lo cargó una persona
        vigentes.add(clave)
        if clave in automaticos:
            automaticos[clave].descripcion, automaticos[clave].tipo = fila["descripcion"], fila["tipo"]
        else:
            db.add(Feriado(origen=ORIGEN, activo=True, **fila))
        guardados += 1
    for clave, f in automaticos.items():
        if clave not in vigentes:
            db.delete(f)

    registro = FeriadoSync(anio=anio, ok=True, cantidad=guardados, usuario=usuario, mensaje=FUENTE)
    db.add(registro)
    db.commit()
    db.refresh(registro)
    return registro


def sincronizar_si_corresponde(db: Session, anio: int) -> None:
    """Genera el año si falta o si cambió la versión de la librería. Es instantáneo y no usa red."""
    if desactualizado(db, anio):
        try:
            sincronizar(db, anio)
        except Exception:  # un fallo aquí no debe impedir consultar la asistencia
            db.rollback()
            log.exception("No se pudieron generar los feriados de %s", anio)
