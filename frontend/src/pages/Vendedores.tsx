import { FileText, Plus, RefreshCw, Search } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { useAuth } from '../auth'
import { Toast, PageHeader, ErrorBox, type ToastData } from '../components/ui'
import CarpetaContratos from '../components/vendedores/CarpetaContratos'
import DetalleVendedor from '../components/vendedores/DetalleVendedor'
import FormAlta from '../components/vendedores/FormAlta'
import { fmt } from '../format'
import type { Regional, ResumenVendedores, Vendedor } from '../types'

type Vista = 'vigentes' | 'nuevos' | 'por_vencer' | 'vencidos' | 'retirados' | 'todos'

const VISTAS: { id: Vista; label: string; clave?: keyof ResumenVendedores; color: string }[] = [
  { id: 'vigentes', label: 'Vigentes', clave: 'vigentes', color: 'text-emerald-600' },
  { id: 'nuevos', label: 'Nuevos', clave: 'nuevos', color: 'text-brand-600' },
  { id: 'por_vencer', label: 'Por vencer (30 días)', clave: 'por_vencer', color: 'text-amber-600' },
  { id: 'vencidos', label: 'Contrato vencido', clave: 'vencidos', color: 'text-red-600' },
  { id: 'retirados', label: 'Retirados', clave: 'retirados', color: 'text-slate-500' },
]

function Vencimiento({ v }: { v: Vendedor }) {
  const c = v.contrato_actual
  if (!c || v.estado_contrato === 'retirado') return <span className="text-slate-300">—</span>
  const d = v.dias_para_vencer ?? 0
  const clase = v.estado_contrato === 'vencido' ? 'badge-bad' : v.estado_contrato === 'por_vencer' ? 'badge-warn' : 'badge-off'
  const texto = d < 0 ? `Venció hace ${-d} d` : d === 0 ? 'Vence hoy' : `En ${d} d`
  return (
    <div className="leading-tight">
      <span className={clase}>{texto}</span>
      <p className="mt-1 text-xs tabular-nums text-slate-400">{fmt(c.fecha_fin)}</p>
    </div>
  )
}

