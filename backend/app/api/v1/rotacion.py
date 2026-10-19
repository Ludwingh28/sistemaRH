"""Panel de rotación de vendedores.

Replica el cálculo del Power BI de Desarrollo Humano («Dashboard RRHH.pbix»), que trabajaba con una
planilla mensual:

    Personal del período = quienes figuran en el período (los que ya estaban + los ingresos)
    Salidas              = bajas del período
    Final                = Personal del período − Salidas
    Promedio             = (Personal del período + Final) / 2
    Rotación             = Salidas / Promedio

Aquí los números salen de las fechas de ingreso y de baja de cada vendedor, así que sirven para
cualquier rango (semana, mes, año) y no solo para el último mes cargado. Además se calcula la fórmula
«estándar», con el personal al inicio del período en lugar del que figuró en él.
"""
import calendar
from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.api.deps import usuario_actual
from app.api.v1.asistencia import construir_matriz
from app.core.database import get_db
from app.models import EquipoDTS, Vendedor

router = APIRouter(prefix="/rotacion", tags=["rotacion"], dependencies=[Depends(usuario_actual)])

MAX_DIAS = 366
MAX_DIAS_AUSENTISMO = 93  # la matriz de asistencia consulta el BI día por día
MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"]
SIN_MOTIVO = "Sin especificar"


class Grupo(BaseModel):
    nombre: str
    zona: str | None = None
    inicial: int  # personal que ya estaba al empezar el período
    altas: int  # ingresos dentro del período
    bajas: int  # salidas dentro del período
    final: int  # personal al cierre
    personal_periodo: int  # inicial + altas (lo que el Power BI llama «inicio»)
    rotacion: float  # método de RH (Power BI)
    rotacion_estandar: float


class Mes(BaseModel):
    mes: str  # AAAA-MM
    etiqueta: str
    inicial: int
    altas: int
    bajas: int
    final: int
    rotacion: float


class Motivo(BaseModel):
    motivo: str
    cantidad: int


class Rotacion(BaseModel):
    desde: date
    hasta: date
    total: Grupo
    equipos: list[Grupo]
    motivos: list[Motivo]
    tendencia: list[Mes]
    avisos: list[str] = []


class AusentismoGrupo(BaseModel):
    nombre: str
    habiles: int
    faltas: int
    ausentismo: float | None  # faltas / hábiles


class Ausentismo(BaseModel):
    disponible: bool
    aviso: str | None = None
    total: AusentismoGrupo
    equipos: list[AusentismoGrupo]


def _rango(desde: date | None, hasta: date | None) -> tuple[date, date]:
    hoy = date.today()
    desde = desde or hoy.replace(day=1)
    hasta = hasta or date(desde.year, desde.month, calendar.monthrange(desde.year, desde.month)[1])
    if hasta < desde:
        raise HTTPException(422, "La fecha final no puede ser anterior a la inicial")
    if (hasta - desde).days + 1 > MAX_DIAS:
        raise HTTPException(422, f"El rango no puede superar {MAX_DIAS} días")
    return desde, hasta


def _tasas(inicial: int, altas: int, bajas: int, final: int) -> tuple[float, float]:
    """(rotación método RH, rotación estándar). Sin personal, 0."""
    personal = inicial + altas
    promedio_rh = (personal + final) / 2
    promedio_std = (inicial + final) / 2
    return (bajas / promedio_rh if promedio_rh else 0.0, bajas / promedio_std if promedio_std else 0.0)


def _contar(vendedores: list[Vendedor], desde: date, hasta: date) -> tuple[int, int, int, int]:
    """(inicial, altas, bajas, final). La fecha de baja es el primer día sin trabajar."""
    inicial = altas = bajas = final = 0
    for v in vendedores:
        ingreso, baja = v.fecha_primer_ingreso, v.fecha_baja
        if ingreso < desde and (baja is None or baja >= desde):
            inicial += 1
        if desde <= ingreso <= hasta:
            altas += 1
        if baja is not None and desde <= baja <= hasta:
            bajas += 1
        if ingreso <= hasta and (baja is None or baja > hasta):
            final += 1
    return inicial, altas, bajas, final


def _grupo(nombre: str, vendedores: list[Vendedor], desde: date, hasta: date, zona: str | None = None) -> Grupo:
    inicial, altas, bajas, final = _contar(vendedores, desde, hasta)
    rot, rot_std = _tasas(inicial, altas, bajas, final)
    return Grupo(
        nombre=nombre, zona=zona, inicial=inicial, altas=altas, bajas=bajas, final=final,
        personal_periodo=inicial + altas, rotacion=rot, rotacion_estandar=rot_std,
    )


