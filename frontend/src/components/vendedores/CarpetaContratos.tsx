import { FolderPlus, Link2, SearchCheck } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../../api'
import type { EstadoCarpetas, ResultadoCrearCarpetas, RevisionCarpetas } from '../../types'
import { ErrorBox, Modal } from '../ui'

/** Carpetas de contratos en la unidad compartida de RH: estado, creación de las que faltan y vinculación (solo admin). */
export default function CarpetaContratos({ onClose, onCambio }: { onClose: () => void; onCambio: () => void }) {
  const [estado, setEstado] = useState<EstadoCarpetas | null>(null)
  const [resultado, setResultado] = useState<ResultadoCrearCarpetas | null>(null)
  const [revision, setRevision] = useState<RevisionCarpetas | null>(null)
  const [elegido, setElegido] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const cargarEstado = () => api.estadoCarpetas().then(setEstado).catch((e) => setError(e.message))
  useEffect(() => {
    cargarEstado()
  }, [])

  const accion = async (fn: () => Promise<void>) => {
    setError('')
    setBusy(true)
    try {
      await fn()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const crearFaltantes = () =>
    accion(async () => {
      setResultado(await api.crearCarpetasFaltantes())
      setRevision(null)
      await cargarEstado()
      onCambio()
    })

  const revisar = () => accion(async () => setRevision(await api.revisionCarpetas()))

  const vincular = (carpeta: string, vendedorId: number) =>
    accion(async () => {
      await api.vincularCarpeta(vendedorId, carpeta)
      setRevision(await api.revisionCarpetas())
      await cargarEstado()
      onCambio()
    })

  const lista = !!estado?.configurada && estado.accesible

  return (
    <Modal titulo="Carpetas de contratos" onClose={onClose} ancho="max-w-2xl">
      <div className="space-y-4 text-sm">
        {!estado && !error && <p className="text-slate-400">Consultando…</p>}
        {estado && (
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
            <p className="flex items-center gap-2 font-medium">
              <span className={`h-2.5 w-2.5 rounded-full ${lista && estado.escribible ? 'bg-emerald-500' : 'bg-red-500'}`} />
              {!estado.configurada ? 'Sin configurar' : !estado.accesible ? 'Unidad no disponible' : estado.escribible ? 'Unidad conectada' : 'Sin permiso de escritura'}
            </p>
            {estado.ruta && <p className="mt-1 break-all font-mono text-xs text-slate-500">{estado.ruta}</p>}
            {estado.mensaje && <p className="mt-1 text-xs text-slate-500">{estado.mensaje}</p>}
            {!estado.configurada && (
              <p className="mt-2 text-xs text-slate-500">
                Define <span className="font-mono">CONTRATOS_DIR</span> (por ejemplo <span className="font-mono">E:\Docs_RRHH</span>) en el <span className="font-mono">.env</span> del backend y reinicia el servicio.
              </p>
            )}
            {estado.configurada && <p className="mt-2 text-xs text-slate-500">{estado.con_carpeta} de {estado.vendedores} vendedores con carpeta · {estado.sin_carpeta} sin carpeta.</p>}
          </div>
        )}

        <div className="text-xs text-slate-500">
          <p>Estructura: <span className="font-mono">Vendedores\NOMBRE DEL VENDEDOR\Contratos\</span> con los archivos de sus contratos dentro. Cada vendedor nuevo recibe su carpeta al registrarlo.</p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button onClick={crearFaltantes} disabled={busy || !lista} className="btn-primary text-sm">
            <FolderPlus size={15} /> {busy ? 'Trabajando…' : 'Crear las carpetas que faltan'}
          </button>
          <button onClick={revisar} disabled={busy || !lista} className="btn-primary bg-white text-sm text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50 focus:ring-brand-500!">
            <SearchCheck size={15} /> Revisar nombres
          </button>
        </div>

        {resultado && (
          <p className="rounded-xl border border-slate-200 px-4 py-3">
            <b>{resultado.creadas}</b> carpetas creadas · {resultado.vinculadas} ya existían (se reconocieron por el nombre)
            {resultado.errores.length > 0 && <span className="block text-red-600">{resultado.errores[0]}</span>}
          </p>
        )}

        {revision && (
          <div className="space-y-4">
            <div>
              <p className="mb-1 font-medium text-slate-700">Carpetas de RH que no coinciden con ningún vendedor ({revision.sin_vendedor.length})</p>
              {revision.sin_vendedor.length === 0 && <p className="text-xs text-slate-400">Ninguna: todas las carpetas pertenecen a un vendedor.</p>}
              <ul className="space-y-2">
                {revision.sin_vendedor.map((c) => (
                  <li key={c.carpeta} className="rounded-xl border border-slate-200 p-3">
                    <p className="font-mono text-xs">{c.carpeta}</p>
                    {c.sugerencias.length > 0 ? (
                      c.sugerencias.map((s) => (
                        <button key={s.id} disabled={busy} onClick={() => vincular(c.carpeta, s.id)}
                          className="mt-1.5 mr-2 inline-flex items-center gap-1.5 rounded-lg border border-brand-200 bg-brand-50 px-2.5 py-1 text-xs text-brand-700 hover:bg-brand-100 disabled:opacity-50">
                          <Link2 size={12} /> Es {s.nombre} <span className="text-brand-400">({Math.round(s.similitud * 100)}%)</span>
                        </button>
                      ))
                    ) : (
                      <div className="mt-1.5 flex flex-wrap items-center gap-2">
                        <select className="input-field w-auto max-w-full py-1 text-xs" value={elegido[c.carpeta] ?? ''}
                          onChange={(e) => setElegido({ ...elegido, [c.carpeta]: e.target.value })}>
                          <option value="">Vincular a…</option>
                          {revision.sin_carpeta.map((v) => <option key={v.id} value={v.id}>{v.nombre} ({v.codigo}){v.vigente ? '' : ' · retirado'}</option>)}
                        </select>
                        <button disabled={busy || !elegido[c.carpeta]} onClick={() => vincular(c.carpeta, Number(elegido[c.carpeta]))}
                          className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50">Vincular</button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="mb-1 font-medium text-slate-700">Vendedores sin carpeta ({revision.sin_carpeta.length})</p>
              <ul className="max-h-40 space-y-0.5 overflow-y-auto text-xs text-slate-500">
                {revision.sin_carpeta.map((v) => <li key={v.id}>{v.nombre} <span className="text-slate-400">({v.codigo}{v.vigente ? '' : ' · retirado'})</span></li>)}
              </ul>
              {revision.sin_carpeta.length > 0 && <p className="mt-1 text-xs text-slate-400">«Crear las carpetas que faltan» crea las de los vigentes; los retirados no reciben carpeta nueva.</p>}
            </div>
          </div>
        )}
        {error && <ErrorBox>{error}</ErrorBox>}
      </div>
    </Modal>
  )
}
