"""Importación mensual de vendedores desde el Excel de RRHH (subida desde el sistema o desde la línea de comandos).

Es una carga **repetible**: se puede subir septiembre y luego octubre (o el mismo archivo corregido) sin duplicar
nada. Con cada fila, según el código del vendedor:

  - Si no existe  -> se crea con su contrato vigente (FECHA DE INGRESO = inicio; FECHA DE SALIDA = fin del contrato
                     si está ACTIVO/NUEVO, o fecha de baja si está RETIRADO; NUEVO = 3 días de capacitación).
  - Si ya existe  -> se completan o corrigen sus datos con lo que traiga el Excel (nunca se borra un dato porque la
                     celda venga vacía), se registra la baja si ahora figura RETIRADO y se registra el cambio de equipo si
                     cambió de zona. Sus contratos NO se tocan (renovaciones y ajustes se hacen en la ficha).
  - Nunca se elimina un vendedor porque no aparezca en el archivo.

Lo dudoso (código vacío o repetido, carnet repetido, zona desconocida, fechas ilegibles, reingresos) no se carga:
queda en el reporte para corregirlo en el Excel y volver a subirlo. Columna opcional «Nº CONTRATO»: número del
contrato vigente. No se importan: cuenta bancaria, ciudad, mes de reporte ni totales de asistencia (salen del BI).
"""
import difflib
import io
import re
import unicodedata
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime

import openpyxl
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload, selectinload

from app.core.alcance import alcance_de
from app.models import Contrato, EquipoDTS, HistorialVendedor, Vendedor
from app.services.calculos import fin_contrato_por_defecto

ZONA_A_EQUIPO = {
    "COCHABAMBA": "DTS Cochabamba",
    "EL ALTO": "DTS El Alto",
    "LA PAZ": "DTS La Paz",
    "SCZ EQUIPO 1": "DTS 1",
    "SCZ EQUIPO 2": "DTS 2",
}
DIAS_CAPACITACION_NUEVO = 3
MAX_FILAS = 3000


class ErrorExcel(ValueError):
    """El archivo no se puede leer o no tiene el formato esperado (mensaje apto para mostrar)."""


def _clave(texto) -> str:
    t = unicodedata.normalize("NFKD", str(texto or "")).encode("ascii", "ignore").decode()
    return re.sub(r"\s+", " ", t).strip().upper()


def _texto(v) -> str | None:
    if v is None:
        return None
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    t = str(v).strip()
    return t or None


def _fecha(v) -> date | None:
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    if isinstance(v, str) and v.strip():
        for fmt in ("%d/%m/%Y", "%d-%m-%Y", "%Y-%m-%d"):
            try:
                return datetime.strptime(v.strip(), fmt).date()
            except ValueError:
                pass
    return None


def _invertir(d: date) -> date | None:
    """Día y mes intercambiados (9 de noviembre <-> 11 de septiembre), si el resultado es válido."""
    try:
        return date(d.year, d.day, d.month)
    except ValueError:
        return None


def _nombre_clave(n: str) -> str:
    """Nombre sin acentos, en mayúsculas y con las palabras ordenadas (para comparar «PEREZ JUAN» con «JUAN PEREZ»)."""
    return " ".join(sorted(_clave(n).split()))


def _parecido(a: str, b: str) -> float:
    return difflib.SequenceMatcher(None, _nombre_clave(a), _nombre_clave(b)).ratio()


UMBRAL_MISMO_NOMBRE = 0.72  # por debajo: parece otra persona
UMBRAL_SUGERENCIA = 0.88  # para proponer «el BI tiene a esta persona con el código X»


