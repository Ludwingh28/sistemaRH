from datetime import date, timedelta

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from starlette.concurrency import run_in_threadpool
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload, selectinload

from app import schemas
from app.api.deps import requiere_permiso
from app.core.alcance import alcance_de
from app.core.database import get_db
from app.models import Contrato, EquipoDTS, HistorialVendedor, Vendedor
from app.integrations import bi
from app.services import carpetas, importacion
from app.services.calculos import (
    DIAS_NUEVO,
    MOTIVOS_BAJA,
    estado_contrato,
    fin_contrato_por_defecto,
)

router = APIRouter(prefix="/vendedores", tags=["vendedores"], dependencies=[Depends(requiere_permiso("vendedores.ver"))])


# ── Armado de respuestas ─────────────────────────────────────────────────────

def _contrato_out(c: Contrato, v: Vendedor, es_ultimo: bool, hoy: date) -> schemas.ContratoOut:
    out = schemas.ContratoOut.model_validate(c)
    out.dias_para_vencer = (c.fecha_fin - hoy).days
    if not es_ultimo:
        out.estado = "anterior"
    elif c.fecha_inicio > hoy:
        out.estado = "futuro"
    elif not v.vigente:
        out.estado = "rescindido"
    else:
        out.estado = estado_contrato(c.fecha_fin, True, hoy)[0]
    return out


def _out(v: Vendedor, hoy: date | None = None) -> schemas.VendedorOut:
    hoy = hoy or date.today()
    out = schemas.VendedorOut.model_validate(v)
    out.equipo_nombre, out.regional, out.regional_id = v.equipo.nombre, v.equipo.regional.nombre, v.equipo.regional_id
    out.total_contratos = len(v.contratos)
    c = v.contrato_actual
    if c:
        out.contrato_actual = _contrato_out(c, v, True, hoy)
        out.estado_contrato, out.dias_para_vencer = estado_contrato(c.fecha_fin, v.vigente, hoy)
    if not v.vigente:
        out.estado = "retirado"
    elif c and c.numero == 1 and (hoy - c.fecha_inicio).days < DIAS_NUEVO:
        out.estado = "nuevo"
    else:
        out.estado = "activo"
    return out


def _detalle(v: Vendedor) -> schemas.VendedorDetalle:
    hoy = date.today()
    base = _out(v, hoy)
    ultimo = v.contratos[-1] if v.contratos else None
    return schemas.VendedorDetalle(
        **base.model_dump(),
        contratos=[_contrato_out(c, v, c is ultimo, hoy) for c in v.contratos],
        historial=[schemas.HistorialOut.model_validate(h) for h in reversed(v.historial)],
    )


def _consulta():
    return select(Vendedor).options(
        joinedload(Vendedor.equipo).joinedload(EquipoDTS.regional), selectinload(Vendedor.contratos)
    )


def _get(db: Session, vendedor_id: int) -> Vendedor:
    v = db.scalar(_consulta().where(Vendedor.id == vendedor_id))
    if not v or not alcance_de(db).permite(v.equipo.regional_id):  # fuera de su alcance = no existe para esa persona
        raise HTTPException(404, "Vendedor no encontrado")
    return v


def _evento(db: Session, v: Vendedor, evento: str, fecha: date, detalle: str | None, usuario: str):
    db.add(
        HistorialVendedor(
            vendedor_id=v.id, evento=evento, fecha=fecha, detalle=detalle, equipo_id=v.equipo_id,
            usuario=usuario,
        )
    )


# ── Reglas de contratos ──────────────────────────────────────────────────────

def _validar_sin_solape(v: Vendedor, inicio: date, fin: date, excluir_id: int | None = None):
    for o in v.contratos:
        if o.id != excluir_id and inicio <= o.fecha_fin and o.fecha_inicio <= fin:
            raise HTTPException(
                422,
                f"Las fechas se cruzan con el contrato nº {o.numero} "
                f"({o.fecha_inicio:%d/%m/%Y} al {o.fecha_fin:%d/%m/%Y})",
            )