export default function Vendedores() {
  const { puedeEscribir, user } = useAuth()
  const [carpeta, setCarpeta] = useState(false)
  const [estructura, setEstructura] = useState<Regional[]>([])
  const [lista, setLista] = useState<Vendedor[]>([])
  const [resumen, setResumen] = useState<ResumenVendedores | null>(null)
  const [vista, setVista] = useState<Vista>('vigentes')
  const [ventana, setVentana] = useState('30')
  const [q, setQ] = useState('')
  const [qAplicada, setQAplicada] = useState('')
  const [regionalId, setRegionalId] = useState('')
  const [equipoId, setEquipoId] = useState('')
  const [alta, setAlta] = useState(false)
  const [detalle, setDetalle] = useState<{ id: number; tab: 'contratos' | 'datos' } | null>(null)
  const [toast, setToast] = useState<ToastData | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const limpiarToast = useCallback(() => setToast(null), [])

  const equipos = estructura.filter((r) => !regionalId || r.id === Number(regionalId)).flatMap((r) => r.equipos)

  // La búsqueda espera a que se deje de escribir.
  useEffect(() => {
    const t = setTimeout(() => setQAplicada(q), 300)
    return () => clearTimeout(t)
  }, [q])

  const ultimaPeticion = useRef(0)
  const cargar = useCallback(() => {
    const id = ++ultimaPeticion.current // descarta respuestas viejas si el filtro cambió
    const filtros: Parameters<typeof api.vendedores>[0] = {
      q: qAplicada || undefined,
      regional_id: regionalId ? Number(regionalId) : undefined,
      equipo_id: equipoId ? Number(equipoId) : undefined,
    }
    if (vista === 'vigentes' || vista === 'nuevos') filtros.vigente = true
    if (vista === 'retirados') filtros.vigente = false
    if (vista === 'por_vencer') filtros.vence_en = Number(ventana)
    if (vista === 'vencidos') filtros.contrato = 'vencido'
    setLoading(true)
    Promise.all([api.vendedores(filtros), api.resumenVendedores()])
      .then(([filas, r]) => {
        if (id !== ultimaPeticion.current) return
        setLista(vista === 'nuevos' ? filas.filter((f) => f.estado === 'nuevo') : filas)
        setResumen(r)
        setError('')
      })
      .catch((e) => { if (id === ultimaPeticion.current) setError(e.message) })
      .finally(() => { if (id === ultimaPeticion.current) setLoading(false) })
  }, [vista, ventana, qAplicada, regionalId, equipoId])

  useEffect(() => { api.estructura().then(setEstructura).catch((e) => setError(e.message)) }, [])
  useEffect(cargar, [cargar])

  const abrir = (v: Vendedor, tab: 'contratos' | 'datos' = 'contratos') => setDetalle({ id: v.id, tab })

  return (
    <div>
      <Toast toast={toast} onDone={limpiarToast} />
      <PageHeader
        titulo="Vendedores"
        subtitulo="Gestión de colaboradores y de sus contratos."
        accion={
          puedeEscribir && (
            <div className="flex flex-wrap gap-2">
              {user?.rol === 'admin' && (
                <button onClick={() => setCarpeta(true)} className="btn-primary bg-white text-sm text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50 focus:ring-brand-500!">
                  <FileText size={15} /> Carpetas de contratos
                </button>
              )}
              <button onClick={() => setAlta(true)} className="btn-primary text-sm">
                <Plus size={16} /> Nuevo vendedor
              </button>
            </div>
          )
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-5">
        {VISTAS.map((x) => (
          <button
            key={x.id}
            onClick={() => setVista(vista === x.id ? 'todos' : x.id)}
            className={`card p-4 text-left transition hover:border-brand-300 ${vista === x.id ? 'border-brand-500 ring-2 ring-brand-500/15' : ''}`}
          >
            <p className={`text-2xl font-semibold tabular-nums ${x.color}`}>{resumen && x.clave ? resumen[x.clave] : '–'}</p>
            <p className="mt-0.5 text-xs text-slate-500">{x.label}</p>
          </button>
        ))}
      </div>

      <div className="card mb-5 flex flex-col gap-3 p-4 lg:flex-row">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input className="input-field pl-9" placeholder="Buscar por nombre, código o carnet…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select className="input-field lg:w-48" value={regionalId} onChange={(e) => { setRegionalId(e.target.value); setEquipoId('') }}>
          <option value="">Todas las zonas</option>
          {estructura.map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}
        </select>
        <select className="input-field lg:w-48" value={equipoId} onChange={(e) => setEquipoId(e.target.value)}>
          <option value="">Todos los equipos</option>
          {equipos.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
        </select>
        {vista === 'por_vencer' && (
          <select className="input-field lg:w-44" value={ventana} onChange={(e) => setVentana(e.target.value)}>
            <option value="15">Vencen en 15 días</option>
            <option value="30">Vencen en 30 días</option>
            <option value="60">Vencen en 60 días</option>
            <option value="90">Vencen en 90 días</option>
          </select>
        )}
      </div>

      {error && <div className="mb-4"><ErrorBox>{error}</ErrorBox></div>}

      <div className="card overflow-x-auto">
        <table className="tbl">
          <thead>
            <tr>
              <th>Código</th>
              <th>Colaborador</th>
              <th>Zona · Equipo</th>
              <th>Ingreso</th>
              <th>Contrato actual</th>
              <th>Vencimiento</th>
              <th>Estado</th>
              {puedeEscribir && <th />}
            </tr>
          </thead>
          <tbody>
            {loading && lista.length === 0 && <tr><td colSpan={8} className="empty">Cargando…</td></tr>}
            {!loading && lista.length === 0 && <tr><td colSpan={8} className="empty">No hay vendedores para mostrar</td></tr>}
            {lista.map((v) => (
              <tr key={v.id} onClick={() => abrir(v)} className="cursor-pointer">
                <td className="font-mono text-xs text-navy-500">{v.codigo_vendedor}</td>
                <td>
                  <p className="font-medium">{v.nombre}</p>
                  {v.documento && <p className="text-xs text-slate-400">CI {v.documento}</p>}
                </td>
                <td>
                  <p>{v.regional}</p>
                  <p className="text-xs text-slate-400">{v.equipo_nombre}</p>
                </td>
                <td className="tabular-nums">{fmt(v.fecha_primer_ingreso)}</td>
                <td>
                  {v.contrato_actual ? (
                    <>
                      <p className="font-medium">Nº {v.contrato_actual.numero}</p>
                      <p className="text-xs tabular-nums text-slate-400">
                        {fmt(v.contrato_actual.fecha_inicio)} → {fmt(v.contrato_actual.fecha_fin)}
                      </p>
                    </>
                  ) : '—'}
                </td>
                <td><Vencimiento v={v} /></td>
                <td>
                  {v.estado === 'retirado' ? (
                    <div className="leading-tight">
                      <span className="badge-off">Retirado</span>
                      <p className="mt-1 text-xs tabular-nums text-slate-400">{fmt(v.fecha_baja)}</p>
                    </div>
                  ) : v.estado === 'nuevo' ? (
                    <span className="badge-info">Nuevo</span>
                  ) : (
                    <span className="badge-ok">Activo</span>
                  )}
                </td>
                {puedeEscribir && (
                  <td className="whitespace-nowrap text-right" onClick={(e) => e.stopPropagation()}>
                    {v.vigente && (
                      <button onClick={() => abrir(v)} title="Renovar contrato" className="icon-btn hover:text-brand-600">
                        <RefreshCw size={15} />
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {lista.length > 0 && (
          <div className="border-t border-slate-100 px-5 py-3 text-xs text-slate-400">
            {lista.length} {lista.length === 1 ? 'registro' : 'registros'}
          </div>
        )}
      </div>

      {carpeta && <CarpetaContratos onClose={() => setCarpeta(false)} onCambio={cargar} />}
      {alta && (
        <FormAlta
          estructura={estructura}
          onClose={() => setAlta(false)}
          onDone={(v, info) => {
            setAlta(false)
            setToast(
              info.aviso
                ? { msg: info.aviso, type: 'err' }
                : { msg: `${v.nombre} fue registrado${info.subidos ? ` con ${info.subidos === 1 ? 'su contrato' : `${info.subidos} contratos`}` : ''}.`, type: 'ok' },
            )
            cargar()
          }}
        />
      )}
      {detalle && (
        <DetalleVendedor
          id={detalle.id}
          tabInicial={detalle.tab}
          estructura={estructura}
          puedeEscribir={puedeEscribir}
          onClose={() => setDetalle(null)}
          onChanged={cargar}
          onToast={setToast}
        />
      )}
    </div>
  )
}