def cruce_con_bi(filas: list[dict], usuarios_bi: list[tuple[str, str, str]]) -> list[dict]:
    """Compara el código de cada vendedor del Excel con el BI. Un código equivocado hace que la asistencia salga en cero
    (la asistencia se lee del BI por código), así que se avisa:
      - el código no existe en el BI,
      - el código existe pero es de OTRA persona (se indica quién) y, si el BI tiene a esta persona con otro código,
        cuál es.
    Solo son avisos: no se bloquea la carga (un ingreso muy reciente puede no estar aún en el BI)."""
    por_codigo = {c: (n, r) for c, n, r in usuarios_bi}
    obs = []
    for f in filas:
        cod, nombre = f["codigo"], f["nombre"]
        mejor = max(((_parecido(nombre, n), c, n) for c, n, _ in usuarios_bi), default=(0.0, "", ""))
        sugerido = f" El BI tiene a «{mejor[2]}» con el código {mejor[1]}: ¿es ese?" if mejor[0] >= UMBRAL_SUGERENCIA and mejor[1] != cod else ""
        if cod not in por_codigo:
            obs.append(_obs("AVISO", f["fila"], cod, nombre, f"BI: el código {cod} no existe en el BI, su asistencia saldría en cero." + (sugerido or " (si ingresó hace muy poco puede ser normal)")))
        elif _parecido(nombre, por_codigo[cod][0]) < UMBRAL_MISMO_NOMBRE:
            obs.append(_obs("AVISO", f["fila"], cod, nombre, f"BI: el código {cod} pertenece a «{por_codigo[cod][0]}», no a esta persona." + sugerido))
    return obs


def _obs(nivel: str, fila: int, codigo, nombre, mensaje: str) -> dict:
    return {"nivel": nivel, "fila": fila, "codigo": codigo or "", "nombre": nombre or "", "mensaje": mensaje}


# ── Lectura ──────────────────────────────────────────────────────────────────

def leer_excel(contenido: bytes) -> list[dict]:
    if not contenido.startswith(b"PK"):
        raise ErrorExcel("El archivo no es un Excel (.xlsx) válido.")
    try:
        hoja = openpyxl.load_workbook(io.BytesIO(contenido), data_only=True, read_only=True).worksheets[0]
        filas = list(hoja.iter_rows(values_only=True))
    except Exception as e:  # openpyxl lanza varios tipos según el daño del archivo
        raise ErrorExcel("No se pudo leer el Excel. ¿Está dañado o protegido con contraseña?") from e
    if not filas:
        raise ErrorExcel("El Excel está vacío.")
    if len(filas) > MAX_FILAS:
        raise ErrorExcel(f"El Excel tiene demasiadas filas ({len(filas)}). ¿Es el archivo correcto?")
    cab = [_clave(c) for c in filas[0]]

    def col(*nombres):
        for n in nombres:
            for i, c in enumerate(cab):
                if c == _clave(n):
                    return i
        return None

    idx = {
        "codigo": col("CODIGO"), "documento": col("CARNET DE IDENTIDAD"), "nombre": col("NOMBRE DEL COLABORADOR"),
        "zona": col("ZONA"), "cargo": col("CARGO"), "area": col("AREA"), "ingreso": col("FECHA DE INGRESO"),
        "salida": col("FECHA DE SALIDA"), "nacimiento": col("FECHA DE NACIMIENTO"), "sexo": col("SEXO (F/M)", "SEXO"),
        "tel_corp": col("NUMERO CORPORATIVO"), "tel_pers": col("NUMERO PERSONAL"), "estado": col("ESTADO ACTUAL"),
        "motivo": col("MOTIVO DE RETIRO"),
        "contrato": col("NO CONTRATO", "N CONTRATO", "NRO CONTRATO", "NUMERO DE CONTRATO", "NRO DE CONTRATO", "CONTRATO",
                        "NUMERO DE CONTRATOS", "NRO DE CONTRATOS", "CANTIDAD DE CONTRATOS"),
    }
    faltan = [k for k in ("codigo", "nombre", "zona", "ingreso") if idx[k] is None]
    if faltan:
        nombres = {"codigo": "CÓDIGO", "nombre": "NOMBRE DEL COLABORADOR", "zona": "ZONA", "ingreso": "FECHA DE INGRESO"}
        raise ErrorExcel("Faltan columnas obligatorias en el Excel: " + ", ".join(nombres[k] for k in faltan) + ".")

    def get(fila, k):
        return fila[idx[k]] if idx[k] is not None and idx[k] < len(fila) else None

    datos = []
    for n, fila in enumerate(filas[1:], start=2):
        if not any(v is not None and str(v).strip() for v in fila):
            continue
        datos.append({k: get(fila, k) for k in idx} | {"_fila": n, "_tiene_contrato": idx["contrato"] is not None})
    return datos


# ── Validación fila por fila ─────────────────────────────────────────────────

