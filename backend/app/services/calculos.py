"""Reglas de negocio de contratos y calendario laboral."""
from datetime import date, timedelta

DIAS_POR_VENCER = 30  # a partir de aquí un contrato se considera "por vencer"
DIAS_NUEVO = 30  # un vendedor es "nuevo" si su primer contrato empezó hace menos de esto
MOTIVOS_BAJA = [
    "BAJO DESEMPEÑO",
    "COMPETITIVIDAD SALARIAL",
    "MOTIVOS DE SALUD",
    "ABANDONO DE PUESTO",
    "DESARROLLO PROFESIONAL",
    "FIN DE CONTRATO",
    "OTRO",
]


def sumar_anios(d: date, anios: int = 1) -> date:
    try:
        return d.replace(year=d.year + anios)
    except ValueError:  # 29 de febrero
        return d.replace(year=d.year + anios, day=28)


def fin_contrato_por_defecto(inicio: date) -> date:
    """Contrato de 1 año: del 8/4/2026 al 7/4/2027 (el último día es la víspera del aniversario)."""
    return sumar_anios(inicio) - timedelta(days=1)


def estado_contrato(fecha_fin: date, vigente: bool, hoy: date | None = None) -> tuple[str, int]:
    """(estado, días para vencer) del contrato actual de un vendedor.

    estado: retirado | vencido | por_vencer | vigente
    """
    hoy = hoy or date.today()
    dias = (fecha_fin - hoy).days
    if not vigente:
        return "retirado", dias
    if dias < 0:
        return "vencido", dias
    if dias <= DIAS_POR_VENCER:
        return "por_vencer", dias
    return "vigente", dias


def es_dia_laborable(d: date, feriados: set[date]) -> bool:
    """Lunes a sábado, salvo feriados."""
    return d.weekday() < 6 and d not in feriados


# La fecha de baja es el primer dia SIN trabajar (asi lo cuenta el reporte de RRHH:
# un ingreso del 3/9 y salida del 14/9 suma 9 dias habiles, de 3/9 a 13/9).
BAJA_INCLUSIVA = False


def ultimo_dia_activo(fecha_baja: date | None) -> date | None:
    if fecha_baja is None:
        return None
    return fecha_baja if BAJA_INCLUSIVA else fecha_baja - timedelta(days=1)


def dias_habiles(desde: date, hasta: date, feriados: set[date]) -> int:
    n, d = 0, desde
    while d <= hasta:
        n += es_dia_laborable(d, feriados)
        d += timedelta(days=1)
    return n