def _sincronizar_primer_ingreso(v: Vendedor):
    if v.contratos:
        primero = min(c.fecha_inicio for c in v.contratos)
        if primero < v.fecha_primer_ingreso:
            v.fecha_primer_ingreso = primero


def _guardar(db: Session, mensaje_duplicado: str):
    try:
        db.flush()
    except IntegrityError as e:
        db.rollback()
        raise HTTPException(409, mensaje_duplicado) from e


# ── Vendedores ───────────────────────────────────────────────────────────────

@router.get("/motivos-baja", response_model=list[str])
def motivos_baja():
    return MOTIVOS_BAJA


MAX_EXCEL_MB = 5


def _procesar_importacion(db: Session, contenido: bytes, aplicar: bool, corregir_fechas: bool, usuario: str) -> dict:
    try:
        datos = importacion.leer_excel(contenido)
    except importacion.ErrorExcel as e:
        raise HTTPException(422, str(e)) from e
    try:
        usuarios_bi = bi.usuarios_bi()
        aviso_bi = None
    except Exception:  # el BI puede no estar disponible: la importación sigue, sin esa comprobación
        usuarios_bi, aviso_bi = None, "No se pudo comparar los códigos con el BI (no hay conexión); revisa que sean los mismos que usa el BI."
    plan = importacion.planificar(db, datos, corregir_fechas, usuarios_bi)
    if aviso_bi:
        plan.observaciones.append({"nivel": "AVISO", "fila": 0, "codigo": "", "nombre": "", "mensaje": aviso_bi})
    out = importacion.resumen(plan)
    if not aplicar:
        return out
    try:
        creados = importacion.aplicar(db, plan, usuario)["nuevos"]
        db.commit()
    except IntegrityError as e:
        db.rollback()
        raise HTTPException(409, "No se pudo cargar: algún código o carnet ya existe. Vuelve a revisar el archivo.") from e
    out["aplicado"] = True
    # Carpeta de contratos de cada vendedor nuevo (si la unidad falla, la carga ya está guardada)
    aviso = None
    for v in creados:
        r = carpetas.asegurar_al_crear(db, v)
        aviso = aviso or r
    db.commit()
    out["carpetas_creadas"] = sum(1 for v in creados if v.carpeta_contratos) if carpetas.configurada() else 0
    out["aviso_carpetas"] = aviso
    return out


@router.post("/importar", response_model=schemas.ImportacionOut)
async def importar(
    archivo: UploadFile = File(...), aplicar: bool = Form(False), corregir_fechas: bool = Form(False),
    db: Session = Depends(get_db), user=Depends(requiere_permiso("vendedores.importar")),
):
    """Sube el Excel mensual de RRHH. Con `aplicar=false` solo revisa y devuelve qué haría; con `aplicar=true` lo carga.
    Es repetible: crea los vendedores nuevos y actualiza los existentes (ver services/importacion.py)."""
    limite = MAX_EXCEL_MB * 1024 * 1024
    contenido = await archivo.read(limite + 1)
    if len(contenido) > limite:
        raise HTTPException(413, f"El archivo supera el máximo de {MAX_EXCEL_MB} MB")
    return await run_in_threadpool(_procesar_importacion, db, contenido, aplicar, corregir_fechas, user.username)


@router.get("/resumen", response_model=schemas.ResumenVendedores)
def resumen(db: Session = Depends(get_db)):
    hoy = date.today()
    r = dict(vigentes=0, nuevos=0, por_vencer=0, vencidos=0, retirados=0)
    for v in db.scalars(alcance_de(db).filtrar(_consulta())).unique():
        o = _out(v, hoy)
        if o.estado == "retirado":
            r["retirados"] += 1
            continue
        r["vigentes"] += 1
        r["nuevos"] += o.estado == "nuevo"
        r["por_vencer"] += o.estado_contrato == "por_vencer"
        r["vencidos"] += o.estado_contrato == "vencido"
    return r