def preparar(datos: list[dict], corregir_fechas: bool = False, codigos: dict[int, str] | None = None):
    """Devuelve (filas_ok, observaciones). Cada observación: {nivel, fila, codigo, nombre, mensaje}."""
    problemas: list[dict] = []
    for d in datos:
        if codigos and d["_fila"] in codigos:
            problemas.append(_obs("CORREGIDO", d["_fila"], codigos[d["_fila"]], _texto(d["nombre"]),
                                  f"código {_texto(d['codigo'])} reemplazado por {codigos[d['_fila']]}"))
            d["codigo"] = codigos[d["_fila"]]
    hoy = date.today()
    por_codigo, por_doc = defaultdict(list), defaultdict(list)
    for d in datos:
        if _texto(d["codigo"]):  # las filas sin código se reportan aparte («falta código»)
            por_codigo[_texto(d["codigo"])].append(d)
        if _texto(d["documento"]):
            por_doc[_texto(d["documento"])].append(d)
    omitir: set[int] = set()
    for cod, grupo in por_codigo.items():
        if len(grupo) > 1:
            for d in grupo:
                omitir.add(d["_fila"])
                problemas.append(_obs("OMITIDO", d["_fila"], cod, _texto(d["nombre"]),
                                      f"código repetido en {len(grupo)} filas (personas distintas): corrige el código en el Excel"))
    for doc, grupo in por_doc.items():
        if len(grupo) > 1:
            for d in grupo:
                if d["_fila"] not in omitir:
                    omitir.add(d["_fila"])
                    problemas.append(_obs("OMITIDO", d["_fila"], _texto(d["codigo"]), _texto(d["nombre"]),
                                          "carnet de identidad repetido en el Excel"))

    ok = []
    for d in datos:
        fila, cod, nombre = d["_fila"], _texto(d["codigo"]) or "", _texto(d["nombre"]) or ""
        if fila in omitir:
            continue

        def error(msg):
            problemas.append(_obs("OMITIDO", fila, cod, nombre, msg))

        if not cod or not nombre:
            error("falta código o nombre" + (" (¿aún no tiene código asignado?)" if not cod and nombre else ""))
            continue
        equipo = ZONA_A_EQUIPO.get(_clave(d["zona"]))
        if not equipo:
            error(f"zona desconocida: {d['zona']!r}")
            continue
        ingreso = _fecha(d["ingreso"])
        if not ingreso:
            error(f"fecha de ingreso ilegible: {d['ingreso']!r}")
            continue
        if isinstance(d["ingreso"], str):
            problemas.append(_obs("AVISO", fila, cod, nombre, f"fecha de ingreso venía como texto ({d['ingreso']}); se leyó como día/mes/año"))
        if ingreso > hoy:
            alterna = _invertir(ingreso)
            if alterna and alterna <= hoy:
                if corregir_fechas:
                    problemas.append(_obs("CORREGIDO", fila, cod, nombre, f"ingreso {ingreso:%d/%m/%Y} está en el futuro; se invirtió día/mes -> {alterna:%d/%m/%Y}"))
                    ingreso = alterna
                else:
                    problemas.append(_obs("AVISO", fila, cod, nombre, f"ingreso {ingreso:%d/%m/%Y} está en el futuro; ¿sería {alterna:%d/%m/%Y}? (marca «corregir fechas invertidas»)"))
            else:
                problemas.append(_obs("AVISO", fila, cod, nombre, f"ingreso {ingreso:%d/%m/%Y} está en el futuro"))

        estado = _clave(d["estado"])
        salida = _fecha(d["salida"]) if d["salida"] is not None and str(d["salida"]).strip() else None
        if d["salida"] is not None and str(d["salida"]).strip() and not salida:
            error(f"fecha de salida ilegible: {d['salida']!r}")
            continue
        retirado = estado == "RETIRADO"
        baja = fin = None
        if retirado:
            if not salida:
                error("está RETIRADO pero no tiene fecha de salida")
                continue
            baja = salida
            if baja < ingreso:
                error(f"la baja ({baja:%d/%m/%Y}) es anterior al ingreso ({ingreso:%d/%m/%Y})")
                continue
            if baja > hoy:
                error(f"está RETIRADO pero su fecha de salida ({baja:%d/%m/%Y}) está en el futuro: verifica el año en el Excel")
                continue
        elif salida:
            if salida > ingreso:
                fin = salida
            else:
                problemas.append(_obs("AVISO", fila, cod, nombre, f"fecha de salida {salida:%d/%m/%Y} no es posterior al ingreso; se usó 1 año desde el ingreso"))
        fin = fin or fin_contrato_por_defecto(ingreso)
        if baja:
            fin = min(fin, baja)  # el contrato termina con la salida

        sexo = _clave(d["sexo"])[:1] or None
        if sexo not in (None, "M", "F"):
            problemas.append(_obs("AVISO", fila, cod, nombre, f"sexo no reconocido: {d['sexo']!r}"))
            sexo = None
        numero, explicito = 1, False
        if d["contrato"] is not None and str(d["contrato"]).strip():
            try:
                numero, explicito = max(1, int(float(d["contrato"]))), True
            except (TypeError, ValueError):
                problemas.append(_obs("AVISO", fila, cod, nombre, f"nº de contrato no numérico ({d['contrato']!r}); se usó 1"))
        ok.append({
            "fila": fila, "codigo": cod, "nombre": nombre, "equipo": equipo, "documento": _texto(d["documento"]),
            "sexo": sexo, "nacimiento": _fecha(d["nacimiento"]), "tel_corp": _texto(d["tel_corp"]), "tel_pers": _texto(d["tel_pers"]),
            "cargo": _texto(d["cargo"]), "area": _texto(d["area"]),
            "ingreso": ingreso, "fin": fin, "baja": baja, "motivo": _texto(d["motivo"]) if retirado else None,
            "capacitacion": DIAS_CAPACITACION_NUEVO if estado == "NUEVO" else 0, "numero": numero,
            "numero_explicito": explicito, "estado": estado,
        })
    return ok, problemas


