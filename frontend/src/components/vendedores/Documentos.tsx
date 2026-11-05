import { Check, CheckCircle2, Copy, Download, Eye, FileText, FolderPlus, Loader2, Trash2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { api, guardarComo } from '../../api'
import { useAuth } from '../../auth'
import { fmt } from '../../format'
import type { ArchivoContrato, DocumentosVendedor } from '../../types'
import { Confirmar, ErrorBox, Modal } from '../ui'
import ZonaSuelta from './ZonaSuelta'

const MAX_MB = 15

const tamano = (bytes: number) => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`)

/** Valida un archivo antes de subirlo: devuelve el motivo si no sirve. */
export function motivoRechazo(f: File, extensiones = ['.pdf']): string | null {
  if (!extensiones.some((x) => f.name.toLowerCase().endsWith(x))) return `«${f.name}»: solo se aceptan archivos ${extensiones.map((x) => x.slice(1).toUpperCase()).join(', ')}`
  if (f.size > MAX_MB * 1048576) return `«${f.name}»: supera los ${MAX_MB} MB`
  if (f.size === 0) return `«${f.name}»: está vacío`
  return null
}

/**
 * Documentos de un vendedor en su carpeta de la unidad compartida de RH (se leen en vivo).
 * Cada tipo (contratos, kardex, CV…); otros tipos de documento se agregan en el backend (CATEGORIAS) y aquí
 * con otra instancia de este componente, pasando `categoria`, `titulo` y `extensiones`.
 */
export default function Documentos({
  vendedorId,
  nombre,
  categoria = 'contratos',
  titulo = 'Contratos firmados',
  extensiones = ['.pdf'],
}: {
  vendedorId: number
  nombre: string
  categoria?: string
  titulo?: string
  extensiones?: string[]
}) {
  const { puede } = useAuth()
  const [datos, setDatos] = useState<DocumentosVendedor | null>(null)
  const [error, setError] = useState('')
  const [exito, setExito] = useState('')
  const [busy, setBusy] = useState(false)
  const [copiado, setCopiado] = useState(false)
  const [contrato, setContrato] = useState('') // número del contrato elegido (solo en «contratos» con más de uno)
  const [pendientes, setPendientes] = useState<File[]>([]) // elegidos pero aún sin guardar: se guardan con el botón «Guardar»
  const [otro, setOtro] = useState(false) // mostrar la zona de subida aunque el documento ya esté subido
  const [visor, setVisor] = useState<{ nombre: string; url: string | null; pintado: boolean } | null>(null) // PDF abierto dentro del sistema (url null = aún descargando)
  const [aQuitar, setAQuitar] = useState<ArchivoContrato | null>(null) // archivo pendiente de confirmar su retiro
  const pedido = useRef(0) // descarta la respuesta de un visor que ya se cerró

  const cargar = () => api.documentosVendedor(vendedorId, categoria).then(setDatos).catch((e) => setError(e.message))
  useEffect(() => {
    cargar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vendedorId, categoria])

  // El documento se ve dentro del sistema (visor propio); el archivo siempre se pide con la sesión, nunca por un enlace público.
  const ver = async (a: ArchivoContrato, descargar = false) => {
    setError('')
    const id = ++pedido.current
    if (!descargar) setVisor({ nombre: a.nombre, url: null, pintado: false }) // la ventana se abre ya, con animación de carga
    try {
      const { blob } = await api.verDocumento(vendedorId, a.nombre, descargar, categoria)
      if (descargar) guardarComo(blob, a.nombre)
      else if (id === pedido.current) {
        setVisor({ nombre: a.nombre, url: URL.createObjectURL(blob), pintado: false })
        // por si el navegador no avisa que terminó de pintar el PDF, la animación no se queda para siempre
        setTimeout(() => { if (id === pedido.current) setVisor((v) => (v ? { ...v, pintado: true } : v)) }, 3000)
      }
    } catch (e) {
      if (!descargar && id === pedido.current) setVisor(null)
      setError((e as Error).message)
    }
  }
  const cerrarVisor = () => {
    pedido.current += 1
    if (visor?.url) URL.revokeObjectURL(visor.url)
    setVisor(null)
  }

  // En «contratos» cada PDF es de un contrato en particular: con uno solo se asigna solo; con varios hay que elegirlo.
  const contratos = datos?.contratos ?? []
  const esContrato = categoria === 'contratos'
  const numeroContrato = !esContrato ? undefined : contratos.length === 1 ? contratos[0].numero : contrato ? Number(contrato) : undefined
  const falta = esContrato && numeroContrato === undefined && contratos.length > 1
  const ORD: Record<number, string> = { 1: '1er', 2: '2do', 3: '3er', 4: '4to', 5: '5to', 6: '6to', 7: '7mo', 8: '8vo', 9: '9no', 10: '10mo' }
  const ordinal = (n: number) => ORD[n] ?? `${n}º`

  // Al soltar o elegir archivos NO se guardan: quedan pendientes hasta que se pulse «Guardar».
  const preparar = (archivos: File[]) => {
    setError('')
    setExito('')
    const buenos: File[] = []
    const fallos: string[] = []
    for (const f of archivos) {
      const motivo = motivoRechazo(f, extensiones)
      if (motivo) fallos.push(motivo)
      else buenos.push(f)
    }
    setPendientes((ant) => [...ant, ...buenos.filter((f) => !ant.some((x) => x.name === f.name && x.size === f.size))])
    if (fallos.length) setError(fallos.join('\n'))
  }

  // Guarda uno por uno los archivos pendientes y resume qué pasó con cada uno.
  const guardar = async () => {
    setError('')
    setExito('')
    setBusy(true)
    const fallos: string[] = []
    const noSubidos: File[] = []
    let subidos = 0
    for (const f of pendientes) {
      try {
        await api.subirDocumento(vendedorId, f, categoria, numeroContrato)
        subidos += 1
      } catch (e) {
        fallos.push(`«${f.name}»: ${(e as Error).message}`)
        noSubidos.push(f)
      }
    }
    setPendientes(noSubidos) // lo que falló sigue pendiente para reintentar o quitarlo
    await cargar()
    setBusy(false)
    if (subidos) {
      setExito(subidos === 1 ? 'Archivo guardado.' : `${subidos} archivos guardados.`)
      setOtro(false)
    }
    if (fallos.length) setError(fallos.join('\n'))
  }

  const quitar = async (a: ArchivoContrato) => {
    setBusy(true)
    try {
      await api.quitarDocumento(vendedorId, a.nombre, categoria)
      setExito('')
      await cargar()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
      setAQuitar(null)
    }
  }

  const crearCarpeta = async () => {
    setBusy(true)
    setError('')
    try {
      setDatos(await api.crearCarpetaVendedor(vendedorId, categoria))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const copiar = async () => {
    if (!datos?.ruta) return
    try {
      await navigator.clipboard.writeText(datos.ruta)
      setCopiado(true)
      setTimeout(() => setCopiado(false), 2000)
    } catch {
      /* el navegador no permite copiar: la ruta queda visible para copiarla a mano */
    }
  }

  return (
    <section className="rounded-xl border border-slate-200 p-4">
      <h4 className="flex items-center gap-1.5 text-sm font-semibold"><FileText size={15} /> {titulo}</h4>

      {!datos && !error && <p className="mt-2 text-xs text-slate-400">Consultando la carpeta…</p>}
      {datos && !datos.configurada && <p className="mt-2 text-xs text-slate-500">{datos.aviso}</p>}
      {datos?.configurada && !datos.disponible && <p className="mt-2 text-xs text-amber-700">{datos.aviso}</p>}

      {datos?.disponible && (
        <>
          {datos.existe_carpeta && datos.ruta && (
            <p className="mt-1 flex items-center gap-1.5 text-[11px] text-slate-400">
              <span className="min-w-0 break-all font-mono">{datos.ruta}</span>
              <button className="icon-btn shrink-0" title={copiado ? 'Copiada' : 'Copiar la ruta'} aria-label="Copiar la ruta de la carpeta" onClick={copiar}>
                <Copy size={12} />
              </button>
              {copiado && <span className="text-emerald-600">copiada</span>}
            </p>
          )}

          <div className="mt-2 space-y-1.5">
            {datos.archivos.length === 0 && (
              <p className="text-xs text-slate-400">
                {datos.existe_carpeta ? 'La carpeta está vacía: aún no hay archivos.' : 'Este vendedor aún no tiene carpeta; se crea al subir el primer archivo.'}
              </p>
            )}
            {datos.archivos.map((a) => (
              <div key={a.nombre} className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs">
                <FileText size={14} className={`shrink-0 ${a.tipo === 'application/pdf' ? 'text-red-500' : 'text-brand-600'}`} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-slate-700" title={a.nombre}>{a.nombre}</p>
                  <p className="text-[11px] text-slate-400">{tamano(a.tamano)} · {fmt(a.modificado)}</p>
                </div>
                <button className="icon-btn" title="Ver" aria-label={`Ver ${a.nombre}`} onClick={() => ver(a)}><Eye size={15} /></button>
                <button className="icon-btn" title="Descargar" aria-label={`Descargar ${a.nombre}`} onClick={() => ver(a, true)}><Download size={15} /></button>
                {puede('documentos.eliminar') && (
                  <button className="icon-btn hover:text-red-600!" title="Quitar" aria-label={`Quitar ${a.nombre}`} onClick={() => setAQuitar(a)}><Trash2 size={15} /></button>
                )}
              </div>
            ))}
          </div>

          {puede('documentos.subir') && (categoria === 'contratos' || datos.archivos.length === 0 || otro) && <div className="mt-3">
            {esContrato && contratos.length > 1 && (
              <div className="mb-2">
                <label className="mb-1 block text-xs font-medium text-slate-600">¿A qué contrato corresponde el archivo?</label>
                <select className="input-field" value={contrato} onChange={(e) => setContrato(e.target.value)}>
                  <option value="">Elige el contrato…</option>
                  {contratos.map((c) => <option key={c.numero} value={c.numero}>{ordinal(c.numero)} contrato · {fmt(c.fecha_inicio)} → {fmt(c.fecha_fin)}</option>)}
                </select>
              </div>
            )}
            {(esContrato ? numeroContrato !== undefined : !!datos.nombre_base) && (
              <p className="mb-2 text-[11px] text-slate-400">Se guardará como «{esContrato ? `${ordinal(numeroContrato!)} contrato` : datos.nombre_base} ({nombre}).pdf».</p>
            )}
            {pendientes.length === 0 ? (
              <ZonaSuelta
                onArchivos={preparar}
                accept={extensiones.join(',')}
                titulo={falta ? 'Primero elige a qué contrato corresponde' : 'Suelta aquí el PDF o haz clic para elegirlo'}
                ayuda={`${extensiones.map((x) => x.slice(1).toUpperCase()).join(', ')} · hasta ${MAX_MB} MB · no se guarda hasta que lo confirmes`}
                disabled={busy || falta}
              />
            ) : (
              <div className="rounded-xl border border-brand-200 bg-brand-50/40 p-3">
                <p className="text-xs font-medium text-slate-600">Listo para guardar. Revisa y confirma:</p>
                <div className="mt-2 space-y-1.5">
                  {pendientes.map((f) => (
                    <div key={f.name + f.size} className="flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-xs ring-1 ring-slate-200">
                      <FileText size={14} className="shrink-0 text-red-500" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium text-slate-700" title={f.name}>{f.name}</p>
                        <p className="text-[11px] text-slate-400">{tamano(f.size)}</p>
                      </div>
                      <button className="icon-btn" title="Quitar de la lista" aria-label={`Quitar ${f.name} de la lista`} disabled={busy} onClick={() => setPendientes((ant) => ant.filter((x) => x !== f))}><X size={14} /></button>
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex items-center justify-end gap-2">
                  <button onClick={() => setPendientes([])} disabled={busy} className="rounded-lg px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-100 disabled:opacity-50">Cancelar</button>
                  <button onClick={guardar} disabled={busy || falta} className="btn-primary text-sm" title={falta ? 'Elige primero a qué contrato corresponde' : undefined}>
                    <Check size={14} /> {busy ? 'Guardando…' : 'Guardar'}
                  </button>
                </div>
              </div>
            )}
          </div>}

          {puede('documentos.subir') && categoria !== 'contratos' && datos.archivos.length > 0 && !otro && (
            <button onClick={() => setOtro(true)} className="mt-2 text-xs font-medium text-brand-600 hover:text-brand-700">Subir otro archivo</button>
          )}

          {!datos.existe_carpeta && puede('documentos.subir') && (
            <button onClick={crearCarpeta} disabled={busy} className="mt-2 flex items-center gap-1.5 text-xs font-medium text-brand-600 hover:text-brand-700 disabled:opacity-50">
              <FolderPlus size={13} /> Crear la carpeta ahora
            </button>
          )}
        </>
      )}

      {exito && (
        <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-emerald-700" role="status">
          <CheckCircle2 size={14} /> {exito}
        </p>
      )}
      {error && <div className="mt-2 whitespace-pre-line"><ErrorBox>{error}</ErrorBox></div>}

      {visor && (
        <Modal ancho="max-w-[96vw] xl:max-w-7xl" onClose={cerrarVisor} titulo={<span className="block max-w-[70vw] truncate">{visor.nombre}</span>}>
          <div className="relative h-[calc(90vh-8.5rem)] min-h-[24rem] w-full overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
            {visor.url && (
              <iframe
                src={visor.url} title={visor.nombre} className="h-full w-full"
                onLoad={() => setVisor((v) => (v ? { ...v, pintado: true } : v))}
              />
            )}
            {!visor.pintado && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-slate-50 text-sm text-slate-500" role="status">
                <Loader2 size={30} className="animate-spin text-brand-600" />
                Cargando el documento…
              </div>
            )}
          </div>
        </Modal>
      )}

      {aQuitar && (
        <Confirmar
          titulo="Quitar el archivo" peligro confirmar="Quitar" busy={busy}
          onCancel={() => setAQuitar(null)} onConfirm={() => quitar(aQuitar)}
          mensaje={<>¿Quitar <b className="break-words">{aQuitar.nombre}</b> de la carpeta de {nombre}? No se borra: queda apartado en la carpeta <span className="font-mono text-xs">_eliminados</span>.</>}
        />
      )}
    </section>
  )
}