@router.post("", response_model=schemas.VendedorDetalle, status_code=201)
def crear(data: schemas.VendedorCrear, db: Session = Depends(get_db), user=Depends(requiere_permiso("vendedores.crear"))):
    equipo = db.get(EquipoDTS, data.equipo_id)
    if not equipo:
        raise HTTPException(422, "Equipo DTS inexistente")
    if not alcance_de(db).permite(equipo.regional_id):
        raise HTTPException(403, "Esa zona está fuera de tu alcance.")
    if db.scalar(select(Vendedor).where(Vendedor.codigo_vendedor == data.codigo_vendedor)):
        raise HTTPException(409, "El código de vendedor ya existe")
    if data.documento and db.scalar(select(Vendedor).where(Vendedor.documento == data.documento)):
        raise HTTPException(409, "Ya existe un vendedor con ese carnet de identidad")

    ct = data.contrato
    fin = ct.fecha_fin or fin_contrato_por_defecto(ct.fecha_inicio)
    primer = min(data.fecha_primer_ingreso or ct.fecha_inicio, ct.fecha_inicio)
    campos = data.model_dump(exclude={"contrato", "fecha_primer_ingreso"})
    v = Vendedor(**campos, fecha_primer_ingreso=primer, creado_por=user.username)
    v.contratos.append(
        Contrato(
            numero=ct.numero or 1, fecha_inicio=ct.fecha_inicio, fecha_fin=fin,
            dias_capacitacion=ct.dias_capacitacion, observacion=ct.observacion, creado_por=user.username,
        )
    )
    db.add(v)
    db.flush()
    _evento(db, v, "alta", ct.fecha_inicio, f"Contrato nº {ct.numero or 1}", user.username)
    carpetas.asegurar_al_crear(db, v)  # carpeta de contratos del vendedor (si la unidad falla, el alta no se pierde)
    db.commit()
    return _detalle(_get(db, v.id))


@router.get("", response_model=list[schemas.VendedorOut])
def listar(
    q: str | None = None,
    vigente: bool | None = None,
    regional_id: int | None = None,
    equipo_id: int | None = None,
    contrato: str | None = None,  # por_vencer | vencido | vigente
    vence_en: int | None = None,  # vigentes cuyo contrato vence dentro de N días
    db: Session = Depends(get_db),
):
    consulta = alcance_de(db).filtrar(_consulta())
    if vigente is not None:
        consulta = consulta.where(Vendedor.fecha_baja.is_(None) if vigente else Vendedor.fecha_baja.is_not(None))
    if equipo_id:
        consulta = consulta.where(Vendedor.equipo_id == equipo_id)
    if regional_id:
        consulta = consulta.where(Vendedor.equipo.has(EquipoDTS.regional_id == regional_id))
    if q and q.strip():
        like = f"%{q.strip()}%"
        consulta = consulta.where(
            Vendedor.nombre.ilike(like) | Vendedor.codigo_vendedor.ilike(like) | Vendedor.documento.ilike(like)
        )
    hoy = date.today()
    filas = [_out(v, hoy) for v in db.scalars(consulta.order_by(Vendedor.nombre)).unique()]
    if contrato:
        filas = [f for f in filas if f.estado_contrato == contrato]
    if vence_en is not None:
        filas = [
            f for f in filas
            if f.vigente and f.dias_para_vencer is not None and 0 <= f.dias_para_vencer <= vence_en
        ]
    # Lo más urgente primero cuando se filtra por vencimiento.
    if contrato or vence_en is not None:
        filas.sort(key=lambda f: f.dias_para_vencer if f.dias_para_vencer is not None else 10**6)
    return filas


@router.get("/{vendedor_id}", response_model=schemas.VendedorDetalle)
def obtener(vendedor_id: int, db: Session = Depends(get_db)):
    return _detalle(_get(db, vendedor_id))


