import calendar
from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session, joinedload, selectinload

from app.api.deps import requiere_permiso
from app.core.alcance import alcance_de
from app.core.database import get_db
from app.integrations import bi
from app.models import EquipoDTS, Feriado, Regional, Vendedor
from app.services import feriados as feriados_svc
from app.services.carpetas import normalizar as carpetas_norm
from app.services.exportar import asistencia_xlsx
from app.services.feriados import sincronizar_si_corresponde, ultima_sync
from app.services.calculos import ultimo_dia_activo

router = APIRouter(prefix="/asistencia", tags=["asistencia"], dependencies=[Depends(requiere_permiso("asistencia.ver"))])

DIAS_ES = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"]

# Códigos de celda
PRESENTE, FALTA, CAPACITACION, NO_LABORABLE, FUERA = "P", "F", "C", "N", "-"


class DiaOut(BaseModel):
    fecha: date
    etiqueta: str  # "lun 01-09"
    domingo: bool


class FilaAsistencia(BaseModel):
    vendedor_id: int
    codigo_vendedor: str
    nombre: str
    regional_id: int
    zona: str  # regional
    equipo: str
    retirado: date | None
    celdas: list[str]  # una por día del mes: P | F | C | N | -
    habiles: int
    asistidos: int
    faltas: int
    extra: int  # preventas en días no laborables


class FeriadoOut(BaseModel):
    id: int
    fecha: date
    regional_id: int | None
    regional: str | None
    descripcion: str
    origen: str  # manual | holidays (automático)
    tipo: str | None
    activo: bool


class MatrizAsistencia(BaseModel):
    desde: date
    hasta: date
    dias: list[DiaOut]
    filas: list[FilaAsistencia]
    feriados: list[FeriadoOut]


def _feriado_out(f: Feriado) -> FeriadoOut:
    return FeriadoOut(
        id=f.id, fecha=f.fecha, regional_id=f.regional_id,
        regional=f.regional.nombre if f.regional else None, descripcion=f.descripcion,
        origen=f.origen, tipo=f.tipo, activo=f.activo,
    )


MAX_DIAS = 93  # un trimestre; más que eso vuelve ilegible la tabla


def _rango(desde: date | None, hasta: date | None) -> tuple[date, date]:
    hoy = date.today()
    desde = desde or hoy.replace(day=1)
    hasta = hasta or date(desde.year, desde.month, calendar.monthrange(desde.year, desde.month)[1])
    if hasta < desde:
        raise HTTPException(422, "La fecha final no puede ser anterior a la inicial")
    if (hasta - desde).days + 1 > MAX_DIAS:
        raise HTTPException(422, f"El rango no puede superar {MAX_DIAS} días")
    return desde, hasta


@router.get("/matriz", response_model=MatrizAsistencia)
def matriz(
    desde: date | None = None,  # por defecto, el mes en curso
    hasta: date | None = None,
    regional_id: int | None = None,
    equipo_id: int | None = None,
    db: Session = Depends(get_db),
):
    """Asistencia por día en un rango de fechas (semana, quincena, mes...). Un día es 'presente' si el vendedor tiene preventa ese día en el BI."""
    desde, hasta = _rango(desde, hasta)
    return construir_matriz(db, desde, hasta, regional_id, equipo_id)


@router.get("/exportar", dependencies=[Depends(requiere_permiso("asistencia.exportar"))])
def exportar(
    desde: date | None = None,
    hasta: date | None = None,
    regional_id: int | None = None,
    equipo_id: int | None = None,
    q: str | None = None,  # texto buscado en pantalla (nombre, código, equipo o zona)
    db: Session = Depends(get_db),
    user=Depends(requiere_permiso("asistencia.exportar")),
):
    """Descarga la asistencia en Excel, con los mismos filtros que la pantalla."""
    desde, hasta = _rango(desde, hasta)
    matriz = construir_matriz(db, desde, hasta, regional_id, equipo_id)
    if q and q.strip():
        t = carpetas_norm(q)
        matriz.filas = [f for f in matriz.filas if t in carpetas_norm(f"{f.nombre} {f.codigo_vendedor} {f.equipo} {f.zona}")]
    zona = db.get(Regional, regional_id).nombre if regional_id and db.get(Regional, regional_id) else "TODAS"
    equipo = db.get(EquipoDTS, equipo_id).nombre if equipo_id and db.get(EquipoDTS, equipo_id) else "TODOS"
    contenido = asistencia_xlsx(matriz, f"Zona: {zona.upper()}  ·  Equipo: {equipo.upper()}", user.nombre)
    nombre = f"Asistencia_{desde:%Y-%m-%d}_{hasta:%Y-%m-%d}.xlsx"
    return Response(
        contenido,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{nombre}"', "Access-Control-Expose-Headers": "Content-Disposition"},
    )


