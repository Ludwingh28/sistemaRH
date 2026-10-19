"""Importa vendedores y su contrato vigente desde el Excel de RRHH.

    python importar_vendedores.py "../recurses/9. Septiembre.xlsx"                  # simulación (no escribe)
    python importar_vendedores.py "../recurses/9. Septiembre.xlsx" --aplicar        # carga en la base
    python importar_vendedores.py archivo.xlsx --aplicar --corregir-fechas          # además corrige día/mes invertidos
    python importar_vendedores.py archivo.xlsx --codigo 13=4112                     # cambia el código de la fila 13 del Excel

Qué hace con cada fila:
  - Crea el vendedor y su contrato (el nº del contrato sale de la columna "Nº CONTRATO" si existe; si no, 1).
  - FECHA DE INGRESO = inicio del contrato. FECHA DE SALIDA = fin del contrato si está ACTIVO/NUEVO,
    o fecha de baja si está RETIRADO.
  - ESTADO "NUEVO" => 3 días de capacitación (así lo cuenta el reporte); el resto, sin capacitación.
  - No se importan datos que no hacen falta: cuenta bancaria, mes de reporte ni totales de asistencia.
Lo dudoso (código repetido, carnet repetido, zona desconocida, fechas ilegibles) se omite y queda en el reporte.
"""
import argparse
import io
import re
import sys
import unicodedata
from collections import Counter, defaultdict
from datetime import date, datetime
from pathlib import Path

import openpyxl
from sqlalchemy import select

from app.core.database import SessionLocal
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


def leer_excel(ruta: Path) -> list[dict]:
    try:
        contenido = ruta.read_bytes()
    except PermissionError:
        sys.exit(f"No se puede leer {ruta}. Si está abierto en Excel, ciérralo y reintenta.")
    hoja = openpyxl.load_workbook(io.BytesIO(contenido), data_only=True).active
    filas = list(hoja.iter_rows(values_only=True))
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
        "contrato": col("NO CONTRATO", "N CONTRATO", "NRO CONTRATO", "NUMERO DE CONTRATO", "NRO DE CONTRATO", "CONTRATO"),
    }
    faltan = [k for k in ("codigo", "nombre", "zona", "ingreso") if idx[k] is None]
    if faltan:
        sys.exit(f"Faltan columnas obligatorias en el Excel: {', '.join(faltan)}")

    def get(fila, k):
        return fila[idx[k]] if idx[k] is not None and idx[k] < len(fila) else None

    datos = []
    for n, fila in enumerate(filas[1:], start=2):
        if not any(v is not None for v in fila):
            continue
        datos.append({k: get(fila, k) for k in idx} | {"_fila": n})
    return datos