@router.patch("/{vendedor_id}", response_model=schemas.VendedorDetalle)
def actualizar(
    vendedor_id: int, data: schemas.VendedorActualizar, db: Session = Depends(get_db), user=Depends(requiere_permiso("vendedores.editar"))
):
    v = _get(db, vendedor_id)
    cambios = data.model_dump(exclude_unset=True)
    for campo in ("documento", "telefono_corporativo", "telefono_personal"):
        if campo in cambios:
            cambios[campo] = (cambios[campo] or "").strip() or None
    if "nombre" in cambios:
        cambios["nombre"] = cambios["nombre"].strip()
    if "codigo_vendedor" in cambios:
        nuevo = (cambios["codigo_vendedor"] or "").strip()
        if not nuevo:
            cambios.pop("codigo_vendedor")
        elif nuevo != v.codigo_vendedor:
            if db.scalar(select(Vendedor).where(Vendedor.codigo_vendedor == nuevo)):
                raise HTTPException(409, "Ya existe un vendedor con ese código")
            _evento(db, v, "cambio_codigo", date.today(), f"{v.codigo_vendedor} -> {nuevo}", user.username)
            cambios["codigo_vendedor"] = nuevo
        else:
            cambios.pop("codigo_vendedor")
    if cambios.get("documento") and cambios["documento"] != v.documento:
        if db.scalar(select(Vendedor).where(Vendedor.documento == cambios["documento"])):
            raise HTTPException(409, "Ya existe un vendedor con ese carnet de identidad")
    if "equipo_id" in cambios and cambios["equipo_id"] != v.equipo_id:
        nuevo_equipo = db.get(EquipoDTS, cambios["equipo_id"])
        if not nuevo_equipo:
            raise HTTPException(422, "Equipo DTS inexistente")
        if not alcance_de(db).permite(nuevo_equipo.regional_id):
            raise HTTPException(403, "Esa zona está fuera de tu alcance.")
        _evento(db, v, "cambio_equipo", date.today(), f"{v.equipo_id} -> {cambios['equipo_id']}", user.username)
    if cambios.get("fecha_primer_ingreso") and v.contratos:
        if cambios["fecha_primer_ingreso"] > min(c.fecha_inicio for c in v.contratos):
            raise HTTPException(422, "El primer ingreso no puede ser posterior al inicio de sus contratos")
    for k, val in cambios.items():
        if val is None and k in ("nombre", "equipo_id", "cargo", "area", "fecha_primer_ingreso"):
            continue  # campos obligatorios: ignorar vacío
        setattr(v, k, val)
    db.commit()
    return _detalle(_get(db, vendedor_id))


@router.post("/{vendedor_id}/baja", response_model=schemas.VendedorDetalle)
def dar_de_baja(
    vendedor_id: int, data: schemas.VendedorBaja, db: Session = Depends(get_db), user=Depends(requiere_permiso("vendedores.baja"))
):
    v = _get(db, vendedor_id)
    if v.fecha_baja:
        raise HTTPException(409, "El vendedor ya está dado de baja")
    if data.fecha_baja < v.fecha_primer_ingreso:
        raise HTTPException(422, "La baja no puede ser anterior al primer ingreso del vendedor")
    posteriores = [c.numero for c in v.contratos if c.fecha_inicio > data.fecha_baja]
    if posteriores:
        nums = ", ".join(f"nº {n}" for n in posteriores)
        raise HTTPException(422, f"Tiene contratos que empiezan después de esa fecha ({nums}). Elimínalos primero.")
    v.fecha_baja, v.motivo_baja = data.fecha_baja, (data.motivo_baja or "").strip() or None
    _evento(db, v, "baja", data.fecha_baja, v.motivo_baja, user.username)
    db.commit()
    return _detalle(_get(db, vendedor_id))


# ── Contratos ────────────────────────────────────────────────────────────────