class TrabajandoHoy(BaseModel):
    fecha: date
    trabajando: int | None  # con preventa registrada hoy (None si el BI no responde)
    esperados: int  # deberían estar trabajando hoy: vigentes, ya en ventas y en día laborable de su zona
    en_capacitacion: int
    sin_jornada: int  # en ventas pero hoy es domingo o feriado en su zona
    aviso: str | None = None


@router.get("/hoy", response_model=TrabajandoHoy)
def trabajando_hoy(
    regional_id: int | None = None,
    equipo_id: int | None = None,
    db: Session = Depends(get_db),
):
    """Cuántos vendedores están trabajando hoy: con preventa registrada hoy, de los que debían hacerlo."""
    hoy = date.today()
    sincronizar_si_corresponde(db, hoy.year)
    consulta = select(Vendedor).options(
        joinedload(Vendedor.equipo).joinedload(EquipoDTS.regional), selectinload(Vendedor.contratos)
    )
    consulta = alcance_de(db).filtrar(consulta)
    if equipo_id:
        consulta = consulta.where(Vendedor.equipo_id == equipo_id)
    if regional_id:
        consulta = consulta.where(Vendedor.equipo.has(EquipoDTS.regional_id == regional_id))

    libres = list(db.scalars(select(Feriado).where(Feriado.fecha == hoy, Feriado.activo.is_(True))))
    feriado_nacional = any(f.regional_id is None for f in libres)
    feriado_en = {f.regional_id for f in libres if f.regional_id is not None}

    esperados, capacitacion, sin_jornada = [], 0, 0
    for v in db.scalars(consulta).unique():
        fin_activo = ultimo_dia_activo(v.fecha_baja)
        if fin_activo and fin_activo < hoy:
            continue
        # Cuenta a quien sigue vigente aunque su contrato esté vencido sin renovar (igual que «Vigentes»).
        contrato = v.contrato_actual
        if contrato is None or v.fecha_primer_ingreso > hoy:
            continue
        if contrato.fecha_inicio <= hoy < contrato.fecha_inicio_ventas:
            capacitacion += 1
        elif hoy.weekday() == 6 or feriado_nacional or v.equipo.regional_id in feriado_en:
            sin_jornada += 1
        else:
            esperados.append(v)

    trabajando, aviso = None, None
    try:
        presentes = bi.fechas_preventa_por_vendedor([v.codigo_vendedor for v in esperados], hoy, hoy)
        trabajando = sum(1 for v in esperados if hoy in presentes.get(v.codigo_vendedor, set()))
    except RuntimeError as e:
        aviso = str(e)
    except SQLAlchemyError:
        aviso = "No se pudo consultar el BI"
    return TrabajandoHoy(
        fecha=hoy, trabajando=trabajando, esperados=len(esperados), en_capacitacion=capacitacion,
        sin_jornada=sin_jornada, aviso=aviso,
    )


