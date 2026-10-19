import { Clock, LogOut } from 'lucide-react'
import { useEffect, useState } from 'react'
import { getExpira } from '../api'
import { useAuth } from '../auth'

const formato = (seg: number) => `${Math.floor(seg / 60)}:${String(seg % 60).padStart(2, '0')}`

/** Aviso de que la sesión está por vencer, con cuenta regresiva y botón para seguir conectado. */
export default function SesionAviso() {
  const { porVencer, topeAlcanzado, renovar, logout } = useAuth()
  const [resta, setResta] = useState(0)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!porVencer) return
    const t = () => setResta(Math.max(0, Math.round((getExpira() - Date.now()) / 1000)))
    t()
    const id = window.setInterval(t, 1000)
    return () => window.clearInterval(id)
  }, [porVencer])

  if (!porVencer) return null

  return (
    <div
      role="alertdialog"
      aria-live="assertive"
      className="fixed inset-x-4 bottom-4 z-[60] mx-auto flex max-w-md items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 shadow-2xl sm:left-auto sm:right-6 sm:mx-0"
    >
      <Clock size={20} className="mt-0.5 shrink-0 text-amber-600" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-amber-900">Tu sesión está por vencer · {formato(resta)}</p>
        <p className="mt-0.5 text-xs text-amber-800">
          {topeAlcanzado
            ? 'Llegaste al tiempo máximo de una sesión. Guarda lo que estés haciendo y vuelve a ingresar.'
            : 'Por seguridad se cierra cuando no hay actividad. ¿Sigues trabajando?'}
        </p>
        <div className="mt-3 flex gap-2">
          {!topeAlcanzado && (
            <button
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                await renovar()
                setBusy(false)
              }}
              className="btn-primary text-xs"
            >
              Seguir conectado
            </button>
          )}
          <button onClick={logout} className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs text-amber-900 hover:bg-amber-100">
            <LogOut size={13} /> Cerrar sesión
          </button>
        </div>
      </div>
    </div>
  )
}
