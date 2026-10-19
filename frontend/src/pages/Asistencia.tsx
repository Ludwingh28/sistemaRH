import { CalendarDays, Download, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { api, guardarComo } from '../api'
import { useAuth } from '../auth'
import { ErrorBox, Modal, PageHeader, Toast, alEscribirMayus, labelCls, type ToastData } from '../components/ui'
import FiltroRango, { useRango } from '../components/FiltroRango'
import { useMediaQuery } from '../useMediaQuery'
import { fmt, hoyIso } from '../format'
import type { CeldaAsistencia, EstadoFeriados, Feriado, FilaAsistencia, MatrizAsistencia, Regional, TrabajandoHoy } from '../types'

// El servidor guarda UTC sin zona; se muestra en hora local.
const fechaHoraLocal = (iso: string) =>
  new Date(iso.endsWith('Z') ? iso : `${iso}Z`).toLocaleString('es-BO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })

// Anchos fijos para que las columnas fijas se queden pegadas al desplazar los días.
const W_GRANDE = { codigo: 72, vendedor: 210, zona: 108, equipo: 140 }
const W_CHICO = { codigo: 56, vendedor: 132, zona: 0, equipo: 0 } // en pantallas chicas solo código y vendedor
const TOTALES_W = 62
const CELDA: Record<CeldaAsistencia, { texto: string; clase: string }> = {
  P: { texto: '✓', clase: 'bg-emerald-50 text-emerald-600 font-bold' },
  F: { texto: '✗', clase: 'bg-red-50 text-red-500 font-bold' },
  C: { texto: 'C', clase: 'bg-brand-50 text-brand-600 font-semibold' },
  N: { texto: '', clase: 'bg-slate-300/70' },
  '-': { texto: '', clase: '' },
}

// ── Feriados ─────────────────────────────────────────────────────────────────

function Feriados({
  estructura, puedeEscribir, onClose, onChanged,
}: {
  estructura: Regional[]
  puedeEscribir: boolean
  onClose: () => void
  onChanged: () => void
}) {
  const [anio, setAnio] = useState(new Date().getFullYear())
  const [lista, setLista] = useState<Feriado[]>([])
  const [fecha, setFecha] = useState('')
  const [ambito, setAmbito] = useState('')
  const [descripcion, setDescripcion] = useState('')
  const [error, setError] = useState('')

  const [estado, setEstado] = useState<EstadoFeriados | null>(null)
  const [sincronizando, setSincronizando] = useState(false)

  const cargar = useCallback(() => {
    api.feriados(anio).then(setLista).catch((e) => setError(e.message))
    api.estadoFeriados(anio).then(setEstado).catch(() => setEstado(null))
  }, [anio])
  useEffect(cargar, [cargar])

  const sincronizar = async () => {
    setError('')
    setSincronizando(true)
    try {
      setEstado(await api.sincronizarFeriados(anio))
      cargar()
      onChanged()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSincronizando(false)
    }
  }

  const alternar = async (f: Feriado) => {
    try {
      await api.activarFeriado(f.id, !f.activo)
      cargar()
      onChanged()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const agregar = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    try {
      await api.crearFeriado({ fecha, regional_id: ambito ? Number(ambito) : undefined, descripcion })
      setFecha('')
      setDescripcion('')
      cargar()
      onChanged()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const quitar = async (f: Feriado) => {
    try {
      await api.eliminarFeriado(f.id)
      cargar()
      onChanged()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <Modal titulo="Feriados y días no laborables" onClose={onClose} ancho="max-w-xl">
      <p className="mb-4 text-sm text-slate-500">
        Se trabaja de lunes a sábado. Los feriados nacionales aplican a todas las zonas; los de una zona, solo a ella.
      </p>
      <div className="mb-4 flex items-center gap-2">
        <label className="text-sm text-slate-500">Año</label>
        <input type="number" className="input-field w-24" value={anio} onChange={(e) => setAnio(Number(e.target.value) || anio)} />
      </div>

      {estado && (
        <div className="mb-4 flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-500">
          <p className="flex-1">
            Los feriados nacionales y de cada departamento se generan solos ({estado.fuente}).
            {estado.ultima_actualizacion && <> Actualizado {fechaHoraLocal(estado.ultima_actualizacion)}.</>}{' '}
            Los puentes que decrete el Gobierno se agregan a mano.
          </p>
          {puedeEscribir && (
            <button onClick={sincronizar} disabled={sincronizando} className="btn-primary px-3 py-1.5 text-xs">
              <RefreshCw size={12} className={sincronizando ? 'animate-spin' : ''} /> {sincronizando ? 'Actualizando…' : 'Regenerar'}
            </button>
          )}
        </div>
      )}

      <ul className="mb-5 max-h-64 space-y-1.5 overflow-y-auto">
        {lista.length === 0 && <li className="py-5 text-center text-sm text-slate-400">No hay feriados cargados para {anio}</li>}
        {lista.map((f) => (
          <li key={f.id} className={`flex items-center gap-3 rounded-lg border border-slate-100 px-3 py-2 text-sm ${f.activo ? '' : 'opacity-50'}`}>
            <span className="w-24 shrink-0 tabular-nums">{fmt(f.fecha)}</span>
            <span className={`min-w-0 flex-1 truncate ${f.activo ? '' : 'line-through'}`} title={f.tipo ?? undefined}>{f.descripcion}</span>
            <span className={f.regional ? 'badge-info' : 'badge-off'}>{f.regional ?? 'Nacional'}</span>
            {f.origen === 'holidays' && <span className="text-[10px] uppercase tracking-wide text-slate-300" title="Generado automáticamente">Auto</span>}
            {puedeEscribir && (f.origen === 'manual' ? (
              <button className="icon-btn hover:text-red-600!" title="Quitar" onClick={() => quitar(f)}><Trash2 size={14} /></button>
            ) : (
              <label className="flex cursor-pointer items-center gap-1 text-xs text-slate-400" title="Si lo desactivas, no se descuenta como día no laborable">
                <input type="checkbox" className="accent-brand-600" checked={f.activo} onChange={() => alternar(f)} /> Aplica
              </label>
            ))}
          </li>
        ))}
      </ul>

      {puedeEscribir && (
        <form onSubmit={agregar} className="space-y-3 border-t border-slate-100 pt-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className={labelCls}>Fecha</label>
              <input type="date" className="input-field" value={fecha} onChange={(e) => setFecha(e.target.value)} required />
            </div>
            <div>
              <label className={labelCls}>Aplica a</label>
              <select className="input-field" value={ambito} onChange={(e) => setAmbito(e.target.value)}>
                <option value="">Todas las zonas (nacional)</option>
                {estructura.map((r) => <option key={r.id} value={r.id}>Solo {r.nombre}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className={labelCls}>Descripción</label>
            <input className="input-field mayus" value={descripcion} onChange={alEscribirMayus(setDescripcion)} required placeholder="Ej.: Día de Cochabamba" />
          </div>
          {error && <ErrorBox>{error}</ErrorBox>}
          <button className="btn-primary w-full text-sm"><Plus size={15} /> Agregar feriado</button>
        </form>
      )}
      {!puedeEscribir && error && <ErrorBox>{error}</ErrorBox>}
    </Modal>
  )
}

// ── Página ───────────────────────────────────────────────────────────────────

export default function Asistencia() {
  const { puedeEscribir } = useAuth()
  const [estructura, setEstructura] = useState<Regional[]>([])
  const { rango, setRango, desde, hasta } = useRango()
  const compacto = useMediaQuery('(max-width: 767px)')
  const W = compacto ? W_CHICO : W_GRANDE
  const LEFT = { codigo: 0, vendedor: W.codigo, zona: W.codigo + W.vendedor, equipo: W.codigo + W.vendedor + W.zona }
  const [regionalId, setRegionalId] = useState('')
  const [equipoId, setEquipoId] = useState('')
  const [matriz, setMatriz] = useState<MatrizAsistencia | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [verFeriados, setVerFeriados] = useState(false)
  const [toast, setToast] = useState<ToastData | null>(null)
  const limpiarToast = useCallback(() => setToast(null), [])
  const [exportando, setExportando] = useState(false)

  // Exporta con exactamente los filtros que se están viendo.
  const exportar = async () => {
    setExportando(true)
    try {
      const { blob, nombre } = await api.exportarAsistencia({
        desde,
        hasta,
        regional_id: regionalId ? Number(regionalId) : undefined,
        equipo_id: equipoId ? Number(equipoId) : undefined,
      })
      guardarComo(blob, nombre ?? `Asistencia_${desde}_${hasta}.xlsx`)
      setToast({ msg: 'Excel generado.', type: 'ok' })
    } catch (e) {
      setToast({ msg: (e as Error).message || 'No se pudo exportar.', type: 'err' })
    } finally {
      setExportando(false)
    }
  }

  useEffect(() => { api.estructura().then(setEstructura).catch((e) => setError(e.message)) }, [])

  const ultimaPeticion = useRef(0)
  const cargar = useCallback(() => {
    const id = ++ultimaPeticion.current // descarta respuestas viejas si el filtro cambió
    setLoading(true)
    api
      .matriz({
        desde,
        hasta,
        regional_id: regionalId ? Number(regionalId) : undefined,
        equipo_id: equipoId ? Number(equipoId) : undefined,
      })
      .then((m) => { if (id === ultimaPeticion.current) { setMatriz(m); setError('') } })
      .catch((e) => { if (id === ultimaPeticion.current) { setMatriz(null); setError(e.message) } })
      .finally(() => { if (id === ultimaPeticion.current) setLoading(false) })
  }, [desde, hasta, regionalId, equipoId])
  useEffect(cargar, [cargar])

  const equipos = estructura.filter((r) => !regionalId || r.id === Number(regionalId)).flatMap((r) => r.equipos)

  // «Vendedores trabajando hoy»: sigue los filtros de zona y equipo (no el rango de fechas) y se
  // refresca solo cada 2 minutos, porque las preventas de hoy se van registrando durante el día.
  const [hoyDatos, setHoyDatos] = useState<TrabajandoHoy | null>(null)
  const [hoyActualizado, setHoyActualizado] = useState<Date | null>(null)
  useEffect(() => {
    let cancelado = false
    const consultar = () =>
      api
        .hoy({ regional_id: regionalId ? Number(regionalId) : undefined, equipo_id: equipoId ? Number(equipoId) : undefined })
        .then((d) => { if (!cancelado) { setHoyDatos(d); setHoyActualizado(new Date()) } })
        .catch(() => { if (!cancelado) setHoyDatos(null) })
    consultar()
    const timer = setInterval(consultar, 120_000)
    return () => { cancelado = true; clearInterval(timer) }
  }, [regionalId, equipoId])

  // Nombre del feriado por (zona, fecha) para el texto emergente de cada celda.
  const nombresFeriado = useMemo(() => {
    const m = new Map<string, string>()
    matriz?.feriados.forEach((f) => m.set(`${f.regional_id ?? 'n'}|${f.fecha}`, f.descripcion))
    return m
  }, [matriz])
  const titulo = (fila: FilaAsistencia, fecha: string, celda: CeldaAsistencia, domingo: boolean) => {
    const feriado = nombresFeriado.get(`n|${fecha}`) ?? nombresFeriado.get(`${fila.regional_id}|${fecha}`)
    if (feriado) return `Feriado: ${feriado}`
    if (celda === 'N') return domingo ? 'Domingo' : 'No laborable'
    if (celda === 'C') return 'Capacitación'
    if (celda === 'P') return 'Con preventa'
    if (celda === 'F') return 'Sin preventa'
    return ''
  }

  const totales = useMemo(() => {
    const filas = matriz?.filas ?? []
    const habiles = filas.reduce((s, f) => s + f.habiles, 0)
    const asistidos = filas.reduce((s, f) => s + f.asistidos, 0)
    return { vendedores: filas.length, pct: habiles ? Math.round((asistidos / habiles) * 100) : null }
  }, [matriz])
  // Los domingos no se muestran (se conservan los índices para leer la celda correcta).
  const diasVisibles = useMemo(
    () => (matriz?.dias ?? []).map((d, i) => ({ d, i })).filter(({ d }) => !d.domingo),
    [matriz],
  )
  const hayExtra = matriz?.filas.some((f) => f.extra > 0) ?? false
  const hoy = hoyIso()

  const fijas = 'sticky z-10 bg-white'

  return (
    <div>
      <Toast toast={toast} onDone={limpiarToast} />
      <PageHeader
        titulo="Asistencia"
        subtitulo="Un día cuenta como asistido cuando el vendedor tiene preventa registrada en el BI."
        accion={
          <div className="flex flex-wrap gap-2">
            <button onClick={exportar} disabled={exportando || !matriz || matriz.filas.length === 0}
              title="Descarga lo que ves en pantalla (mismo rango, zona y equipo)"
              className="btn-primary text-sm">
              <Download size={15} /> {exportando ? 'Generando…' : 'Exportar a Excel'}
            </button>
            <button onClick={() => setVerFeriados(true)} className="btn-primary bg-white text-sm text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50 focus:ring-brand-500!">
              <CalendarDays size={15} /> Feriados
            </button>
          </div>
        }
      />

      <div className="card mb-5 flex flex-wrap items-end gap-3 p-4">
        <FiltroRango rango={rango} setRango={setRango} desde={desde} hasta={hasta} />
        <div>
          <label className={labelCls}>Zona</label>
          <select className="input-field w-36 sm:w-44" value={regionalId} onChange={(e) => { setRegionalId(e.target.value); setEquipoId('') }}>
            <option value="">Todas</option>
            {estructura.map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls}>Equipo</label>
          <select className="input-field w-36 sm:w-44" value={equipoId} onChange={(e) => setEquipoId(e.target.value)}>
            <option value="">Todos</option>
            {equipos.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
          </select>
        </div>
        <div className="ml-auto text-right text-sm text-slate-500">
          <p className="font-medium text-slate-700">Del {fmt(desde)} al {fmt(hasta)}</p>
          <p>
            {totales.vendedores} vendedores{totales.pct !== null && <> · asistencia promedio <span className="font-semibold text-slate-700">{totales.pct}%</span></>}
          </p>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-x-6 gap-y-3">
        <section className="card flex items-center gap-4 px-4 py-2.5" aria-live="polite" title={hoyActualizado ? `Con preventa registrada hoy · actualizado ${hoyActualizado.toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' })}` : undefined}>
          <div>
            <p className="text-[11px] text-slate-500">Vendedores trabajando hoy</p>
            {!hoyDatos ? (
              <p className="text-sm text-slate-400">Consultando…</p>
            ) : hoyDatos.trabajando === null ? (
              <p className="text-sm text-amber-700">{hoyDatos.aviso ?? 'No disponible'}</p>
            ) : hoyDatos.esperados === 0 ? (
              <p className="text-sm text-slate-500">{hoyDatos.sin_jornada > 0 ? 'Hoy no es día laborable' : 'Sin vendedores'}</p>
            ) : (
              <p className="flex items-baseline gap-1.5 leading-tight">
                <span className="text-2xl font-semibold">{hoyDatos.trabajando}</span>
                <span className="text-sm text-slate-500">de {hoyDatos.esperados}</span>
                {hoyDatos.en_capacitacion > 0 && <span className="ml-1 text-[11px] text-slate-400">· {hoyDatos.en_capacitacion} en capacitación</span>}
              </p>
            )}
          </div>
          {hoyDatos && hoyDatos.trabajando !== null && hoyDatos.esperados > 0 && (
            /* Medidor: la pista es un paso más claro del mismo azul que el relleno */
            <div className="h-1.5 w-20 overflow-hidden rounded-full sm:w-28" style={{ background: '#cde2fb' }}
              role="meter" aria-valuemin={0} aria-valuemax={hoyDatos.esperados} aria-valuenow={hoyDatos.trabajando}
              aria-label={`${hoyDatos.trabajando} de ${hoyDatos.esperados} vendedores trabajando hoy`}>
              <div className="h-full rounded-full" style={{ width: `${(hoyDatos.trabajando / hoyDatos.esperados) * 100}%`, background: '#2a78d6' }} />
            </div>
          )}
        </section>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-slate-500">
        <span className="flex items-center gap-1.5"><span className="flex h-5 w-5 items-center justify-center rounded bg-emerald-50 font-bold text-emerald-600">✓</span> Con preventa</span>
        <span className="flex items-center gap-1.5"><span className="flex h-5 w-5 items-center justify-center rounded bg-red-50 font-bold text-red-500">✗</span> Sin preventa</span>
        <span className="flex items-center gap-1.5"><span className="flex h-5 w-5 items-center justify-center rounded bg-brand-50 font-semibold text-brand-600">C</span> Capacitación</span>
        <span className="flex items-center gap-1.5"><span className="h-5 w-5 rounded bg-slate-300/70" /> Feriado</span>
      </div>
      </div>

      {error && <div className="mb-4"><ErrorBox>{error}</ErrorBox></div>}

      <div className="card overflow-auto" style={{ maxHeight: 'calc(100vh - 20rem)' }}>
        {loading && !matriz && <p className="p-10 text-center text-sm text-slate-400">Cargando…</p>}
        {matriz && (
          <table className="border-separate border-spacing-0 text-sm" style={{ minWidth: 'max-content' }}>
            <thead>
              <tr>
                <th className={`${fijas} sticky top-0 z-30 border-b border-slate-200 bg-slate-50 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500`} style={{ left: LEFT.codigo, minWidth: W.codigo, width: W.codigo }}>Código</th>
                <th className={`${fijas} sticky top-0 z-30 border-b ${compacto ? 'border-r' : ''} border-slate-200 bg-slate-50 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500`} style={{ left: LEFT.vendedor, minWidth: W.vendedor, width: W.vendedor }}>Vendedor</th>
                {!compacto && (<th className={`${fijas} sticky top-0 z-30 border-b border-slate-200 bg-slate-50 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500`} style={{ left: LEFT.zona, minWidth: W.zona, width: W.zona }}>Zona</th>)}
                {!compacto && (<th className={`${fijas} sticky top-0 z-30 border-b border-r border-slate-200 bg-slate-50 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500`} style={{ left: LEFT.equipo, minWidth: W.equipo, width: W.equipo }}>Equipo</th>)}
                {diasVisibles.map(({ d }) => {
                  const [dia, fechaCorta] = d.etiqueta.split(' ')
                  return (
                    <th
                      key={d.fecha}
                      className={`sticky top-0 z-20 min-w-9 border-b border-slate-200 px-1 py-1.5 text-center text-[10px] font-semibold leading-tight ${
                        d.domingo ? 'bg-slate-100 text-slate-400' : 'bg-slate-50 text-slate-500'
                      } ${d.fecha === hoy ? 'text-brand-600!' : ''}`}
                    >
                      <span className="block uppercase">{dia}</span>
                      <span className="block tabular-nums">{fechaCorta}</span>
                    </th>
                  )
                })}
                {(['Háb.', 'Asist.', 'Faltas', '%'] as const).map((t) => (
                  <th key={t} className="sticky top-0 z-20 border-b border-l border-slate-200 bg-slate-50 px-2 py-2 text-center text-[11px] font-semibold uppercase tracking-wider text-slate-500" style={{ minWidth: TOTALES_W }}>{t}</th>
                ))}
                {hayExtra && <th className="sticky top-0 z-20 border-b border-slate-200 bg-slate-50 px-2 py-2 text-center text-[11px] font-semibold uppercase tracking-wider text-slate-500" title="Preventas en domingos o feriados">Extra</th>}
              </tr>
            </thead>
            <tbody>
              {matriz.filas.length === 0 && (
                <tr><td colSpan={8 + diasVisibles.length} className="px-4 py-10 text-center text-slate-400">No hay vendedores con contrato en esta gestión</td></tr>
              )}
              {matriz.filas.map((f) => {
                const pct = f.habiles ? Math.round((f.asistidos / f.habiles) * 100) : null
                return (
                  <tr key={f.vendedor_id} className="group">
                    <td className={`${fijas} border-b border-slate-100 px-3 py-1.5 font-mono text-xs text-slate-500 group-hover:bg-slate-50`} style={{ left: LEFT.codigo }}>{f.codigo_vendedor}</td>
                    <td className={`${fijas} border-b ${compacto ? 'border-r border-slate-200' : 'border-slate-100'} px-3 py-1.5 group-hover:bg-slate-50`} style={{ left: LEFT.vendedor }}>
                      <span className="block truncate font-medium" style={{ maxWidth: W.vendedor - 24 }} title={f.nombre}>{f.nombre}</span>
                      {f.retirado && <span className="text-[10px] text-slate-400">Retirado {fmt(f.retirado)}</span>}
                    </td>
                    {!compacto && (<td className={`${fijas} border-b border-slate-100 px-3 py-1.5 whitespace-nowrap text-slate-600 group-hover:bg-slate-50`} style={{ left: LEFT.zona }}>{f.zona}</td>)}
                    {!compacto && (<td className={`${fijas} border-b border-r border-slate-200 px-3 py-1.5 whitespace-nowrap text-slate-600 group-hover:bg-slate-50`} style={{ left: LEFT.equipo }}>{f.equipo}</td>)}
                    {diasVisibles.map(({ d, i }) => {
                      const c = f.celdas[i]
                      return (
                        <td
                          key={d.fecha}
                          title={titulo(f, d.fecha, c, d.domingo)}
                          className={`border-b border-slate-100 text-center text-xs ${CELDA[c].clase} ${d.fecha === hoy ? 'outline-1 -outline-offset-1 outline-brand-300' : ''}`}
                        >
                          {CELDA[c].texto}
                        </td>
                      )
                    })}
                    <td className="border-b border-l border-slate-200 text-center tabular-nums text-slate-500">{f.habiles}</td>
                    <td className="border-b border-slate-100 text-center font-semibold tabular-nums text-emerald-700">{f.asistidos}</td>
                    <td className={`border-b border-slate-100 text-center tabular-nums ${f.faltas > 0 ? 'font-semibold text-red-600' : 'text-slate-400'}`}>{f.faltas}</td>
                    <td className="border-b border-slate-100 text-center text-xs tabular-nums text-slate-500">{pct === null ? '—' : `${pct}%`}</td>
                    {hayExtra && <td className="border-b border-slate-100 text-center tabular-nums text-slate-500">{f.extra || '–'}</td>}
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {verFeriados && (
        <Feriados
          estructura={estructura}
          puedeEscribir={puedeEscribir}
          onClose={() => setVerFeriados(false)}
          onChanged={() => { cargar(); setToast({ msg: 'Calendario actualizado.', type: 'ok' }) }}
        />
      )}
    </div>
  )
}