def construir_matriz(
    db: Session, desde: date, hasta: date, regional_id: int | None = None, equipo_id: int | None = None
) -> MatrizAsistencia:
    """Lógica de la matriz; también la usa el panel de rotación para calcular el ausentismo."""
    hoy = date.today()
    fechas = [desde + timedelta(days=i) for i in range((hasta - desde).days + 1)]

    consulta = select(Vendedor).options(
        joinedload(Vendedor.equipo).joinedload(EquipoDTS.regional), selectinload(Vendedor.contratos)
    )
    consulta = alcance_de(db).filtrar(consulta)
    if equipo_id:
        consulta = consulta.where(Vendedor.equipo_id == equipo_id)
    if regional_id:
        consulta = consulta.where(Vendedor.equipo.has(EquipoDTS.regional_id == regional_id))
    candidatos = []
    for v in db.scalars(consulta).unique():
        fin_activo = ultimo_dia_activo(v.fecha_baja)
        if fin_activo and fin_activo < desde:
            continue  # se retiró antes del rango
        if any(c.fecha_inicio <= hasta and c.fecha_fin >= desde for c in v.contratos):
            candidatos.append(v)
    candidatos.sort(key=lambda v: (v.equipo.regional.nombre, v.equipo.nombre, v.nombre))

    for anio in range(desde.year, hasta.year + 1):  # genera el año si falta (instantáneo, sin red)
        sincronizar_si_corresponde(db, anio)
    feriados = list(
        db.scalars(
            alcance_de(db).filtrar_feriados(
                select(Feriado)
                .where(Feriado.fecha.between(desde, hasta), Feriado.activo.is_(True))
                .options(joinedload(Feriado.regional))
            )
        )
    )
    nacionales = {f.fecha for f in feriados if f.regional_id is None}
    por_regional: dict[int, set[date]] = {}
    for f in feriados:
        if f.regional_id is not None:
            por_regional.setdefault(f.regional_id, set()).add(f.fecha)

    try:
        presentes = bi.fechas_preventa_por_vendedor([v.codigo_vendedor for v in candidatos], desde, hasta)
    except RuntimeError as e:
        raise HTTPException(503, str(e)) from e
    except SQLAlchemyError as e:
        raise HTTPException(502, "No se pudo consultar el BI") from e

    filas = []
    for v in candidatos:
        asistio = presentes.get(v.codigo_vendedor, set())
        libres = nacionales | por_regional.get(v.equipo.regional_id, set())
        fin_activo = ultimo_dia_activo(v.fecha_baja)
        celdas, habiles, asistidos, extra = [], 0, 0, 0
        for d in fechas:
            contrato = next((c for c in v.contratos if c.fecha_inicio <= d <= c.fecha_fin), None)
            if contrato is None or d > hoy or (fin_activo and d > fin_activo):
                celdas.append(FUERA)
            elif d < contrato.fecha_inicio_ventas:
                celdas.append(CAPACITACION)
            elif d.weekday() == 6 or d in libres:
                if d in asistio:
                    celdas.append(PRESENTE)
                    extra += 1
                else:
                    celdas.append(NO_LABORABLE)
            elif d in asistio:
                habiles += 1
                asistidos += 1
                celdas.append(PRESENTE)
            elif d == hoy:
                celdas.append(FUERA)  # el día aún no termina: no se marca falta todavía
            else:
                habiles += 1
                celdas.append(FALTA)
        filas.append(
            FilaAsistencia(
                vendedor_id=v.id, codigo_vendedor=v.codigo_vendedor, nombre=v.nombre,
                regional_id=v.equipo.regional_id, zona=v.equipo.regional.nombre, equipo=v.equipo.nombre,
                retirado=v.fecha_baja, celdas=celdas, habiles=habiles, asistidos=asistidos,
                faltas=habiles - asistidos, extra=extra,
            )
        )

    return MatrizAsistencia(
        desde=desde, hasta=hasta,
        dias=[
            DiaOut(fecha=d, etiqueta=f"{DIAS_ES[d.weekday()]} {d:%d-%m}", domingo=d.weekday() == 6)
            for d in fechas
        ],
        filas=filas,
        feriados=[_feriado_out(f) for f in sorted(feriados, key=lambda f: f.fecha)],
    )


# ── Feriados (calendario laboral) ────────────────────────────────────────────

class FeriadoCrear(BaseModel):
    fecha: date
    regional_id: int | None = None  # nulo = nacional
    descripcion: str


class EstadoFeriados(BaseModel):
    fuente: str  # librería y versión que genera los feriados automáticos
    ultima_actualizacion: datetime | None  # UTC


