import { UploadCloud } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

/**
 * Zona para soltar archivos arrastrándolos («Suelta aquí») o elegirlos con un clic o con el teclado.
 * Evita además que el navegador abra el archivo si se suelta por error un poco fuera de la zona.
 */
export default function ZonaSuelta({
  onArchivos,
  accept,
  titulo = 'Suelta aquí los archivos',
  ayuda,
  disabled = false,
  multiple = true,
  compacta = false,
}: {
  onArchivos: (archivos: File[]) => void
  accept: string
  titulo?: string
  ayuda?: string
  disabled?: boolean
  multiple?: boolean
  compacta?: boolean
}) {
  const [sobre, setSobre] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const dentro = useRef(0) // dragenter/dragleave se disparan también al pasar sobre los hijos

  useEffect(() => {
    const frenar = (e: DragEvent) => {
      if (e.dataTransfer?.types?.includes('Files')) e.preventDefault()
    }
    window.addEventListener('dragover', frenar)
    window.addEventListener('drop', frenar)
    return () => {
      window.removeEventListener('dragover', frenar)
      window.removeEventListener('drop', frenar)
    }
  }, [])

  const elegir = () => !disabled && input.current?.click()

  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      aria-label={`${titulo}. ${ayuda ?? ''} Pulsa Enter para elegir archivos.`}
      onClick={elegir}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          elegir()
        }
      }}
      onDragEnter={(e) => {
        e.preventDefault()
        dentro.current += 1
        if (!disabled) setSobre(true)
      }}
      onDragOver={(e) => {
        e.preventDefault()
        e.dataTransfer.dropEffect = disabled ? 'none' : 'copy'
      }}
      onDragLeave={() => {
        dentro.current = Math.max(0, dentro.current - 1)
        if (dentro.current === 0) setSobre(false)
      }}
      onDrop={(e) => {
        e.preventDefault()
        dentro.current = 0
        setSobre(false)
        if (disabled) return
        const archivos = Array.from(e.dataTransfer.files)
        if (archivos.length) onArchivos(multiple ? archivos : archivos.slice(0, 1))
      }}
      className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed text-center transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
        compacta ? 'gap-0.5 px-3 py-3' : 'gap-1 px-4 py-5'
      } ${
        disabled
          ? 'cursor-not-allowed border-slate-200 bg-slate-50 opacity-60'
          : sobre
            ? 'border-brand-500 bg-brand-50'
            : 'border-slate-300 bg-slate-50/60 hover:border-brand-400 hover:bg-brand-50/50'
      }`}
    >
      <UploadCloud size={compacta ? 18 : 22} className={sobre ? 'text-brand-600' : 'text-slate-400'} />
      <p className={`font-medium ${compacta ? 'text-xs' : 'text-sm'} ${sobre ? 'text-brand-700' : 'text-slate-600'}`}>
        {sobre ? 'Suéltalo para subirlo' : titulo}
      </p>
      <p className="text-[11px] text-slate-400">o haz clic para elegirlos{ayuda ? ` · ${ayuda}` : ''}</p>
      <input
        ref={input}
        type="file"
        accept={accept}
        multiple={multiple}
        className="hidden"
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => {
          const archivos = Array.from(e.target.files ?? [])
          if (archivos.length) onArchivos(archivos)
          e.target.value = ''
        }}
      />
    </div>
  )
}
