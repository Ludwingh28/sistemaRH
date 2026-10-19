import { Sparkles, Wrench, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { VERSION_ACTUAL, changelog } from '../changelog'
import { useAuth } from '../auth'

const LS_KEY = 'cruzimex_rh_changelog_seen'

// Seguro ante navegación privada o almacenamiento bloqueado.
const leerVisto = () => {
  try {
    return localStorage.getItem(LS_KEY)
  } catch {
    return null
  }
}
const guardarVisto = () => {
  try {
    localStorage.setItem(LS_KEY, VERSION_ACTUAL)
  } catch {
    /* sin almacenamiento: el modal volverá a aparecer, no es crítico */
  }
}

export default function WhatsNewModal() {
  const { user } = useAuth()
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (user && leerVisto() !== VERSION_ACTUAL) setOpen(true)
  }, [user])

  const cerrar = () => {
    guardarVisto()
    setOpen(false)
  }

  if (!open || !user) return null
  const entry = changelog[0]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <Sparkles size={18} className="text-brand-600" />
            <h2 className="font-bold text-slate-800 text-base">Novedades — v{entry.version}</h2>
            <span className="text-[11px] text-slate-400 ml-1">{entry.fecha}</span>
          </div>
          <button onClick={cerrar} aria-label="Cerrar" className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto px-6 py-4 space-y-5">
          {entry.novedades.length > 0 && (
            <section>
              <div className="flex items-center gap-1.5 mb-2">
                <Sparkles size={14} className="text-emerald-600" />
                <h3 className="text-xs font-bold text-emerald-700 uppercase tracking-wide">Novedades</h3>
              </div>
              <ul className="space-y-1.5">
                {entry.novedades.map((n, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-slate-700">
                    <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                    {n}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {entry.correcciones.length > 0 && (
            <section>
              <div className="flex items-center gap-1.5 mb-2">
                <Wrench size={14} className="text-amber-600" />
                <h3 className="text-xs font-bold text-amber-700 uppercase tracking-wide">Correcciones</h3>
              </div>
              <ul className="space-y-1.5">
                {entry.correcciones.map((c, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-slate-700">
                    <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                    {c}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-100">
          <button onClick={cerrar} className="btn-primary w-full text-sm rounded-xl">
            Entendido
          </button>
        </div>
      </div>
    </div>
  )
}
