import { Check, KeyRound, LogOut, ShieldCheck } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { api } from '../api'
import { useAuth } from '../auth'
import logo from '../assets/logo.png'
import {
  Avatar, ErrorBox, Fortaleza, MIN_PASSWORD, PageHeader, PasswordInput, ROL_LABEL, labelCls, problemaClave,
} from '../components/ui'

/** `obligatorio`: pantalla completa que se muestra al ingresar con una clave temporal (cuenta nueva o restablecida). */
export default function CambiarClave({ obligatorio = false }: { obligatorio?: boolean }) {
  const { user, adoptarSesion, logout } = useAuth()
  const [f, setF] = useState({ actual: '', nueva: '', confirm: '' })
  const [error, setError] = useState('')
  const [ok, setOk] = useState(false)
  const [busy, setBusy] = useState(false)

  if (!user) return null

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setOk(false)
    const problema = problemaClave(f.nueva, user.username)
    if (problema) return setError(problema)
    if (f.nueva !== f.confirm) return setError('Las contraseñas nuevas no coinciden.')
    if (f.actual === f.nueva) return setError('La nueva contraseña debe ser distinta a la actual.')
    setBusy(true)
    try {
      // El servidor devuelve un token nuevo; el anterior deja de valer.
      const { access_token, expires_in } = await api.cambiarPassword(f.actual, f.nueva)
      await adoptarSesion(access_token, expires_in)
      setOk(true)
      setF({ actual: '', nueva: '', confirm: '' })
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const formulario = (
    <>
      {ok && (
        <div className="mb-5 flex items-center gap-3 rounded-xl border border-green-200 bg-green-50 px-4 py-3.5 text-sm text-green-700">
          <ShieldCheck size={18} className="shrink-0 text-green-600" />
          <div>
            <p className="font-semibold">Contraseña actualizada</p>
            <p className="mt-0.5 text-xs text-green-600">Tu contraseña fue cambiada exitosamente.</p>
          </div>
        </div>
      )}

      <form onSubmit={submit} className="card space-y-5 p-6">
        <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
          <Avatar id={user.id} nombre={user.nombre} username={user.username} size="h-10 w-10 text-sm" />
          <div>
            <p className="text-sm font-semibold">{user.nombre}</p>
            <p className="text-xs text-slate-400">{user.email || ROL_LABEL[user.rol]}</p>
          </div>
        </div>

        {error && <ErrorBox>{error}</ErrorBox>}

        <div>
          <label className={labelCls}>
            {obligatorio ? 'Contraseña temporal' : 'Contraseña actual'} <span className="text-red-500">*</span>
          </label>
          <PasswordInput
            value={f.actual}
            onChange={(v) => setF({ ...f, actual: v })}
            placeholder={obligatorio ? 'La que te entregó el administrador' : 'Tu contraseña actual'}
            autoComplete="current-password"
            autoFocus={obligatorio}
          />
        </div>
        <div>
          <label className={labelCls}>Nueva contraseña <span className="text-red-500">*</span></label>
          <PasswordInput value={f.nueva} onChange={(v) => setF({ ...f, nueva: v })} placeholder={`Mínimo ${MIN_PASSWORD} caracteres, con letras y números`} />
          <Fortaleza value={f.nueva} />
        </div>
        <div>
          <label className={labelCls}>Confirmar nueva contraseña <span className="text-red-500">*</span></label>
          <PasswordInput value={f.confirm} onChange={(v) => setF({ ...f, confirm: v })} placeholder="Repetir nueva contraseña"
            invalido={!!f.confirm && f.confirm !== f.nueva} />
          {f.confirm && f.confirm !== f.nueva && <p className="mt-1 text-xs text-red-500">Las contraseñas no coinciden.</p>}
          {f.confirm && f.confirm === f.nueva && f.nueva.length >= MIN_PASSWORD && (
            <p className="mt-1 flex items-center gap-1 text-xs text-green-600"><Check size={11} /> Las contraseñas coinciden.</p>
          )}
        </div>

        <button disabled={busy} className="btn-primary w-full text-sm">
          <KeyRound size={15} /> {busy ? 'Actualizando…' : obligatorio ? 'Guardar y continuar' : 'Cambiar contraseña'}
        </button>
      </form>

      <div className="mt-4 rounded-xl border border-blue-100 bg-blue-50 p-4">
        <p className="mb-1.5 text-xs font-semibold text-blue-700">Recomendaciones</p>
        <ul className="space-y-1 text-xs text-blue-600">
          <li>• Usa al menos {MIN_PASSWORD} caracteres, con letras y números.</li>
          <li>• Combina letras mayúsculas, minúsculas y símbolos (!@#$%) para mayor seguridad.</li>
          <li>• No uses contraseñas fáciles como tu nombre, tu usuario o tu fecha de nacimiento.</li>
        </ul>
      </div>
    </>
  )

  if (obligatorio) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-brand-900 p-4">
        <div className="w-full max-w-md">
          <div className="mb-6 text-center">
            <img src={logo} alt="Cruzimex" className="mx-auto mb-3 h-20 drop-shadow-2xl" />
            <h1 className="text-xl font-semibold text-white">Elige tu contraseña</h1>
            <p className="mt-1 text-sm text-slate-300">
              Por seguridad, antes de continuar reemplaza la contraseña temporal por una que solo tú conozcas.
            </p>
          </div>
          {formulario}
          <button onClick={logout} className="mx-auto mt-5 flex items-center gap-1.5 text-xs text-slate-300 hover:text-white">
            <LogOut size={13} /> Cerrar sesión
          </button>
        </div>
      </div>
    )
  }

  return (
    <div>
      <PageHeader titulo="Cambiar contraseña" subtitulo="Actualiza la contraseña de tu cuenta." />
      <div className="mx-auto max-w-md">{formulario}</div>
    </div>
  )
}
