"""Acceso de solo lectura a la BD del BI (PostgreSQL).

Asistencia = días distintos con pedido/preventa del vendedor en dual.fact_detalle_pedidos.
Llave: fact_detalle_pedidos.codigo_vendedor == Vendedor.codigo_vendedor (código ERP).
SUPUESTO por confirmar: no se filtra por estado del pedido (anulados, etc.).
"""
from datetime import date

from sqlalchemy import text

from app.core.database import bi_engine


def _engine():
    if bi_engine is None:
        raise RuntimeError("La conexión al BI no está configurada (revisa DB_HOST, DB_NAME y DB_USER en .env)")
    return bi_engine


def fechas_preventa_por_vendedor(codigos: list[str], desde: date, hasta: date) -> dict[str, set[date]]:
    """Fechas distintas con pedido por vendedor (matriz de asistencia), en una sola consulta."""
    if not codigos:
        return {}
    query = text(
        """
        SELECT DISTINCT fdp.codigo_vendedor AS codigo, fdp.fecha_transaccion::date AS fecha
        FROM dual.fact_detalle_pedidos fdp
        WHERE fdp.codigo_vendedor = ANY(:codigos)
          AND fdp.fecha_transaccion::date BETWEEN :desde AND :hasta
        """
    )
    resultado: dict[str, set[date]] = {}
    with _engine().connect() as conn:
        for r in conn.execute(query, {"codigos": codigos, "desde": desde, "hasta": hasta}):
            resultado.setdefault(r.codigo, set()).add(r.fecha)
    return resultado
