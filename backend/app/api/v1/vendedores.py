import logging
from datetime import date, timedelta

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from starlette.concurrency import run_in_threadpool
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload, selectinload

from app import schemas
from app.api.deps import requiere, requiere_permiso
from app.core.alcance import alcance_de
from app.core.database import get_db
from app.models import Contrato, EquipoDTS, HistorialVendedor, PeriodoServicio, Vendedor
from app.integrations import bi
from app.services import carpetas, importacion
from app.services.calculos import (
    DIAS_NUEVO,
    MOTIVOS_BAJA,
    estado_contrato,
    fin_contrato_por_defecto,
)

log = logging.getLogger("rh.vendedores")
router = APIRouter(prefix="/vendedores", tags=["vendedores"], dependencies=[Depends(requiere_permiso("vendedores.ver"))])


# ── Armado de respuestas ─────────────────────────────────────────────────────

def _contrato_out(c: Contrato, v: Vendedor, es_ultimo: bool, hoy: date) -> schemas.ContratoOut:
    out = schemas.ContratoOut.model_validate(c)
    out.dias_para_vencer = (c.fecha_fin - hoy).days
    if c.fecha_fin_prevista:
        out.estado = "anticipado"  # terminó antes de tiempo porque el vendedor se retiró (luego volvió)
    elif not es_ultimo:
        out.estado = "anterior"
    elif c.fecha_inicio > hoy:
        out.estado = "futuro"
    elif not v.vigente:
        # si la baja llegó antes de la fecha de fin, el contrato terminó antes de tiempo; si no, se cumplió
        # Los contratos duran 1 año. Si se retiró antes de cumplirlo, terminó antes de tiempo: tanto si la baja cae
        # antes del fin como si el contrato ya viene cortado en la fecha de la baja (así llegan los importados del Excel).
        debia_durar = max(c.fecha_fin, fin_contrato_por_defecto(c.fecha_inicio))
        if v.fecha_baja and (v.fecha_baja < c.fecha_fin or c.fecha_fin < debia_durar):
            out.estado = "anticipado"
            out.fecha_fin_prevista, out.motivo_fin = debia_durar, v.motivo_baja
        else:
            out.estado = "finalizado"
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
    elif c and c.fecha_inicio == v.fecha_ingreso_actual and (hoy - c.fecha_inicio).days < DIAS_NUEVO:  # primer contrato del ingreso (o reingreso)
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


def _filtrar(consulta, q: str | None, regional_id: int | None, equipo_id: int | None):
    """Filtros de zona, equipo y búsqueda, comunes al listado y a los totales de las tarjetas."""
    if equipo_id:
        consulta = consulta.where(Vendedor.equipo_id == equipo_id)
    if regional_id:
        consulta = consulta.where(Vendedor.equipo.has(EquipoDTS.regional_id == regional_id))
    if q and q.strip():
        like = f"%{q.strip()}%"
        consulta = consulta.where(
            Vendedor.nombre.ilike(like) | Vendedor.codigo_vendedor.ilike(like) | Vendedor.documento.ilike(like)
        )
    return consulta


@router.get("/resumen", response_model=schemas.ResumenVendedores)
def resumen(q: str | None = None, regional_id: int | None = None, equipo_id: int | None = None, db: Session = Depends(get_db)):
    """Totales de las tarjetas. Respetan la zona, el equipo y la búsqueda elegidos (y siempre el alcance del usuario)."""
    hoy = date.today()
    r = dict(vigentes=0, nuevos=0, por_vencer=0, vencidos=0, retirados=0)
    for v in db.scalars(_filtrar(alcance_de(db).filtrar(_consulta()), q, regional_id, equipo_id)).unique():
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
    consulta = _filtrar(consulta, q, regional_id, equipo_id)
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
    if data.fecha_baja < v.fecha_ingreso_actual:
        raise HTTPException(422, "La baja no puede ser anterior al ingreso del vendedor")
    posteriores = [c.numero for c in v.contratos if c.fecha_inicio > data.fecha_baja]
    if posteriores:
        nums = ", ".join(f"nº {n}" for n in posteriores)
        raise HTTPException(422, f"Tiene contratos que empiezan después de esa fecha ({nums}). Elimínalos primero.")
    v.fecha_baja, v.motivo_baja = data.fecha_baja, (data.motivo_baja or "").strip() or None
    _evento(db, v, "baja", data.fecha_baja, v.motivo_baja, user.username)
    db.commit()
    return _detalle(_get(db, vendedor_id))