# ── Plan (qué se haría) y aplicación ─────────────────────────────────────────

@dataclass
class Plan:
    filas_leidas: int = 0
    nuevos: list[dict] = field(default_factory=list)
    cambios: list[dict] = field(default_factory=list)  # {fila, codigo, nombre, cambios: [str], _v, _acciones}
    sin_cambios: int = 0
    observaciones: list[dict] = field(default_factory=list)

    @property
    def omitidos(self) -> int:
        return sum(1 for o in self.observaciones if o["nivel"] == "OMITIDO")


def _igual(a, b) -> bool:
    return _clave(a) == _clave(b)


def planificar(db: Session, datos: list[dict], corregir_fechas: bool = False, usuarios_bi: list | None = None) -> Plan:
    ok, obs = preparar(datos, corregir_fechas)
    if usuarios_bi:
        obs.extend(cruce_con_bi(ok, usuarios_bi))
    plan = Plan(filas_leidas=len(datos), observaciones=obs)
    alcance = alcance_de(db)
    equipos = {e.nombre: e for e in db.scalars(select(EquipoDTS))}
    por_codigo = {
        v.codigo_vendedor: v
        for v in db.scalars(select(Vendedor).options(joinedload(Vendedor.equipo), selectinload(Vendedor.contratos)))
    }
    doc_de = {v.documento: v for v in por_codigo.values() if v.documento}

    for f in ok:
        cod, nombre, fila = f["codigo"], f["nombre"], f["fila"]
        equipo = equipos.get(f["equipo"])
        if equipo is None:
            obs.append(_obs("OMITIDO", fila, cod, nombre, f"no existe el equipo {f['equipo']} (ejecuta seed.py)"))
            continue
        if not alcance.permite(equipo.regional_id):
            obs.append(_obs("OMITIDO", fila, cod, nombre, f"la zona {f['equipo']} está fuera de tu alcance: solo puedes cargar vendedores de tus regionales"))
            continue
        v = por_codigo.get(cod)
        if v is not None and not alcance.permite(v.equipo.regional_id):
            obs.append(_obs("OMITIDO", fila, cod, nombre, "este vendedor pertenece a una regional fuera de tu alcance"))
            continue
        if v is None:
            if f["documento"] and f["documento"] in doc_de:
                otro = doc_de[f["documento"]]
                if _parecido(nombre, otro.nombre) >= UMBRAL_MISMO_NOMBRE:
                    obs.append(_obs("OMITIDO", fila, cod, nombre, f"es la misma persona que {otro.nombre}, que en el sistema tiene el código {otro.codigo_vendedor} y el Excel trae {cod}: corrige el código en el Excel (o en su ficha)"))
                else:
                    obs.append(_obs("OMITIDO", fila, cod, nombre, f"el carnet ya pertenece a otro vendedor ({otro.nombre})"))
                continue
            plan.nuevos.append(f | {"_equipo_id": equipo.id})
            continue

        # ── vendedor existente: qué cambia
        cambios: list[str] = []
        acciones: list = []

        def poner(campo: str, etiqueta: str, nuevo, fmt=lambda x: x):
            actual = getattr(v, campo)
            cambios.append(f"{etiqueta}: {fmt(actual) if actual else '—'} → {fmt(nuevo)}")
            acciones.append(_asignar(v, campo, nuevo))

        if f["documento"] and v.documento != f["documento"]:
            if f["documento"] in doc_de and doc_de[f["documento"]].id != v.id:
                obs.append(_obs("OMITIDO", fila, cod, nombre, f"el carnet {f['documento']} ya pertenece a otro vendedor ({doc_de[f['documento']].nombre})"))
                continue
            poner("documento", "carnet", f["documento"])
        if nombre and not _igual(v.nombre, nombre):
            poner("nombre", "nombre", nombre)
        if f["sexo"] and v.sexo != f["sexo"]:
            poner("sexo", "sexo", f["sexo"])
        if f["nacimiento"] and v.fecha_nacimiento != f["nacimiento"]:
            poner("fecha_nacimiento", "nacimiento", f["nacimiento"], lambda d: d.strftime("%d/%m/%Y"))
        if f["tel_corp"] and v.telefono_corporativo != f["tel_corp"]:
            poner("telefono_corporativo", "tel. corporativo", f["tel_corp"])
        if f["tel_pers"] and v.telefono_personal != f["tel_pers"]:
            poner("telefono_personal", "tel. personal", f["tel_pers"])
        if f["cargo"] and not _igual(v.cargo, f["cargo"]):
            poner("cargo", "cargo", f["cargo"])
        if f["area"] and not _igual(v.area, f["area"]):
            poner("area", "área", f["area"])
        if v.equipo_id != equipo.id:
            cambios.append(f"equipo: {v.equipo.nombre} → {equipo.nombre}")
            acciones.append(_traslado(db, v, equipo))

        if f["baja"]:
            if v.fecha_baja is None:
                posteriores = [c.numero for c in v.contratos if c.fecha_inicio > f["baja"]]
                if f["baja"] < v.fecha_primer_ingreso:
                    obs.append(_obs("AVISO", fila, cod, nombre, f"la baja {f['baja']:%d/%m/%Y} es anterior a su primer ingreso; no se registró"))
                elif posteriores:
                    obs.append(_obs("AVISO", fila, cod, nombre, "la baja es anterior a un contrato posterior (nº " + ", ".join(map(str, posteriores)) + "); no se registró"))
                else:
                    cambios.append(f"BAJA el {f['baja']:%d/%m/%Y}" + (f" ({f['motivo']})" if f["motivo"] else ""))
                    acciones.append(_baja(db, v, f["baja"], f["motivo"]))
            elif v.fecha_baja != f["baja"]:
                obs.append(_obs("AVISO", fila, cod, nombre, f"el sistema tiene la baja el {v.fecha_baja:%d/%m/%Y} y el Excel el {f['baja']:%d/%m/%Y}; no se cambió"))
        elif v.fecha_baja is not None:
            obs.append(_obs("AVISO", fila, cod, nombre, "el Excel lo marca activo pero en el sistema está dado de baja; no se cambió (si reingresó, regístralo desde su ficha)"))

        if f["ingreso"] > v.fecha_primer_ingreso:
            obs.append(_obs("AVISO", fila, cod, nombre, f"el ingreso del Excel ({f['ingreso']:%d/%m/%Y}) difiere del primer ingreso en el sistema ({v.fecha_primer_ingreso:%d/%m/%Y}); no se cambió"))
        if f["numero_explicito"] and len(v.contratos) == 1 and v.contratos[0].numero != f["numero"]:
            c = v.contratos[0]
            cambios.append(f"nº de contrato: {c.numero} → {f['numero']}")
            acciones.append(_asignar(c, "numero", f["numero"]))

        if cambios:
            plan.cambios.append({"fila": fila, "codigo": cod, "nombre": v.nombre, "cambios": cambios, "_acciones": acciones, "_v": v})
        else:
            plan.sin_cambios += 1
    return plan


