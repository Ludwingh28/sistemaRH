import { AlertCircle, Check, Eye, EyeOff, X } from 'lucide-react'
import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react'

const pilaModales: symbol[] = []

export function Modal({
  titulo,
  onClose,
  children,
  ancho = 'max-w-md',
}: {
  titulo: ReactNode
  onClose: () => void
  children: ReactNode
  ancho?: string
}) {
  // Escape cierra solo el modal que está arriba (hay modales dentro de modales).
  const alCerrar = useRef(onClose)
  alCerrar.current = onClose
  useEffect(() => {
    const id = Symbol()
    pilaModales.push(id)
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && pilaModales[pilaModales.length - 1] === id) alCerrar.current()
    }
    window.addEventListener('keydown', h)
    return () => {
      window.removeEventListener('keydown', h)
      pilaModales.splice(pilaModales.indexOf(id), 1)
    }
  }, [])

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className={`card relative w-full ${ancho} max-h-[90vh] overflow-y-auto p-6 shadow-2xl`}>
        <div className="mb-5 flex items-center justify-between">
          <h3 className="text-base font-semibold">{titulo}</h3>
          <button onClick={onClose} aria-label="Cerrar" className="icon-btn"><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function PageHeader({ titulo, subtitulo, accion }: { titulo: string; subtitulo?: string; accion?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-x-4 gap-y-3 sm:mb-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">{titulo}</h2>
        {subtitulo && <p className="mt-1 text-sm text-navy-500">{subtitulo}</p>}
      </div>
      {accion}
    </div>
  )
}

export const ROL_LABEL: Record<string, string> = {
  admin: 'Administrador',
  jefe_rrhh: 'Jefe RRHH',
  dh: 'Jefe DDHH',
  analista_dh: 'Analista DH',
  lector: 'Solo lectura',
}

// ── Avatar con iniciales ─────────────────────────────────────────────────────

const AVATAR_COLORS = ['bg-brand-600', 'bg-purple-600', 'bg-rose-600', 'bg-indigo-600', 'bg-cyan-600', 'bg-emerald-600']

export function iniciales(nombre: string, username = '') {
  const partes = nombre.trim().split(/\s+/).filter(Boolean)
  const i = (partes[0]?.[0] ?? '') + (partes[1]?.[0] ?? '')
  return (i || username[0] || '?').toUpperCase()
}

export function Avatar({ id, nombre, username, size = 'h-8 w-8 text-xs' }: { id: number; nombre: string; username?: string; size?: string }) {
  return (
    <div className={`${size} ${AVATAR_COLORS[id % AVATAR_COLORS.length]} flex shrink-0 items-center justify-center rounded-full font-bold text-white`}>
      {iniciales(nombre, username)}
    </div>
  )
}

// ── Aviso temporal (toast) ───────────────────────────────────────────────────

export interface ToastData {
  msg: string
  type: 'ok' | 'err'
}

export function Toast({ toast, onDone }: { toast: ToastData | null; onDone: () => void }) {
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(onDone, 3500)
    return () => clearTimeout(t)
  }, [toast, onDone])

  if (!toast) return null
  return (
    <div
      className={`fixed right-4 top-4 z-50 flex items-center gap-2.5 rounded-xl px-4 py-3 text-sm font-medium text-white shadow-lg ${
        toast.type === 'ok' ? 'bg-emerald-600' : 'bg-red-600'
      }`}
    >
      {toast.type === 'ok' ? <Check size={15} /> : <AlertCircle size={15} />}
      {toast.msg}
    </div>
  )
}

// ── Contraseñas ──────────────────────────────────────────────────────────────

export const MIN_PASSWORD = 8

/** Misma política que el servidor: largo mínimo, letras y números, y distinta del nombre de usuario. */
export function problemaClave(pwd: string, username?: string): string | null {
  if (pwd.length < MIN_PASSWORD) return `La contraseña debe tener al menos ${MIN_PASSWORD} caracteres.`
  if (!/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/.test(pwd) || !/\d/.test(pwd)) return 'La contraseña debe incluir letras y números.'
  if (username && pwd.trim().toLowerCase() === username.trim().toLowerCase())
    return 'La contraseña no puede ser igual al nombre de usuario.'
  return null
}

export function PasswordInput({
  value,
  onChange,
  placeholder,
  invalido,
  autoComplete = 'new-password',
  autoFocus,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  invalido?: boolean
  autoComplete?: string
  autoFocus?: boolean
}) {
  const [ver, setVer] = useState(false)
  return (
    <div className="relative">
      <input
        type={ver ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        required
        className={`input-field pr-10 ${invalido ? 'border-red-300 focus:ring-red-400' : ''}`}
      />
      <button
        type="button"
        tabIndex={-1}
        onClick={() => setVer((v) => !v)}
        aria-label={ver ? 'Ocultar contraseña' : 'Ver contraseña'}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
      >
        {ver ? <EyeOff size={15} /> : <Eye size={15} />}
      </button>
    </div>
  )
}

function fortaleza(pwd: string): { nivel: 1 | 2 | 3; etiqueta: string; color: string } {
  if (pwd.length < MIN_PASSWORD) return { nivel: 1, etiqueta: 'Débil', color: 'bg-red-400' }
  const score = [pwd.length >= 8, /[A-Z]/.test(pwd), /[0-9]/.test(pwd), /[^A-Za-z0-9]/.test(pwd)].filter(Boolean).length
  if (score <= 1) return { nivel: 1, etiqueta: 'Débil', color: 'bg-red-400' }
  if (score <= 2) return { nivel: 2, etiqueta: 'Moderada', color: 'bg-yellow-400' }
  return { nivel: 3, etiqueta: 'Fuerte', color: 'bg-green-500' }
}

export function Fortaleza({ value }: { value: string }) {
  if (!value) return null
  const f = fortaleza(value)
  return (
    <div className="mt-2 space-y-1">
      <div className="flex gap-1">
        {[1, 2, 3].map((n) => (
          <div key={n} className={`h-1 flex-1 rounded-full transition-colors duration-300 ${f.nivel >= n ? f.color : 'bg-slate-200'}`} />
        ))}
      </div>
      <p className="text-xs text-slate-500">
        Seguridad: <span className="font-medium text-slate-700">{f.etiqueta}</span>
        {f.nivel < 3 && <span className="text-slate-400"> · Usa mayúsculas, números y símbolos para mejorarla.</span>}
      </p>
    </div>
  )
}

export function ErrorBox({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
      <AlertCircle size={14} className="shrink-0" />
      {children}
    </div>
  )
}

export const labelCls = 'mb-1.5 block text-sm font-medium text-slate-600'

/**
 * Nomenclatura de la empresa: lo que se escribe queda en MAYÚSCULAS. Se conserva la posición del
 * cursor (si no, al corregir una letra en medio del texto el cursor saltaría al final).
 * Se usa junto con la clase `mayus` para que se vea en mayúsculas desde la primera tecla.
 */
export const alEscribirMayus =
  (poner: (valor: string) => void) => (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const el = e.target
    const posicion = el.selectionStart
    poner(el.value.toUpperCase())
    if (posicion !== null) requestAnimationFrame(() => el.setSelectionRange(posicion, posicion))
  }
