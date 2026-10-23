import { Check, RefreshCw, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { api } from '../api'
import { useAuth } from '../auth'
import Buscador from '../components/Buscador'
import { BarraCarga, Esqueleto } from '../components/Cargando'
import { ErrorBox, Modal, PageHeader, labelCls } from '../components/ui'
import Documentos from '../components/vendedores/Documentos'
import type { DocCategoria, EstadoDoc, FilaDoc, MatrizDoc, Regional } from '../types'

const ESTADOS: Record<EstadoDoc, { texto: string; icono: ReactElement; clase: string }> = {
  ok: { texto: 'Entregado', icono: <Check size={15} strokeWidth={3} />, clase: 'bg-emerald-100 text-emerald-700 ring-emerald-200' },
  falta: { texto: 'Falta entregar', icono: <X size={15} strokeWidth={3} />, clase: 'bg-red-100 text-red-600 ring-red-200' },
}

function Marca({ estado, onClick, etiqueta }: { estado: EstadoDoc; onClick?: () => void; etiqueta: string }) {
  const e = ESTADOS[estado]
  const cls = `inline-flex h-7 w-7 items-center justify-center rounded-full ring-1 ring-inset ${e.clase}`
  return onClick ? (
    <button onClick={onClick} className={`${cls} transition hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500`} title={`${etiqueta}: ${e.texto}`} aria-label={`${etiqueta}: ${e.texto}`}>
      {e.icono}
    </button>
  ) : (
    <span className={cls} title={`${etiqueta}: ${e.texto}`} aria-label={`${etiqueta}: ${e.texto}`}>{e.icono}</span>
  )
}

// ── Detalle de un documento de un vendedor: ver y subir sus archivos ──────────

function DetalleDoc({ fila, cat, onClose, onCambio }: { fila: FilaDoc; cat: DocCategoria; onClose: () => void; onCambio: () => void }) {
  const { puede } = useAuth()
  return (
    <Modal
      ancho="max-w-xl"
      onClose={() => { onCambio(); onClose() }}
      titulo={<span className="leading-tight"><span className="block">{cat.titulo}</span><span className="block text-xs font-normal text-slate-400">{fila.nombre} · {fila.codigo}</span></span>}
    >
      {puede('documentos.ver') ? (
        <Documentos vendedorId={fila.vendedor_id} nombre={fila.nombre} categoria={cat.clave} titulo={cat.titulo} extensiones={cat.extensiones} />
      ) : (
        <p className="rounded-xl bg-slate-50 px-3 py-2.5 text-sm text-slate-500">No tienes permiso para ver los archivos, solo el estado del documento.</p>
      )}
      <p className="mt-3 text-xs text-slate-400">El documento cuenta como entregado cuando su PDF está subido aquí, aunque exista en físico.</p>
    </Modal>
  )
}

// ── Página ───────────────────────────────────────────────────────────────────

export default function Documentacion() {
  const [estructura, setEstructura] = useState<Regional[]>([])
  const [regional, setRegional] = useState('')
  const [equipo, setEquipo] = useState('')
  const [estado, setEstado] = useState('vigentes')
  const [q, setQ] = useState('')
  const [soloFaltantes, setSoloFaltantes] = useState(false)
  const [docFiltro, setDocFiltro] = useState('') // clave del documento: solo los que lo tienen pendiente
  const [datos, setDatos] = useState<MatrizDoc | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [abierto, setAbierto] = useState<{ vendedorId: number; clave: string } | null>(null)
  const ultima = useRef(0)

  useEffect(() => { api.estructura().then(setEstructura).catch((e) => setError(e.message)) }, [])
  const equipos = useMemo(() => estructura.filter((r) => !regional || String(r.id) === regional).flatMap((r) => r.equipos), [estructura, regional])

  const cargar = useCallback((silencioso = false) => {
    const id = ++ultima.current
    if (!silencioso) setLoading(true)
    api
      .docMatriz({
        regional_id: regional ? Number(regional) : undefined, equipo_id: equipo ? Number(equipo) : undefined,
        estado, q: q.trim() || undefined, solo_faltantes: soloFaltantes || undefined,
      })
      .then((d) => { if (id === ultima.current) { setDatos(d); setError('') } })
      .catch((e) => { if (id === ultima.current) setError(e.message) })
      .finally(() => { if (id === ultima.current) setLoading(false) })
  }, [regional, equipo, estado, q, soloFaltantes])

  // La búsqueda por texto espera un instante para no consultar en cada tecla
  useEffect(() => {
    const t = setTimeout(() => cargar(), q ? 250 : 0)
    return () => clearTimeout(t)
  }, [cargar, q])

  const filas = useMemo(() => (datos?.filas ?? []).filter((f) => !docFiltro || f.docs[docFiltro]?.estado === 'falta'), [datos, docFiltro])
  const sel = abierto ? datos?.filas.find((f) => f.vendedor_id === abierto.vendedorId) : undefined
  const selCat = abierto ? datos?.columnas.find((c) => c.clave === abierto.clave) : undefined

  return (
    <div>
      <PageHeader
        titulo="Documentación"
        subtitulo="Qué documentos le faltan entregar a cada vendedor. Un documento cuenta cuando su PDF está subido; toca un casillero para verlo o subirlo."
        accion={<button onClick={() => cargar()} className="btn-primary bg-white text-sm text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50 focus:ring-brand-500!"><RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> Actualizar</button>}
      />

      <div className="card mb-4 grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_1.4fr_auto]">
        <div>
          <label className={labelCls}>Zona</label>
          <select className="input-field" value={regional} onChange={(e) => { setRegional(e.target.value); setEquipo('') }}>
            <option value="">Todas</option>
            {estructura.map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls}>Equipo</label>
          <select className="input-field" value={equipo} onChange={(e) => setEquipo(e.target.value)}>
            <option value="">Todos</option>
            {equipos.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls}>Vendedores</label>
          <select className="input-field" value={estado} onChange={(e) => setEstado(e.target.value)}>
            <option value="vigentes">Vigentes</option>
            <option value="retirados">Retirados</option>
            <option value="todos">Todos</option>
          </select>
        </div>
        <div>
          <label className={labelCls}>Buscar vendedor</label>
          <Buscador valor={q} onChange={setQ} placeholder="Nombre, código o equipo…" />
        </div>
        <label className="flex cursor-pointer items-end gap-2 pb-2 text-sm text-slate-600">
          <input type="checkbox" className="mb-1 h-4 w-4 accent-brand-600" checked={soloFaltantes} onChange={(e) => setSoloFaltantes(e.target.checked)} /> Solo con faltantes
        </label>
      </div>

      {error && <div className="mb-4"><ErrorBox>{error}</ErrorBox></div>}
      {datos?.aviso && <p className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">{datos.aviso}</p>}

      {datos && (
        <div className={`mb-4 grid grid-cols-2 gap-3 transition-opacity duration-200 md:grid-cols-5 ${loading ? 'opacity-60' : ''}`}>
          <div className="card p-4">
            <p className="text-2xl font-semibold tabular-nums text-emerald-600">{datos.resumen.completos}<span className="text-sm font-normal text-slate-400"> / {datos.resumen.vendedores}</span></p>
            <p className="mt-0.5 text-xs text-slate-500">Vendedores con todo entregado</p>
          </div>
          {datos.columnas.map((c) => {
            const r = datos.resumen.por_documento[c.clave]
            const activo = docFiltro === c.clave
            return (
              <button key={c.clave} onClick={() => setDocFiltro(activo ? '' : c.clave)}
                className={`card p-4 text-left transition hover:border-brand-300 ${activo ? 'border-brand-500 ring-2 ring-brand-500/15' : ''}`}
                title={activo ? 'Quitar el filtro' : `Ver solo quienes deben ${c.corto}`}>
                <p className={`text-2xl font-semibold tabular-nums ${r.falta ? 'text-red-600' : 'text-emerald-600'}`}>{r.falta}<span className="text-sm font-normal text-slate-400"> faltan</span></p>
                <p className="mt-0.5 text-xs text-slate-500">{c.titulo}</p>
              </button>
            )
          })}
        </div>
      )}

      <div className="mb-3 flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-slate-500">
        {(Object.keys(ESTADOS) as EstadoDoc[]).map((k) => (
          <span key={k} className="flex items-center gap-1.5"><Marca estado={k} etiqueta="" />{ESTADOS[k].texto}</span>
        ))}
      </div>

      <div className={`card relative overflow-auto transition-opacity duration-200 ${loading && datos ? 'opacity-60' : ''}`} style={{ maxHeight: 'calc(100vh - 24rem)' }}>
        <BarraCarga activa={loading} />
        {loading && !datos && <Esqueleto filas={10} columnas={7} />}
        {datos && (
          <table className="tbl">
            <thead>
              <tr>
                <th>Código</th>
                <th>Vendedor</th>
                <th>Zona · Equipo</th>
                {datos.columnas.map((c) => <th key={c.clave} className="text-center">{c.corto}</th>)}
                <th className="text-center">Faltan</th>
              </tr>
            </thead>
            <tbody>
              {filas.length === 0 && <tr><td colSpan={4 + datos.columnas.length} className="empty">{loading ? 'Cargando…' : 'No hay vendedores para mostrar con estos filtros'}</td></tr>}
              {filas.map((f) => (
                <tr key={f.vendedor_id} className={f.vigente ? '' : 'opacity-60'}>
                  <td className="font-mono text-xs text-navy-500">{f.codigo}</td>
                  <td className="font-medium">{f.nombre}{!f.vigente && <span className="badge-off ml-2">Retirado</span>}</td>
                  <td className="text-xs text-slate-500">{f.regional} · {f.equipo}</td>
                  {datos.columnas.map((c) => (
                    <td key={c.clave} className="text-center">
                      <Marca estado={f.docs[c.clave].estado} etiqueta={c.titulo} onClick={() => setAbierto({ vendedorId: f.vendedor_id, clave: c.clave })} />
                    </td>
                  ))}
                  <td className="text-center">
                    {f.faltan > 0 ? <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-600">{f.faltan}</span> : <span className="text-xs font-medium text-emerald-600">Completo</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {datos && filas.length > 0 && (
          <div className="border-t border-slate-100 px-5 py-3 text-xs text-slate-400">{filas.length} {filas.length === 1 ? 'vendedor' : 'vendedores'}</div>
        )}
      </div>

      {sel && selCat && (
        <DetalleDoc fila={sel} cat={selCat} onClose={() => setAbierto(null)} onCambio={() => cargar(true)} />
      )}
    </div>
  )
}