def _evento(db: Session, v: Vendedor, evento: str, fecha: date, detalle: str | None, usuario: str):
    db.add(HistorialVendedor(vendedor_id=v.id, evento=evento, fecha=fecha, detalle=detalle, equipo_id=v.equipo_id, usuario=usuario))


# Cada acción del plan es una función que recibe el usuario que aplica la importación. Se crean con estas funciones
# (y no con lambdas dentro del bucle) para que cada una conserve SU vendedor y SU valor.
def _asignar(obj, campo: str, valor):
    return lambda usuario: setattr(obj, campo, valor)


def _traslado(db: Session, v: Vendedor, equipo: EquipoDTS):
    def hacer(usuario: str):
        antes = v.equipo.nombre
        v.equipo_id, v.equipo = equipo.id, equipo
        db.flush()
        _evento(db, v, "cambio_equipo", date.today(), f"De {antes} a {equipo.nombre} (importación Excel)", usuario)
    return hacer


def _baja(db: Session, v: Vendedor, baja: date, motivo: str | None):
    def hacer(usuario: str):
        v.fecha_baja, v.motivo_baja = baja, motivo
        db.flush()
        _evento(db, v, "baja", baja, motivo, usuario)
    return hacer


def aplicar(db: Session, plan: Plan, usuario: str) -> dict:
    """Escribe el plan en la base (sin confirmar: la transacción la cierra quien llama). Devuelve un resumen."""
    nuevos_v: list[Vendedor] = []
    for f in plan.nuevos:
        v = Vendedor(
            codigo_vendedor=f["codigo"], documento=f["documento"], nombre=f["nombre"], sexo=f["sexo"],
            fecha_nacimiento=f["nacimiento"], telefono_corporativo=f["tel_corp"], telefono_personal=f["tel_pers"],
            cargo=f["cargo"] or "ASESOR COMERCIAL", area=f["area"] or "VENTAS", equipo_id=f["_equipo_id"],
            fecha_primer_ingreso=f["ingreso"], fecha_baja=f["baja"], motivo_baja=f["motivo"], creado_por=usuario,
        )
        v.contratos.append(Contrato(
            numero=f["numero"], fecha_inicio=f["ingreso"], fecha_fin=f["fin"],
            dias_capacitacion=f["capacitacion"], creado_por=usuario,
        ))
        db.add(v)
        db.flush()
        _evento(db, v, "alta", f["ingreso"], "Importado desde Excel", usuario)
        if f["baja"]:
            _evento(db, v, "baja", f["baja"], f["motivo"], usuario)
        nuevos_v.append(v)
    for c in plan.cambios:
        for accion in c["_acciones"]:
            accion(usuario)
        db.flush()
    return {"nuevos": nuevos_v}