@router.patch("/{vendedor_id}/baja", response_model=schemas.VendedorDetalle)
def corregir_baja(
    vendedor_id: int, data: schemas.VendedorBaja, db: Session = Depends(get_db), user=Depends(requiere())
):
    """Corrige la fecha (y el motivo) de una baja ya registrada. SOLO el administrador. Si el último contrato estaba cortado en la fecha de la baja
    (así llegan los importados del Excel), su fin se mueve junto con ella: la asistencia y la rotación usan ambas fechas."""
    v = _get(db, vendedor_id)
    if not v.fecha_baja:
        raise HTTPException(409, "El vendedor no está dado de baja")
    if data.fecha_baja < v.fecha_ingreso_actual:
        raise HTTPException(422, "La baja no puede ser anterior al ingreso del vendedor")
    if any(c.fecha_inicio > data.fecha_baja for c in v.contratos):
        raise HTTPException(422, "Tiene contratos que empiezan después de esa fecha. Elimínalos primero.")
    anterior, motivo_anterior = v.fecha_baja, v.motivo_baja
    ultimo = v.contrato_actual
    if ultimo and ultimo.fecha_fin_prevista:
        # marcado «terminó antes de tiempo»: su fin es la fecha de la baja y el motivo es el de la baja
        # (la asistencia ya cuenta hasta el día anterior a la baja)
        ultimo.fecha_fin = max(ultimo.fecha_inicio, data.fecha_baja)
        if ultimo.fecha_fin >= ultimo.fecha_fin_prevista:
            ultimo.fecha_fin_prevista = None  # ya no termina antes de lo previsto
            ultimo.motivo_fin = None
        else:
            ultimo.motivo_fin = (data.motivo_baja or "").strip() or None
    elif ultimo and ultimo.fecha_fin == anterior:
        ultimo.fecha_fin = max(ultimo.fecha_inicio, data.fecha_baja)
    elif ultimo and ultimo.fecha_fin == anterior - timedelta(days=1):
        ultimo.fecha_fin = max(ultimo.fecha_inicio, data.fecha_baja - timedelta(days=1))
    v.fecha_baja, v.motivo_baja = data.fecha_baja, (data.motivo_baja or "").strip() or None
    detalle = f"Baja del {anterior:%d/%m/%Y} corregida al {data.fecha_baja:%d/%m/%Y}"
    if v.motivo_baja != motivo_anterior:
        detalle += f"; motivo: {motivo_anterior or 'sin especificar'} -> {v.motivo_baja or 'sin especificar'}"
    _evento(db, v, "baja_corregida", date.today(), detalle[:255], user.username)
    _guardar(db, "No se pudo corregir la baja")
    db.commit()
    return _detalle(_get(db, vendedor_id))


