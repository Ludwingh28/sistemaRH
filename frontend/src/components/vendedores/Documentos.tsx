import { CheckCircle2, Copy, Download, Eye, FileText, FolderPlus, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api, guardarComo } from '../../api'
import { fmt } from '../../format'
import type { ArchivoContrato, DocumentosVendedor } from '../../types'
import { ErrorBox } from '../ui'
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
 * Hoy solo «contratos» (PDF); otros tipos de documento se agregan en el backend (CATEGORIAS) y aquí
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
  const [datos, setDatos] = useState<DocumentosVendedor | null>(null)
  const [error, setError] = useState('')
  const [exito, setExito] = useState('')
  const [busy, setBusy] = useState(false)
  const [copiado, setCopiado] = useState(false)

  const cargar = () => api.documentosVendedor(vendedorId, categoria).then(setDatos).catch((e) => setError(e.message))
  useEffect(() => {
    cargar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vendedorId, categoria])

  const ver = async (a: ArchivoContrato, descargar = false) => {
    setError('')
    // La pestaña se abre antes de pedir el archivo para que el navegador no la bloquee.
    const ventana = descargar ? null : window.open('', '_blank')
    try {
      const { blob } = await api.verDocumento(vendedorId, a.nombre, descargar, categoria)
      if (descargar) {
        guardarComo(blob, a.nombre)
      } else {
        const url = URL.createObjectURL(blob)
        if (ventana) ventana.location.href = url
        setTimeout(() => URL.revokeObjectURL(url), 120_000)
      }
    } catch (e) {
      ventana?.close()
      setError((e as Error).message)
    }
  }

  // Sube uno por uno los archivos soltados o elegidos y resume qué pasó con cada uno.
  const subir = async (archivos: File[]) => {
    setError('')
    setExito('')
    setBusy(true)
    const fallos: string[] = []
    let subidos = 0
    for (const f of archivos) {
      const motivo = motivoRechazo(f, extensiones)
      if (motivo) {
        fallos.push(motivo)
        continue
      }
      try {
        await api.subirDocumento(vendedorId, f, categoria)
        subidos += 1
      } catch (e) {
        fallos.push(`«${f.name}»: ${(e as Error).message}`)
      }
    }
    await cargar()
    setBusy(false)
    if (subidos) setExito(subidos === 1 ? 'Archivo subido.' : `${subidos} archivos subidos.`)
    if (fallos.length) setError(fallos.join('\n'))
  }

  const quitar = async (a: ArchivoContrato) => {
    if (!window.confirm(`¿Quitar «${a.nombre}» de la carpeta de ${nombre}? No se borra: queda apartado en la carpeta _eliminados.`)) return
    try {
      await api.quitarDocumento(vendedorId, a.nombre, categoria)
      setExito('')
      await cargar()
    } catch (e) {
      setError((e as Error).message)
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
                <button className="icon-btn hover:text-red-600!" title="Quitar" aria-label={`Quitar ${a.nombre}`} onClick={() => quitar(a)}><Trash2 size={15} /></button>
              </div>
            ))}
          </div>

          <div className="mt-3">
            <ZonaSuelta
              onArchivos={subir}
              accept={extensiones.join(',')}
              titulo={busy ? 'Subiendo…' : `Suelta aquí los ${titulo.toLowerCase()}`}
              ayuda={`${extensiones.map((x) => x.slice(1).toUpperCase()).join(', ')} · hasta ${MAX_MB} MB`}
              disabled={busy}
            />
          </div>

          {!datos.existe_carpeta && (
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
    </section>
  )
}
