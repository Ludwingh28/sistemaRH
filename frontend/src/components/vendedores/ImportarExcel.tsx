import { AlertTriangle, Check, FileSpreadsheet, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { api } from '../../api'
import { fmt } from '../../format'
import type { Importacion } from '../../types'
import { ErrorBox, Modal } from '../ui'
import ZonaSuelta from './ZonaSuelta'

const NIVEL: Record<string, { texto: string; clase: string }> = {
  OMITIDO: { texto: 'No se carga', clase: 'bg-red-100 text-red-700' },
  AVISO: { texto: 'Aviso', clase: 'bg-amber-100 text-amber-700' },
  CORREGIDO: { texto: 'Corregido', clase: 'bg-sky-100 text-sky-700' },
}

function Cifra({ valor, etiqueta, color }: { valor: number; etiqueta: string; color: string }) {
  return (
    <div className="card p-3 text-center">
      <p className={`text-2xl font-semibold tabular-nums ${color}`}>{valor}</p>
      <p className="mt-0.5 text-[11px] text-slate-500">{etiqueta}</p>
    </div>
  )
}

/** Sube el Excel mensual de RRHH: primero lo revisa (sin escribir) y, si todo está bien, lo carga. */
export default function ImportarExcel({
  onClose,
  onListo,
}: {
  onClose: () => void
  onListo: (mensaje: string) => void
}) {
  const [archivo, setArchivo] = useState<File | null>(null)
  const [corregir, setCorregir] = useState(false)
  const [r, setR] = useState<Importacion | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [verNuevos, setVerNuevos] = useState(false)

  const revisar = async (f: File, corregirFechas = corregir) => {
    setError('')
    setBusy(true)
    setR(null)
    try {
      setR(await api.importarVendedores(f, false, corregirFechas))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const elegir = (archivos: File[]) => {
    const f = archivos[0]
    if (!f) return
    if (!/\.xlsx$/i.test(f.name)) return setError('Solo se aceptan archivos de Excel (.xlsx).')
    setArchivo(f)
    void revisar(f)
  }

  const cargar = async () => {
    if (!archivo) return
    setError('')
    setBusy(true)
    try {
      const res = await api.importarVendedores(archivo, true, corregir)
      const partes = [`${res.nuevos.length} vendedores nuevos`, `${res.actualizados.length} actualizados`]
      if (res.aviso_carpetas) partes.push('carpetas de contratos pendientes (revisa la unidad compartida)')
      onListo(`Importación lista: ${partes.join(' · ')}.`)
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  const hayCambios = !!r && r.nuevos.length + r.actualizados.length > 0
  const omitidos = r?.observaciones.filter((o) => o.nivel === 'OMITIDO').length ?? 0

  return (
    <Modal titulo="Importar vendedores desde Excel" onClose={onClose} ancho="max-w-3xl">
      <p className="-mt-2 mb-4 text-sm text-slate-500">
        Sube el Excel mensual de RRHH. Puedes subir septiembre y luego octubre: los vendedores nuevos se crean, a los que ya existen se les
        actualizan los datos y las bajas, y <b>nunca se borra a nadie</b>. Antes de cargar verás un resumen.
      </p>

      <ZonaSuelta
        accept=".xlsx"
        multiple={false}
        disabled={busy}
        titulo={archivo ? 'Suelta aquí otro Excel para cambiar de archivo' : 'Suelta aquí el Excel (.xlsx)'}
        ayuda="máx. 5 MB"
        compacta={!!archivo}
        onArchivos={elegir}
      />

      <label className="mt-3 flex cursor-pointer items-start gap-2 text-xs text-slate-600">
        <input
          type="checkbox"
          className="mt-0.5 h-3.5 w-3.5 accent-brand-600"
          checked={corregir}
          disabled={busy}
          onChange={(e) => {
            setCorregir(e.target.checked)
            if (archivo) void revisar(archivo, e.target.checked)
          }}
        />
        <span>
          Corregir fechas de ingreso <b>en el futuro</b> con día y mes invertidos (por ejemplo 09/11/2026 → 11/09/2026). Si no la marcas, solo se avisa.
        </span>
      </label>

      {error && <div className="mt-4"><ErrorBox>{error}</ErrorBox></div>}
      {busy && !r && <p className="mt-5 flex items-center gap-2 text-sm text-slate-500"><RefreshCw size={14} className="animate-spin" /> Revisando el archivo…</p>}

      {r && archivo && (
        <div className="mt-5 space-y-4">
          <p className="flex items-center gap-2 text-sm font-medium text-slate-700">
            <FileSpreadsheet size={16} className="text-emerald-600" /> {archivo.name} · {r.filas_leidas} filas leídas
          </p>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            <Cifra valor={r.nuevos.length} etiqueta="Se crearán" color="text-emerald-600" />
            <Cifra valor={r.actualizados.length} etiqueta="Se actualizarán" color="text-brand-600" />
            <Cifra valor={r.sin_cambios} etiqueta="Sin cambios" color="text-slate-500" />
            <Cifra valor={r.bajas} etiqueta="Bajas" color="text-amber-600" />
            <Cifra valor={omitidos} etiqueta="No se cargan" color={omitidos ? 'text-red-600' : 'text-slate-400'} />
          </div>

          {Object.keys(r.por_equipo).length > 0 && (
            <p className="text-xs text-slate-500">
              Nuevos por equipo:{' '}
              {Object.entries(r.por_equipo).map(([e, n]) => <span key={e} className="mr-2 rounded-full bg-slate-100 px-2 py-0.5">{e}: <b>{n}</b></span>)}
              {r.contratos_vencidos > 0 && <span className="ml-1">· {r.contratos_vencidos} con el contrato ya vencido</span>}
            </p>
          )}

          {r.observaciones.length > 0 && (
            <div>
              <p className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-slate-700">
                <AlertTriangle size={14} className="text-amber-500" /> Observaciones ({r.observaciones.length})
              </p>
              <ul className="max-h-56 divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-200 text-xs">
                {r.observaciones.map((o, i) => (
                  <li key={i} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 px-3 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${NIVEL[o.nivel]?.clase ?? 'bg-slate-100 text-slate-600'}`}>{NIVEL[o.nivel]?.texto ?? o.nivel}</span>
                    <span className="text-slate-400">fila {o.fila}</span>
                    {o.codigo && <span className="font-mono text-slate-500">{o.codigo}</span>}
                    <span className="font-medium text-slate-700">{o.nombre}</span>
                    <span className="basis-full text-slate-500">{o.mensaje}</span>
                  </li>
                ))}
              </ul>
              {omitidos > 0 && <p className="mt-1 text-[11px] text-slate-400">Corrige esas filas en el Excel y vuelve a subirlo: lo que ya se cargó no se duplica.</p>}
            </div>
          )}

          {r.actualizados.length > 0 && (
            <div>
              <p className="mb-1.5 text-sm font-medium text-slate-700">Se actualizarán ({r.actualizados.length})</p>
              <ul className="max-h-48 divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-200 text-xs">
                {r.actualizados.map((c) => (
                  <li key={c.codigo} className="px-3 py-2">
                    <span className="font-mono text-slate-500">{c.codigo}</span> <span className="font-medium text-slate-700">{c.nombre}</span>
                    <span className="block text-slate-500">{c.cambios.join(' · ')}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {r.nuevos.length > 0 && (
            <div>
              <button onClick={() => setVerNuevos((v) => !v)} className="text-sm font-medium text-brand-700 hover:underline">
                {verNuevos ? 'Ocultar' : 'Ver'} los {r.nuevos.length} vendedores nuevos
              </button>
              {verNuevos && (
                <div className="mt-1.5 max-h-56 overflow-y-auto rounded-xl border border-slate-200">
                  <table className="tbl text-xs">
                    <thead><tr><th>Código</th><th>Nombre</th><th>Equipo</th><th>Ingreso</th><th>Baja</th></tr></thead>
                    <tbody>
                      {r.nuevos.map((n) => (
                        <tr key={n.codigo}>
                          <td className="font-mono">{n.codigo}</td><td>{n.nombre}</td><td>{n.equipo}</td><td>{fmt(n.ingreso)}</td><td>{n.baja ? fmt(n.baja) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {!hayCambios && <p className="rounded-xl bg-slate-50 px-3 py-2.5 text-sm text-slate-500">No hay nada nuevo que cargar con este archivo.</p>}
        </div>
      )}

      <div className="mt-6 flex items-center justify-end gap-3 border-t border-slate-100 pt-4">
        <button onClick={onClose} className="rounded-lg px-3 py-2 text-sm text-slate-500 hover:bg-slate-100">Cerrar</button>
        <button onClick={cargar} disabled={busy || !hayCambios} className="btn-primary text-sm">
          {busy && r ? <RefreshCw size={14} className="animate-spin" /> : <Check size={14} />}
          {busy && r ? 'Cargando…' : hayCambios ? `Cargar (${r!.nuevos.length} nuevos, ${r!.actualizados.length} cambios)` : 'Cargar'}
        </button>
      </div>
    </Modal>
  )
}