@router.post("/{vendedor_id}/reingreso", response_model=schemas.VendedorDetalle)
def reingresar(
    vendedor_id: int, data: schemas.VendedorReingreso, db: Session = Depends(get_db), user=Depends(requiere_permiso("contratos.gestionar"))
):
    """Un vendedor que se había retirado vuelve a la empresa: es un NUEVO INGRESO con el siguiente contrato correlativo
    (si su último era el nº 1, el nuevo es el nº 2). El contrato en el que se retiró queda «finalizado anticipadamente»
    (conserva hasta cuándo debía durar). La salida anterior se conserva para la rotación. No renumera nada."""
    v = _get(db, vendedor_id)
    if not v.fecha_baja:
        raise HTTPException(409, "El vendedor no está dado de baja: no necesita un reingreso")
    if data.fecha_ingreso <= v.fecha_baja:
        raise HTTPException(422, f"El reingreso debe ser posterior a la baja ({v.fecha_baja:%d/%m/%Y}). Si la baja fue un error, el administrador puede anularla.")
    nuevo_equipo = None
    if data.equipo_id and data.equipo_id != v.equipo_id:
        nuevo_equipo = db.get(EquipoDTS, data.equipo_id)
        if not nuevo_equipo:
            raise HTTPException(422, "Equipo DTS inexistente")
        if not alcance_de(db).permite(nuevo_equipo.regional_id):
            raise HTTPException(403, "Esa zona está fuera de tu alcance.")

    baja, motivo = v.fecha_baja, v.motivo_baja
    ingreso_anterior = v.fecha_ingreso_actual  # antes de tocar el contrato: depende de sus fechas
    ultimo = v.contrato_actual
    if ultimo and baja < ultimo.fecha_fin:  # no llegó a su fecha de fin: termina el último día que trabajó
        ultimo.fecha_fin_prevista = ultimo.fecha_fin
        ultimo.motivo_fin = motivo
        ultimo.fecha_fin = max(ultimo.fecha_inicio, baja - timedelta(days=1))
    v.periodos.append(PeriodoServicio(fecha_ingreso=ingreso_anterior, fecha_baja=baja, motivo_baja=motivo))
    v.fecha_baja, v.motivo_baja, v.fecha_reingreso = None, None, data.fecha_ingreso
    if nuevo_equipo:
        _evento(db, v, "cambio_equipo", data.fecha_ingreso, f"{v.equipo_id} -> {nuevo_equipo.id}", user.username)
        v.equipo_id = nuevo_equipo.id

    numero = (ultimo.numero + 1) if ultimo else 1
    inicio = data.fecha_ingreso
    fin = fin_contrato_por_defecto(inicio)
    _validar_sin_solape(v, inicio, fin)
    v.contratos.append(Contrato(
        numero=numero, fecha_inicio=inicio, fecha_fin=fin, dias_capacitacion=data.dias_capacitacion,
        observacion=data.observacion, creado_por=user.username,
    ))
    v.contratos.sort(key=lambda c: c.numero)
    detalle = f"Reingreso el {inicio:%d/%m/%Y} (baja anterior: {baja:%d/%m/%Y}" + (f", {motivo}" if motivo else "") + f"). Contrato nº {numero}: {inicio:%d/%m/%Y} al {fin:%d/%m/%Y}"
    _evento(db, v, "reingreso", inicio, detalle[:255], user.username)
    _guardar(db, f"Ya existe el contrato nº {numero}")
    db.commit()
    return _detalle(_get(db, vendedor_id))