def preparar(datos: list[dict], corregir_fechas: bool, codigos: dict[int, str] | None = None):
    """Devuelve (filas_ok, problemas). Cada problema: (nivel, fila, código, nombre, mensaje)."""
    problemas: list[tuple[str, int, str, str, str]] = []
    for d in datos:
        if codigos and d["_fila"] in codigos:
            problemas.append(("CORREGIDO", d["_fila"], codigos[d["_fila"]], _texto(d["nombre"]) or "",
                              f"código {_texto(d['codigo'])} reemplazado por {codigos[d['_fila']]}"))
            d["codigo"] = codigos[d["_fila"]]
    hoy = date.today()
    por_codigo, por_doc = defaultdict(list), defaultdict(list)
    for d in datos:
        por_codigo[_texto(d["codigo"])].append(d)
        if _texto(d["documento"]):
            por_doc[_texto(d["documento"])].append(d)
    omitir: set[int] = set()
    for cod, grupo in por_codigo.items():
        if len(grupo) > 1:
            for d in grupo:
                omitir.add(d["_fila"])
                problemas.append(("OMITIDO", d["_fila"], cod, _texto(d["nombre"]) or "", f"código repetido en {len(grupo)} filas (personas distintas): decide a quién pertenece"))
    for doc, grupo in por_doc.items():
        if len(grupo) > 1:
            for d in grupo:
                if d["_fila"] not in omitir:
                    omitir.add(d["_fila"])
                    problemas.append(("OMITIDO", d["_fila"], _texto(d["codigo"]) or "", _texto(d["nombre"]) or "", "carnet de identidad repetido"))

    ok = []
    for d in datos:
        fila, cod, nombre = d["_fila"], _texto(d["codigo"]) or "", _texto(d["nombre"]) or ""
        if fila in omitir:
            continue

        def error(msg):
            problemas.append(("OMITIDO", fila, cod, nombre, msg))

        if not cod or not nombre:
            error("falta código o nombre")
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
            problemas.append(("AVISO", fila, cod, nombre, f"fecha de ingreso venía como texto ({d['ingreso']}); se leyó como día/mes/año"))
        if ingreso > hoy:
            alterna = _invertir(ingreso)
            if alterna and alterna <= hoy:
                if corregir_fechas:
                    problemas.append(("CORREGIDO", fila, cod, nombre, f"ingreso {ingreso:%d/%m/%Y} está en el futuro; se invirtió día/mes -> {alterna:%d/%m/%Y}"))
                    ingreso = alterna
                else:
                    problemas.append(("AVISO", fila, cod, nombre, f"ingreso {ingreso:%d/%m/%Y} está en el futuro; ¿sería {alterna:%d/%m/%Y}? (usa --corregir-fechas)"))
            else:
                problemas.append(("AVISO", fila, cod, nombre, f"ingreso {ingreso:%d/%m/%Y} está en el futuro"))

        estado = _clave(d["estado"])
        salida = _fecha(d["salida"]) if d["salida"] is not None else None
        if d["salida"] is not None and not salida:
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
        elif salida:
            if salida > ingreso:
                fin = salida
            else:
                problemas.append(("AVISO", fila, cod, nombre, f"fecha de salida {salida:%d/%m/%Y} no es posterior al ingreso; se usó 1 año desde el ingreso"))
        fin = fin or fin_contrato_por_defecto(ingreso)
        if baja:
            fin = min(fin, baja)  # el contrato termina con la salida

        sexo = _clave(d["sexo"])[:1] or None
        if sexo not in (None, "M", "F"):
            problemas.append(("AVISO", fila, cod, nombre, f"sexo no reconocido: {d['sexo']!r}"))
            sexo = None
        numero = 1
        if d["contrato"] is not None:
            try:
                numero = max(1, int(d["contrato"]))
            except (TypeError, ValueError):
                problemas.append(("AVISO", fila, cod, nombre, f"nº de contrato no numérico ({d['contrato']!r}); se usó 1"))
        ok.append({
            "fila": fila, "codigo": cod, "nombre": nombre, "equipo": equipo, "documento": _texto(d["documento"]),
            "sexo": sexo, "nacimiento": _fecha(d["nacimiento"]), "tel_corp": _texto(d["tel_corp"]), "tel_pers": _texto(d["tel_pers"]),
            "cargo": _texto(d["cargo"]) or "ASESOR COMERCIAL", "area": _texto(d["area"]) or "VENTAS",
            "ingreso": ingreso, "fin": fin, "baja": baja, "motivo": _texto(d["motivo"]) if retirado else None,
            "capacitacion": DIAS_CAPACITACION_NUEVO if estado == "NUEVO" else 0, "numero": numero, "estado": estado,
        })
    return ok, problemas


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("archivo")
    ap.add_argument("--aplicar", action="store_true", help="escribir en la base (sin esto es solo simulación)")
    ap.add_argument("--corregir-fechas", action="store_true", help="invertir día/mes en fechas de ingreso futuras")
    ap.add_argument("--codigo", action="append", default=[], metavar="FILA=CODIGO",
                    help="reemplaza el código de una fila del Excel (repetible)")
    a = ap.parse_args()
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")

    try:
        codigos = {int(k): v.strip() for k, v in (x.split("=", 1) for x in a.codigo)}
    except ValueError:
        sys.exit("--codigo debe tener el formato FILA=CODIGO, por ejemplo --codigo 13=4112")
    datos = leer_excel(Path(a.archivo))
    ok, problemas = preparar(datos, a.corregir_fechas, codigos)

    with SessionLocal() as db:
        equipos = {e.nombre: e.id for e in db.scalars(select(EquipoDTS))}
        existentes = set(db.scalars(select(Vendedor.codigo_vendedor)))
        docs = set(db.scalars(select(Vendedor.documento).where(Vendedor.documento.is_not(None))))
        nuevos = []
        for f in ok:
            if f["codigo"] in existentes:
                problemas.append(("OMITIDO", f["fila"], f["codigo"], f["nombre"], "ya existe en la base"))
            elif f["documento"] and f["documento"] in docs:
                problemas.append(("OMITIDO", f["fila"], f["codigo"], f["nombre"], "el carnet ya existe en la base"))
            elif f["equipo"] not in equipos:
                problemas.append(("OMITIDO", f["fila"], f["codigo"], f["nombre"], f"no existe el equipo {f['equipo']} (ejecuta seed.py)"))
            else:
                nuevos.append(f)

        print(f"\nArchivo: {a.archivo}")
        print(f"Filas leídas: {len(datos)} | a cargar: {len(nuevos)} | omitidas: {len(datos) - len(nuevos)}")
        print("Por equipo:", dict(Counter(f["equipo"] for f in nuevos)))
        print("Por estado:", dict(Counter(f["estado"] for f in nuevos)))
        vencidos = [f for f in nuevos if not f["baja"] and f["fin"] < date.today()]
        por_vencer = [f for f in nuevos if not f["baja"] and 0 <= (f["fin"] - date.today()).days <= 30]
        print(f"Contratos ya vencidos sin renovar: {len(vencidos)} | por vencer en 30 días: {len(por_vencer)}")
        if problemas:
            print(f"\n{len(problemas)} observaciones:")
            for nivel, fila, cod, nombre, msg in sorted(problemas, key=lambda p: (p[0] != "OMITIDO", p[1])):
                print(f"  [{nivel:<9}] fila {fila:>3} · cód {cod:<6} · {nombre[:32]:<32} · {msg}")
        print("\nNota: cada colaborador entra con UN contrato (el vigente). Si ya lleva varios años, agrega la columna "
              "'Nº CONTRATO' al Excel o completa los anteriores desde la pantalla de Vendedores.")

        if not a.aplicar:
            print("\nSIMULACIÓN: no se escribió nada. Usa --aplicar para cargar.")
            return
        for f in nuevos:
            v = Vendedor(
                codigo_vendedor=f["codigo"], documento=f["documento"], nombre=f["nombre"], sexo=f["sexo"],
                fecha_nacimiento=f["nacimiento"], telefono_corporativo=f["tel_corp"], telefono_personal=f["tel_pers"],
                cargo=f["cargo"], area=f["area"], equipo_id=equipos[f["equipo"]], fecha_primer_ingreso=f["ingreso"],
                fecha_baja=f["baja"], motivo_baja=f["motivo"], creado_por="importacion",
            )
            v.contratos.append(Contrato(
                numero=f["numero"], fecha_inicio=f["ingreso"], fecha_fin=f["fin"],
                dias_capacitacion=f["capacitacion"], creado_por="importacion",
            ))
            db.add(v)
            db.flush()
            db.add(HistorialVendedor(vendedor_id=v.id, evento="alta", fecha=f["ingreso"], detalle="Importado desde Excel",
                                     equipo_id=v.equipo_id, usuario="importacion"))
            if f["baja"]:
                db.add(HistorialVendedor(vendedor_id=v.id, evento="baja", fecha=f["baja"], detalle=f["motivo"],
                                         equipo_id=v.equipo_id, usuario="importacion"))
        db.commit()
        print(f"\nCARGADOS {len(nuevos)} vendedores.")


if __name__ == "__main__":
    main()