@router.get("", response_model=Rotacion)
def rotacion(
    desde: date | None = None,  # por defecto, el mes en curso
    hasta: date | None = None,
    regional_id: int | None = None,
    equipo_id: int | None = None,
    db: Session = Depends(get_db),
):
    desde, hasta = _rango(desde, hasta)
    consulta = select(Vendedor).options(joinedload(Vendedor.equipo).joinedload(EquipoDTS.regional))
    if equipo_id:
        consulta = consulta.where(Vendedor.equipo_id == equipo_id)
    if regional_id:
        consulta = consulta.where(Vendedor.equipo.has(EquipoDTS.regional_id == regional_id))
    vendedores = list(db.scalars(consulta).unique())

    # Totales y por equipo
    total = _grupo("Total", vendedores, desde, hasta)
    equipos_q = select(EquipoDTS).options(joinedload(EquipoDTS.regional))
    if equipo_id:
        equipos_q = equipos_q.where(EquipoDTS.id == equipo_id)
    if regional_id:
        equipos_q = equipos_q.where(EquipoDTS.regional_id == regional_id)
    equipos = sorted(db.scalars(equipos_q).unique(), key=lambda e: (e.regional.nombre, e.nombre))
    grupos = [
        _grupo(e.nombre, [v for v in vendedores if v.equipo_id == e.id], desde, hasta, zona=e.regional.nombre)
        for e in equipos
    ]

    # Motivos de las salidas del período
    motivos: dict[str, int] = {}
    for v in vendedores:
        if v.fecha_baja and desde <= v.fecha_baja <= hasta:
            clave = (v.motivo_baja or "").strip().upper() or SIN_MOTIVO
            motivos[clave] = motivos.get(clave, 0) + 1
    lista_motivos = [Motivo(motivo=m, cantidad=c) for m, c in sorted(motivos.items(), key=lambda x: (-x[1], x[0]))]

    # Las bajas anteriores a la primera registrada no existen en el sistema: no se puede calcular
    # rotación de esos períodos (aparecería 0 % sin ser verdad).
    todas = list(db.scalars(select(Vendedor.fecha_baja).where(Vendedor.fecha_baja.is_not(None))))
    primera_baja = min(todas) if todas else None
    cobertura = primera_baja.replace(day=1) if primera_baja else None
    avisos: list[str] = []
    if cobertura is None:
        avisos.append("Aún no hay bajas registradas: la rotación es 0 hasta que se carguen.")
    elif desde < cobertura:
        avisos.append(
            f"Las bajas están registradas desde {primera_baja:%d/%m/%Y}; la rotación de fechas anteriores no es confiable."
        )

    # Tendencia mensual del año de la fecha final (solo meses ya iniciados y con bajas registradas)
    hoy = date.today()
    tendencia = []
    for mes in range(1, 13):
        inicio = date(hasta.year, mes, 1)
        if inicio > hoy:
            break
        if cobertura is None or inicio < cobertura:
            continue
        fin = date(hasta.year, mes, calendar.monthrange(hasta.year, mes)[1])
        i, a, b, f = _contar(vendedores, inicio, fin)
        tendencia.append(Mes(
            mes=f"{hasta.year}-{mes:02d}", etiqueta=MESES[mes - 1] + ("*" if fin > hoy else ""), inicial=i, altas=a, bajas=b, final=f,
            rotacion=_tasas(i, a, b, f)[0],
        ))

    return Rotacion(
        desde=desde, hasta=hasta, total=total, equipos=grupos, motivos=lista_motivos,
        tendencia=tendencia, avisos=avisos,
    )


@router.get("/ausentismo", response_model=Ausentismo)
def ausentismo(
    desde: date | None = None,
    hasta: date | None = None,
    regional_id: int | None = None,
    equipo_id: int | None = None,
    db: Session = Depends(get_db),
):
    """Ausentismo = días hábiles sin preventa / días hábiles (sale de la asistencia contra el BI).

    Va aparte porque consulta el BI y tarda más que el resto del panel.
    """
    desde, hasta = _rango(desde, hasta)
    vacio = AusentismoGrupo(nombre="Total", habiles=0, faltas=0, ausentismo=None)
    if (hasta - desde).days + 1 > MAX_DIAS_AUSENTISMO:
        return Ausentismo(
            disponible=False, total=vacio, equipos=[],
            aviso=f"El ausentismo se calcula en rangos de hasta {MAX_DIAS_AUSENTISMO} días.",
        )
    try:
        matriz = construir_matriz(db, desde, hasta, regional_id, equipo_id)
    except HTTPException as e:  # el BI no responde o no está configurado: el resto del panel sigue
        return Ausentismo(disponible=False, total=vacio, equipos=[], aviso=f"Ausentismo no disponible: {e.detail}")
    por_equipo: dict[str, list[int]] = {}
    for fila in matriz.filas:
        acum = por_equipo.setdefault(fila.equipo, [0, 0])
        acum[0] += fila.habiles
        acum[1] += fila.faltas
    grupos = [
        AusentismoGrupo(nombre=n, habiles=h, faltas=f, ausentismo=(f / h if h else None))
        for n, (h, f) in sorted(por_equipo.items())
    ]
    h, f = sum(g.habiles for g in grupos), sum(g.faltas for g in grupos)
    return Ausentismo(
        disponible=True, equipos=grupos,
        total=AusentismoGrupo(nombre="Total", habiles=h, faltas=f, ausentismo=(f / h if h else None)),
    )