def resumen(plan: Plan) -> dict:
    """Parte del plan que se muestra al usuario (sin objetos internos)."""
    hoy = date.today()
    vig = [f for f in plan.nuevos if not f["baja"]]
    return {
        "filas_leidas": plan.filas_leidas,
        "nuevos": [
            {"fila": f["fila"], "codigo": f["codigo"], "nombre": f["nombre"], "equipo": f["equipo"], "estado": f["estado"] or "—",
             "ingreso": f["ingreso"], "baja": f["baja"]}
            for f in plan.nuevos
        ],
        "actualizados": [{k: c[k] for k in ("fila", "codigo", "nombre", "cambios")} for c in plan.cambios],
        "sin_cambios": plan.sin_cambios,
        "omitidos": plan.omitidos,
        "bajas": sum(1 for f in plan.nuevos if f["baja"]) + sum(1 for c in plan.cambios if any(x.startswith("BAJA") for x in c["cambios"])),
        "por_equipo": dict(Counter(f["equipo"] for f in plan.nuevos)),
        "contratos_vencidos": sum(1 for f in vig if f["fin"] < hoy),
        "por_vencer": sum(1 for f in vig if 0 <= (f["fin"] - hoy).days <= 30),
        "observaciones": sorted(plan.observaciones, key=lambda o: (o["nivel"] != "OMITIDO", o["nivel"] != "AVISO", o["fila"])),
    }