@router.post("/{vendedor_id}/reactivar", response_model=schemas.VendedorDetalle)
def anular_baja(
    vendedor_id: int, data: schemas.VendedorReactivar | None = None, db: Session = Depends(get_db), user=Depends(requiere())
):
    """Anula una baja registrada por error (p. ej. faltó 3 días, lo dieron de baja y volvió a trabajar). SOLO el administrador.
    Quita la fecha y el motivo de la baja: el vendedor vuelve a figurar vigente y su contrato deja de verse «retirado».
    Los contratos no se tocan (conservan sus fechas), así que si ya había vencido seguirá figurando vencido hasta renovarlo."""
    v = _get(db, vendedor_id)
    if not v.fecha_baja:
        raise HTTPException(409, "El vendedor no está dado de baja")
    detalle = f"Baja del {v.fecha_baja:%d/%m/%Y} anulada" + (f" (motivo registrado: {v.motivo_baja})" if v.motivo_baja else "")
    if data and data.nota:
        detalle += f". {data.nota}"
    v.fecha_baja, v.motivo_baja = None, None
    _evento(db, v, "reactivacion", date.today(), detalle[:255], user.username)
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
    inicio = data.fecha_inicio or (ultimo.fecha_fin + timedelta(days=1) if ultimo else date.today())
    fin = data.fecha_fin or fin_contrato_por_defecto(inicio)
    posteriores = [c.fecha_inicio for c in v.contratos if c.fecha_inicio > inicio]
    if not data.fecha_fin and posteriores and fin >= min(posteriores):
        fin = min(posteriores) - timedelta(days=1)  # un contrato anterior termina el día antes de que empiece el siguiente
    if fin < inicio:
        raise HTTPException(422, "El fin del contrato no puede ser anterior a su inicio")
    _validar_sin_solape(v, inicio, fin)
    if data.fecha_fin_prevista and not any(c.fecha_inicio > inicio for c in v.contratos):
        raise HTTPException(422, "Un contrato que terminó antes de tiempo tiene que ser anterior a otro. Si el vendedor se retiró ahora, usa «Dar de baja».")

    # El número lo da la fecha: va después del contrato que empezó antes (o es el 1º si no hay ninguno antes).
    # Si ese lugar ya lo ocupa otro contrato, ese y los posteriores se corren un número (y sus PDF se renombran).
    previos = [c for c in v.contratos if c.fecha_inicio < inicio]
    numero = max(c.numero for c in previos) + 1 if previos else 1
    corridos = {c.numero: c.numero + 1 for c in v.contratos if c.numero >= numero}
    if corridos:
        # en dos pasos para no chocar con la restricción de número único del vendedor
        for c in v.contratos:
            if c.numero in corridos:
                c.numero += 100_000
        _guardar(db, "No se pudo reordenar los contratos")
        for c in v.contratos:
            if c.numero >= 100_000:
                c.numero = corridos[c.numero - 100_000]
        _guardar(db, "No se pudo reordenar los contratos")

    v.contratos.append(
        Contrato(
            numero=numero, fecha_inicio=inicio, fecha_fin=fin, dias_capacitacion=data.dias_capacitacion,
            observacion=data.observacion, creado_por=user.username, fecha_fin_prevista=data.fecha_fin_prevista,
            motivo_fin=data.motivo_fin if data.fecha_fin_prevista else None,
        )
    )
    v.contratos.sort(key=lambda c: c.numero)
    _sincronizar_primer_ingreso(v)
    es_renovacion = ultimo is None or inicio > ultimo.fecha_inicio
    detalle = f"Contrato nº {numero}: {inicio:%d/%m/%Y} al {fin:%d/%m/%Y}"
    if data.fecha_fin_prevista:
        detalle += f" (finalizado anticipadamente; debía durar hasta el {data.fecha_fin_prevista:%d/%m/%Y}" + (f"; motivo: {data.motivo_fin}" if data.motivo_fin else "") + ")"
    if corridos:
        detalle += ". Se renumeraron: " + ", ".join(f"nº {a} → nº {b}" for a, b in sorted(corridos.items()))
    _evento(db, v, "renovacion" if es_renovacion else "contrato_anterior", inicio, detalle[:255], user.username)
    _guardar(db, f"Ya existe el contrato nº {numero}")
    renombrados = carpetas.renumerar_archivos_contratos(db, v, corridos)
    if renombrados:
        log.info("Contratos de %s renumerados: %s archivos renombrados", v.codigo_vendedor, renombrados)
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
    prevista = cambios["fecha_fin_prevista"] if "fecha_fin_prevista" in cambios else c.fecha_fin_prevista
    if prevista and prevista <= fin:
        raise HTTPException(422, "La fecha prevista debe ser posterior al último día trabajado")
    _validar_sin_solape(v, inicio, fin, excluir_id=c.id)
    nuevo_numero = cambios.get("numero")
    if nuevo_numero and nuevo_numero != c.numero and any(o.numero == nuevo_numero for o in v.contratos):
        raise HTTPException(409, f"Ya existe el contrato nº {nuevo_numero}")
    if prevista and v.vigente and not any(o.fecha_inicio > inicio for o in v.contratos if o.id != c.id):
        raise HTTPException(422, "El último contrato de un vendedor vigente no puede figurar como finalizado anticipadamente. Si se retiró, usa «Dar de baja».")
    cont = next(o for o in v.contratos if o.id == c.id)
    if not prevista:
        cambios["motivo_fin"] = None  # sin finalización anticipada no hay motivo
    if not v.vigente and cont is v.contrato_actual:
        # El contrato en el que se retiró: sus fechas y su salida dependen de la baja y se cambian con «Corregir baja».
        for campo in ("fecha_inicio", "fecha_fin", "fecha_fin_prevista", "motivo_fin"):
            if campo in cambios and cambios[campo] != getattr(cont, campo):
                raise HTTPException(422, "El vendedor está retirado: las fechas y el motivo de salida de este contrato se corrigen con «Corregir baja».")
    for k, val in cambios.items():
        if val is None and k not in ("observacion", "fecha_fin_prevista", "motivo_fin"):
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
