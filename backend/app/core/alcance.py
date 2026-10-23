"""Alcance geográfico de un usuario: ve TODO el país («nacional») o solo ciertas regionales.

El alcance se define al crear la cuenta (el admin siempre es nacional) y limita todos los datos: vendedores,
contratos, asistencia, rotación, documentación, feriados y la estructura (zonas y equipos) que ve en los filtros.
Se fija en cada petición (`usuario_actual` lo guarda en `db.info`) y las consultas lo leen con `alcance_de(db)`;
lo que queda fuera del alcance se comporta como si no existiera (404), sin revelar que está.
"""
from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.models import EquipoDTS, Feriado, Rol, Usuario, Vendedor


@dataclass(frozen=True)
class Alcance:
    ids: frozenset[int] | None = None  # ids de regionales permitidas; None = nacional (todas)

    @property
    def nacional(self) -> bool:
        return self.ids is None

    def permite(self, regional_id: int) -> bool:
        return self.ids is None or regional_id in self.ids

    def filtrar(self, consulta):
        """Restringe una consulta sobre `Vendedor` a las regionales del alcance."""
        if self.ids is None:
            return consulta
        return consulta.where(Vendedor.equipo.has(EquipoDTS.regional_id.in_(self.ids)))

    def filtrar_feriados(self, consulta):
        """Feriados que le corresponden: los nacionales y los de sus regionales."""
        if self.ids is None:
            return consulta
        return consulta.where(Feriado.regional_id.is_(None) | Feriado.regional_id.in_(self.ids))


NACIONAL = Alcance()


def alcance_de_usuario(user: Usuario) -> Alcance:
    if user.rol == Rol.admin or user.todas_regionales:
        return NACIONAL
    return Alcance(frozenset(user.regionales))  # sin regionales asignadas: no ve nada


def alcance_de(db: Session) -> Alcance:
    """Alcance de la petición en curso (nacional si no hay petición, p. ej. en los scripts)."""
    return db.info.get("alcance", NACIONAL)
