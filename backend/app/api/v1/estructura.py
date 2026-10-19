from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import usuario_actual
from app.core.database import get_db
from app.models import EquipoDTS, Regional

router = APIRouter(prefix="/estructura", tags=["estructura"], dependencies=[Depends(usuario_actual)])


class EquipoOut(BaseModel):
    id: int
    nombre: str
    supervisor: str | None


class RegionalOut(BaseModel):
    id: int
    nombre: str
    equipos: list[EquipoOut]


@router.get("", response_model=list[RegionalOut])
def estructura(db: Session = Depends(get_db)):
    regionales = db.scalars(select(Regional).order_by(Regional.nombre))
    return [
        RegionalOut(
            id=r.id,
            nombre=r.nombre,
            equipos=[
                EquipoOut(id=e.id, nombre=e.nombre, supervisor=e.supervisor.nombre if e.supervisor else None)
                for e in r.equipos
            ],
        )
        for r in regionales
    ]