def _feriado_gestionable(db: Session, feriado_id: int) -> Feriado:
    """Feriado que esta persona puede modificar: los nacionales solo con alcance nacional; los de zona, solo de sus regionales."""
    f = db.get(Feriado, feriado_id)
    al = alcance_de(db)
    if not f or (f.regional_id is not None and not al.permite(f.regional_id)):
        raise HTTPException(404, "Feriado no encontrado")
    if f.regional_id is None and not al.nacional:
        raise HTTPException(403, "Los feriados nacionales solo los gestiona quien tiene alcance nacional.")
    return f


@router.get("/feriados/estado", response_model=EstadoFeriados)
def estado_feriados(anio: int | None = None, db: Session = Depends(get_db)):
    anio = anio or date.today().year
    ultima = ultima_sync(db, anio)
    return EstadoFeriados(fuente=feriados_svc.FUENTE, ultima_actualizacion=ultima.fecha_hora if ultima else None)


@router.post("/feriados/sincronizar", response_model=EstadoFeriados, dependencies=[Depends(requiere_permiso("feriados.gestionar"))])
def sincronizar_feriados(anio: int | None = None, db: Session = Depends(get_db), user=Depends(requiere_permiso("feriados.gestionar"))):
    """Regenera los feriados automáticos del año (nacionales y departamentales)."""
    if not alcance_de(db).nacional:
        raise HTTPException(403, "Solo con alcance nacional se pueden regenerar los feriados de todo el país.")
    anio = anio or date.today().year
    feriados_svc.sincronizar(db, anio, usuario=user.username)
    return estado_feriados(anio, db)


@router.get("/feriados", response_model=list[FeriadoOut])
def listar_feriados(anio: int | None = None, db: Session = Depends(get_db)):
    anio = anio or date.today().year
    sincronizar_si_corresponde(db, anio)
    q = (
        select(Feriado)
        .where(Feriado.fecha.between(date(anio, 1, 1), date(anio, 12, 31)))
        .options(joinedload(Feriado.regional))
        .order_by(Feriado.fecha)
    )
    return [_feriado_out(f) for f in db.scalars(alcance_de(db).filtrar_feriados(q))]


@router.post("/feriados", response_model=FeriadoOut, status_code=201, dependencies=[Depends(requiere_permiso("feriados.gestionar"))])
def crear_feriado(data: FeriadoCrear, db: Session = Depends(get_db)):
    if data.regional_id is not None and not db.get(Regional, data.regional_id):
        raise HTTPException(422, "Regional inexistente")
    al = alcance_de(db)
    if (data.regional_id is None and not al.nacional) or (data.regional_id is not None and not al.permite(data.regional_id)):
        raise HTTPException(403, "Ese feriado está fuera de tu alcance: solo puedes gestionar los de tus regionales.")
    descripcion = data.descripcion.strip().upper()
    if not descripcion:
        raise HTTPException(422, "Indica la descripción del feriado")
    misma_regional = (
        Feriado.regional_id.is_(None) if data.regional_id is None else Feriado.regional_id == data.regional_id
    )
    if db.scalar(select(Feriado).where(Feriado.fecha == data.fecha, misma_regional)):
        raise HTTPException(409, "Ese feriado ya está registrado")
    f = Feriado(fecha=data.fecha, regional_id=data.regional_id, descripcion=descripcion)
    db.add(f)
    db.commit()
    db.refresh(f)
    return _feriado_out(f)


class FeriadoActivar(BaseModel):
    activo: bool


@router.patch("/feriados/{feriado_id}", response_model=FeriadoOut, dependencies=[Depends(requiere_permiso("feriados.gestionar"))])
def activar_feriado(feriado_id: int, data: FeriadoActivar, db: Session = Depends(get_db)):
    """Desactiva (o reactiva) un feriado, sin borrarlo: así una nueva sincronización no lo vuelve a cargar."""
    f = _feriado_gestionable(db, feriado_id)
    f.activo = data.activo
    db.commit()
    db.refresh(f)
    return _feriado_out(f)


@router.delete("/feriados/{feriado_id}", status_code=204, dependencies=[Depends(requiere_permiso("feriados.gestionar"))])
def eliminar_feriado(feriado_id: int, db: Session = Depends(get_db)):
    f = _feriado_gestionable(db, feriado_id)
    if f.origen != "manual":
        raise HTTPException(409, "Los feriados automáticos no se eliminan: desactívalos")
    db.delete(f)
    db.commit()