@router.post("/{vendedor_id}/contratos", response_model=schemas.VendedorDetalle, status_code=201)
def agregar_contrato(
    vendedor_id: int, data: schemas.ContratoCrear, db: Session = Depends(get_db), user=Depends(requiere_permiso("contratos.gestionar"))
):
    """Renueva el contrato (o registra uno anterior). Sin datos, crea el siguiente por 1 año."""
    v = _get(db, vendedor_id)
    if not v.vigente:
        raise HTTPException(409, "El vendedor está dado de baja: no se pueden agregar contratos")
    ultimo = v.contrato_actual
    numero = data.numero or ((ultimo.numero + 1) if ultimo else 1)
    if any(c.numero == numero for c in v.contratos):
        raise HTTPException(409, f"Ya existe el contrato nº {numero}")

    inicio = data.fecha_inicio
    if not inicio:
        if numero < (ultimo.numero if ultimo else 0):
            raise HTTPException(422, "Para un contrato anterior indica la fecha de inicio")
        inicio = ultimo.fecha_fin + timedelta(days=1) if ultimo else date.today()
    fin = data.fecha_fin or fin_contrato_por_defecto(inicio)
    if fin < inicio:
        raise HTTPException(422, "El fin del contrato no puede ser anterior a su inicio")
    _validar_sin_solape(v, inicio, fin)

    v.contratos.append(
        Contrato(
            numero=numero, fecha_inicio=inicio, fecha_fin=fin, dias_capacitacion=data.dias_capacitacion,
            observacion=data.observacion, creado_por=user.username,
        )
    )
    v.contratos.sort(key=lambda c: c.numero)
    _sincronizar_primer_ingreso(v)
    es_renovacion = ultimo is None or numero > ultimo.numero
    _evento(db, v, "renovacion" if es_renovacion else "contrato_anterior", inicio,
            f"Contrato nº {numero}: {inicio:%d/%m/%Y} al {fin:%d/%m/%Y}", user.username)
    _guardar(db, f"Ya existe el contrato nº {numero}")
    db.commit()
    return _detalle(_get(db, vendedor_id))


def _contrato(db: Session, contrato_id: int) -> Contrato:
    c = db.scalar(select(Contrato).where(Contrato.id == contrato_id).options(joinedload(Contrato.vendedor)))
    if not c:
        raise HTTPException(404, "Contrato no encontrado")
    return c


@router.patch("/contratos/{contrato_id}", response_model=schemas.VendedorDetalle)
def actualizar_contrato(
    contrato_id: int, data: schemas.ContratoActualizar, db: Session = Depends(get_db), user=Depends(requiere_permiso("contratos.gestionar"))
):
    c = _contrato(db, contrato_id)
    v = _get(db, c.vendedor_id)
    cambios = data.model_dump(exclude_unset=True)
    inicio = cambios.get("fecha_inicio") or c.fecha_inicio
    fin = cambios.get("fecha_fin") or c.fecha_fin
    if fin < inicio:
        raise HTTPException(422, "El fin del contrato no puede ser anterior a su inicio")
    _validar_sin_solape(v, inicio, fin, excluir_id=c.id)
    nuevo_numero = cambios.get("numero")
    if nuevo_numero and nuevo_numero != c.numero and any(o.numero == nuevo_numero for o in v.contratos):
        raise HTTPException(409, f"Ya existe el contrato nº {nuevo_numero}")
    cont = next(o for o in v.contratos if o.id == c.id)
    for k, val in cambios.items():
        if val is None and k != "observacion":
            continue
        setattr(cont, k, val)
    v.contratos.sort(key=lambda x: x.numero)
    if cont.numero == 1:  # el inicio del contrato nº 1 es el primer ingreso
        v.fecha_primer_ingreso = cont.fecha_inicio
    _sincronizar_primer_ingreso(v)
    _evento(db, v, "contrato_editado", date.today(), f"Contrato nº {cont.numero}", user.username)
    _guardar(db, "Ya existe un contrato con ese número")
    db.commit()
    return _detalle(_get(db, v.id))


@router.delete("/contratos/{contrato_id}", response_model=schemas.VendedorDetalle)
def eliminar_contrato(contrato_id: int, db: Session = Depends(get_db), user=Depends(requiere_permiso("contratos.gestionar"))):
    c = _contrato(db, contrato_id)
    v = _get(db, c.vendedor_id)
    if len(v.contratos) <= 1:
        raise HTTPException(409, "No puedes eliminar el único contrato del vendedor")
    cont = next(o for o in v.contratos if o.id == c.id)
    v.contratos.remove(cont)
    _evento(db, v, "contrato_eliminado", date.today(), f"Contrato nº {cont.numero}", user.username)
    db.commit()
    return _detalle(_get(db, v.id))
