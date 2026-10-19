import { AtSign, Check, History, KeyRound, LockOpen, LogOut, Pencil, Plus, Search, ShieldCheck, Trash2, UserCheck } from 'lucide-react'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../auth'
import {
  Avatar, ErrorBox, Fortaleza, MIN_PASSWORD, Modal, PageHeader, PasswordInput,
  ROL_LABEL, Toast, alEscribirMayus, labelCls, problemaClave, type ToastData,
} from '../components/ui'
import type { EventoAuditoria, Rol, Usuario } from '../types'

const ROLES = Object.entries(ROL_LABEL) as [Rol, string][]

const ROL_COLOR: Record<Rol, string> = {
  admin: 'bg-purple-100 text-purple-700',
  dh: 'bg-brand-100 text-brand-700',
  analista_dh: 'bg-cyan-100 text-cyan-700',
  lector: 'bg-slate-100 text-slate-600',
}

const limpiarUsername = (v: string) => v.toLowerCase().replace(/\s+/g, '')

// ── Última sesión ────────────────────────────────────────────────────────────

const ONLINE_MS = 5 * 60 * 1000

function UltimaSesion({ ts }: { ts: string | null }) {
  const [ahora] = useState(Date.now)
  if (!ts) return <span className="text-xs text-slate-300">Sin registro</span>

  // El servidor guarda UTC sin zona.
  const fecha = new Date(ts.endsWith('Z') ? ts : `${ts}Z`)
  const diff = ahora - fecha.getTime()
  if (diff < ONLINE_MS) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" /> En línea
      </span>
    )
  }
  const min = Math.floor(diff / 60000)
  const h = Math.floor(min / 60)
  const d = Math.floor(h / 24)
  const label =
    min < 60 ? `hace ${min} min`
    : h < 24 ? `hace ${h} h`
    : d < 7 ? `hace ${d} día${d > 1 ? 's' : ''}`
    : fecha.toLocaleDateString('es-BO', { day: '2-digit', month: 'short', year: '2-digit' })
  return <span className="text-xs text-slate-400">{label}</span>
}

// ── Bitácora de seguridad ────────────────────────────────────────────────────

const EVENTO: Record<string, { texto: string; tono: string }> = {
  login_ok: { texto: 'Ingreso', tono: 'text-emerald-600' },
  login_fallo: { texto: 'Intento fallido', tono: 'text-amber-600' },
  login_bloqueado: { texto: 'Intento con la cuenta bloqueada', tono: 'text-red-600' },
  cuenta_bloqueada: { texto: 'Cuenta bloqueada', tono: 'text-red-600' },
  cuenta_desbloqueada: { texto: 'Cuenta desbloqueada', tono: 'text-slate-700' },
  usuario_creado: { texto: 'Usuario creado', tono: 'text-slate-700' },
  usuario_modificado: { texto: 'Datos modificados', tono: 'text-slate-700' },
  usuario_eliminado: { texto: 'Usuario eliminado', tono: 'text-red-600' },
  clave_cambiada: { texto: 'Cambió su contraseña', tono: 'text-slate-700' },
  clave_restablecida: { texto: 'Contraseña restablecida', tono: 'text-slate-700' },
  sesiones_cerradas: { texto: 'Sesiones cerradas', tono: 'text-slate-700' },
}

const fechaHora = (ts: string) =>
  new Date(ts.endsWith('Z') ? ts : `${ts}Z`).toLocaleString('es-BO', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  })

function ListaEventos({ eventos, conUsuario }: { eventos: EventoAuditoria[] | null; conUsuario: boolean }) {
  if (!eventos) return <p className="py-6 text-center text-sm text-slate-400">Cargando…</p>
  if (eventos.length === 0) return <p className="py-6 text-center text-sm text-slate-400">Sin eventos registrados.</p>
  return (
    <ul className="divide-y divide-slate-100">
      {eventos.map((e) => {
        const info = EVENTO[e.evento] ?? { texto: e.evento, tono: 'text-slate-700' }
        return (
          <li key={e.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-2 text-sm">
            <span className="w-28 shrink-0 text-xs tabular-nums text-slate-400">{fechaHora(e.fecha)}</span>
            <span className={`font-medium ${info.tono}`}>{info.texto}</span>
            {conUsuario && e.usuario && <span className="font-mono text-xs text-slate-500">@{e.usuario}</span>}
            {e.actor && <span className="text-xs text-slate-400">por @{e.actor}</span>}
            {e.ip && <span className="ml-auto font-mono text-[11px] text-slate-300">{e.ip}</span>}
            {e.detalle && <span className="basis-full pl-[7.75rem] text-xs text-slate-400">{e.detalle}</span>}
          </li>
        )
      })}
    </ul>
  )
}

function Bitacora({ onClose }: { onClose: () => void }) {
  const [eventos, setEventos] = useState<EventoAuditoria[] | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    api.auditoria({ limite: 200 }).then(setEventos).catch((e) => setError(e.message))
  }, [])
  return (
    <Modal titulo="Bitácora de seguridad" onClose={onClose} ancho="max-w-2xl">
      <p className="-mt-2 mb-3 text-xs text-slate-400">Ingresos, intentos fallidos, bloqueos y cambios de cuentas. Los más recientes primero.</p>
      {error ? <ErrorBox>{error}</ErrorBox> : <ListaEventos eventos={eventos} conUsuario />}
    </Modal>
  )
}

// ── Nuevo usuario ────────────────────────────────────────────────────────────

function FormNuevo({ onDone, onClose }: { onDone: (u: Usuario) => void; onClose: () => void }) {
  const [f, setF] = useState({ username: '', nombre: '', email: '', rol: 'lector' as Rol, password: '', confirm: '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }))

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    const problema = problemaClave(f.password, f.username)
    if (problema) return setError(problema)
    if (f.password !== f.confirm) return setError('Las contraseñas no coinciden.')
    setBusy(true)
    try {
      onDone(await api.crearUsuario({
        username: f.username, nombre: f.nombre.trim(), email: f.email.trim() || undefined,
        rol: f.rol, password: f.password,
      }))
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal titulo="Nuevo usuario" onClose={onClose} ancho="max-w-lg">
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className={labelCls}>Nombre de usuario</label>
          <div className="relative">
            <AtSign size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input className="input-field pl-8 font-mono" placeholder="nombre.apellido" value={f.username}
              onChange={(e) => set('username', limpiarUsername(e.target.value))} required autoFocus />
          </div>
        </div>
        <div>
          <label className={labelCls}>Nombre completo</label>
          <input className="input-field mayus" value={f.nombre} onChange={alEscribirMayus((v) => set('nombre', v))} required />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className={labelCls}>Correo electrónico</label>
            <input type="email" className="input-field" value={f.email} onChange={(e) => set('email', e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>Rol</label>
            <select className="input-field" value={f.rol} onChange={(e) => set('rol', e.target.value as Rol)}>
              {ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className={labelCls}>Contraseña</label>
          <PasswordInput value={f.password} onChange={(v) => set('password', v)} placeholder={`Mínimo ${MIN_PASSWORD} caracteres, con letras y números`} />
          <Fortaleza value={f.password} />
          <p className="mt-1.5 text-xs text-slate-400">Es temporal: al ingresar por primera vez la persona deberá elegir la suya.</p>
        </div>
        <div>
          <label className={labelCls}>Confirmar contraseña</label>
          <PasswordInput value={f.confirm} onChange={(v) => set('confirm', v)} placeholder="Repetir contraseña"
            invalido={!!f.confirm && f.confirm !== f.password} />
        </div>
        {error && <ErrorBox>{error}</ErrorBox>}
        <button disabled={busy} className="btn-primary w-full text-sm">
          <Plus size={15} /> {busy ? 'Creando…' : 'Crear usuario'}
        </button>
      </form>
    </Modal>
  )
}

// ── Editar usuario ───────────────────────────────────────────────────────────

type Tab = 'datos' | 'contrasena' | 'seguridad'

function FormEditar({
  u, onClose, onSaved, onDeleted, onToast,
}: {
  u: Usuario
  onClose: () => void
  onSaved: (u: Usuario) => void
  onDeleted: (id: number) => void
  onToast: (t: ToastData) => void
}) {
  const [tab, setTab] = useState<Tab>('datos')
  const [d, setD] = useState({ username: u.username, nombre: u.nombre, email: u.email ?? '', rol: u.rol, activo: u.activo })
  const [pwd, setPwd] = useState({ nueva: '', confirm: '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmarBorrado, setConfirmarBorrado] = useState(false)
  const [eventos, setEventos] = useState<EventoAuditoria[] | null>(null)

  useEffect(() => {
    if (tab !== 'seguridad') return
    api.auditoria({ usuario: u.username, limite: 15 }).then(setEventos).catch(() => setEventos([]))
  }, [tab, u.username])

  const accionSeguridad = async (hacer: () => Promise<unknown>, msg: string, despues?: () => void) => {
    setError('')
    setBusy(true)
    try {
      await hacer()
      despues?.()
      onToast({ msg, type: 'ok' })
      setEventos(null)
      setEventos(await api.auditoria({ usuario: u.username, limite: 15 }))
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const guardarDatos = async () => {
    setError('')
    setBusy(true)
    try {
      onSaved(await api.actualizarUsuario(u.id, { ...d, nombre: d.nombre.trim(), email: d.email.trim() }))
      onToast({ msg: 'Datos actualizados correctamente.', type: 'ok' })
      onClose()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const guardarClave = async () => {
    setError('')
    const problema = problemaClave(pwd.nueva, u.username)
    if (problema) return setError(problema)
    if (pwd.nueva !== pwd.confirm) return setError('Las contraseñas no coinciden.')
    setBusy(true)
    try {
      await api.fijarPassword(u.id, pwd.nueva)
      onSaved({ ...u, debe_cambiar_clave: true })
      onToast({ msg: 'Contraseña restablecida. Deberá elegir una propia al ingresar.', type: 'ok' })
      onClose()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const eliminar = async () => {
    setBusy(true)
    try {
      await api.eliminarUsuario(u.id)
      onDeleted(u.id)
      onToast({ msg: `Usuario ${u.username} eliminado.`, type: 'ok' })
    } catch (err) {
      setError((err as Error).message)
      setConfirmarBorrado(false)
    } finally {
      setBusy(false)
    }
  }

  const tabs = [
    { id: 'datos', label: 'Datos', icon: UserCheck },
    { id: 'contrasena', label: 'Contraseña', icon: KeyRound },
    { id: 'seguridad', label: 'Seguridad', icon: ShieldCheck },
  ] as const

  return (
    <Modal
      ancho="max-w-xl"
      onClose={onClose}
      titulo={
        <span className="flex items-center gap-3">
          <Avatar id={u.id} nombre={u.nombre} username={u.username} size="h-9 w-9 text-sm" />
          <span className="leading-tight">
            <span className="block">{u.nombre}</span>
            <span className="block text-xs font-normal text-slate-400">@{u.username}</span>
          </span>
        </span>
      }
    >
      <div className="-mt-1 mb-5 flex border-b border-slate-100">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => { setTab(id); setError('') }}
            className={`-mb-px flex items-center gap-1.5 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
              tab === id ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}>
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      {tab === 'datos' && (
        <div className="space-y-4">
          <div>
            <label className={labelCls}>Nombre de usuario</label>
            <div className="relative">
              <AtSign size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input className="input-field pl-8 font-mono" value={d.username}
                onChange={(e) => setD({ ...d, username: limpiarUsername(e.target.value) })} />
            </div>
          </div>
          <div>
            <label className={labelCls}>Nombre completo</label>
            <input className="input-field mayus" value={d.nombre} onChange={alEscribirMayus((v) => setD((x) => ({ ...x, nombre: v })))} />
          </div>
          <div>
            <label className={labelCls}>Correo electrónico</label>
            <input type="email" className="input-field" value={d.email} onChange={(e) => setD({ ...d, email: e.target.value })} />
          </div>
          <div>
            <label className={labelCls}>Rol</label>
            <select className="input-field" value={d.rol} onChange={(e) => setD({ ...d, rol: e.target.value as Rol })}>
              {ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <label className="flex cursor-pointer items-center justify-between rounded-xl border border-slate-200 px-4 py-3">
            <span>
              <span className="block text-sm font-medium text-slate-700">Cuenta activa</span>
              <span className="block text-xs text-slate-400">Si la desactivas, no podrá iniciar sesión.</span>
            </span>
            <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={d.activo}
              onChange={(e) => setD({ ...d, activo: e.target.checked })} />
          </label>
        </div>
      )}

      {tab === 'contrasena' && (
        <div className="space-y-4">
          <p className="rounded-xl bg-amber-50 px-3 py-2.5 text-xs text-amber-700">
            Al restablecerla, se cierra la sesión que {u.nombre.split(' ')[0]} tenga abierta y deberá elegir una contraseña propia al volver a ingresar.
          </p>
          <div>
            <label className={labelCls}>Nueva contraseña</label>
            <PasswordInput value={pwd.nueva} onChange={(v) => setPwd({ ...pwd, nueva: v })} placeholder={`Mínimo ${MIN_PASSWORD} caracteres, con letras y números`} />
            <Fortaleza value={pwd.nueva} />
          </div>
          <div>
            <label className={labelCls}>Confirmar contraseña</label>
            <PasswordInput value={pwd.confirm} onChange={(v) => setPwd({ ...pwd, confirm: v })} placeholder="Repetir contraseña"
              invalido={!!pwd.confirm && pwd.confirm !== pwd.nueva} />
          </div>
        </div>
      )}

      {tab === 'seguridad' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 px-4 py-3">
            <span>
              <span className="block text-sm font-medium text-slate-700">Cerrar sesiones abiertas</span>
              <span className="block text-xs text-slate-400">Saca a {u.nombre.split(' ')[0]} de todos los equipos donde esté conectado. Podrá volver a ingresar.</span>
            </span>
            <button disabled={busy} onClick={() => accionSeguridad(() => api.cerrarSesiones(u.id), 'Sesiones cerradas.')}
              className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-60">
              <LogOut size={14} /> Cerrar sesiones
            </button>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 px-4 py-3">
            <span>
              <span className="block text-sm font-medium text-slate-700">
                Bloqueo por intentos fallidos {u.bloqueado && <span className="ml-1 rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-600">Bloqueada</span>}
              </span>
              <span className="block text-xs text-slate-400">
                {u.bloqueado ? 'Esta cuenta no puede ingresar por ahora. Puedes liberarla.' : 'La cuenta no está bloqueada.'}
              </span>
            </span>
            <button disabled={busy || !u.bloqueado}
              onClick={() => accionSeguridad(() => api.desbloquearUsuario(u.id), 'Cuenta desbloqueada.', () => onSaved({ ...u, bloqueado: false }))}
              className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40">
              <LockOpen size={14} /> Desbloquear
            </button>
          </div>
          <div>
            <p className="mb-1 flex items-center gap-1.5 text-sm font-medium text-slate-700"><History size={14} /> Actividad reciente</p>
            <ListaEventos eventos={eventos} conUsuario={false} />
          </div>
        </div>
      )}

      {error && <div className="mt-4"><ErrorBox>{error}</ErrorBox></div>}

      <div className="mt-6 flex items-center gap-3 border-t border-slate-100 pt-4">
        {!confirmarBorrado ? (
          <button onClick={() => setConfirmarBorrado(true)}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-red-500 transition-colors hover:bg-red-50 hover:text-red-700">
            <Trash2 size={14} /> Eliminar
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-red-600">¿Eliminar a {u.nombre.split(' ')[0]}?</span>
            <button onClick={eliminar} disabled={busy}
              className="rounded-lg bg-red-600 px-3 py-1.5 text-sm text-white hover:bg-red-700 disabled:opacity-60">
              Sí, eliminar
            </button>
            <button onClick={() => setConfirmarBorrado(false)}
              className="rounded-lg px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100">
              Cancelar
            </button>
          </div>
        )}
        <div className="ml-auto flex items-center gap-3">
          <button onClick={onClose} className="rounded-lg px-3 py-2 text-sm text-slate-500 hover:bg-slate-100 hover:text-slate-700">Cerrar</button>
          {tab === 'datos' && (
            <button onClick={guardarDatos} disabled={busy} className="btn-primary text-sm"><Check size={14} /> Guardar datos</button>
          )}
          {tab === 'contrasena' && (
            <button onClick={guardarClave} disabled={busy} className="btn-primary text-sm"><KeyRound size={14} /> Restablecer contraseña</button>
          )}
        </div>
      </div>
    </Modal>
  )
}

// ── Página ───────────────────────────────────────────────────────────────────

export default function Usuarios() {
  const { user } = useAuth()
  const [usuarios, setUsuarios] = useState<Usuario[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [q, setQ] = useState('')
  const [rol, setRol] = useState('')
  const [estado, setEstado] = useState('')
  const [nuevo, setNuevo] = useState(false)
  const [bitacora, setBitacora] = useState(false)
  const [editando, setEditando] = useState<Usuario | null>(null)
  const [toast, setToast] = useState<ToastData | null>(null)
  const limpiarToast = useCallback(() => setToast(null), [])

  useEffect(() => {
    if (user?.rol !== 'admin') return
    api.usuarios().then(setUsuarios).catch((e) => setError(e.message)).finally(() => setLoading(false))
  }, [user])

  if (user?.rol !== 'admin') return <Navigate to="/vendedores" replace />

  const filtrados = usuarios.filter((u) => {
    const texto = `${u.nombre} ${u.username} ${u.email ?? ''}`.toLowerCase()
    return (
      (!q || texto.includes(q.toLowerCase())) &&
      (!rol || u.rol === rol) &&
      (!estado || String(u.activo) === estado)
    )
  })

  return (
    <div>
      <Toast toast={toast} onDone={limpiarToast} />
      <PageHeader
        titulo="Gestión de usuarios"
        subtitulo="Quién puede ingresar al sistema y qué puede hacer."
        accion={
          <div className="flex flex-wrap gap-2">
            <button onClick={() => setBitacora(true)} className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
              <History size={16} /> Bitácora
            </button>
            <button onClick={() => setNuevo(true)} className="btn-primary text-sm"><Plus size={16} /> Nuevo usuario</button>
          </div>
        }
      />

      <div className="card mb-5 flex flex-col gap-3 p-4 sm:flex-row">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input className="input-field pl-9" placeholder="Buscar por nombre, usuario o correo…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select className="input-field sm:w-52" value={rol} onChange={(e) => setRol(e.target.value)}>
          <option value="">Todos los roles</option>
          {ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select className="input-field sm:w-40" value={estado} onChange={(e) => setEstado(e.target.value)}>
          <option value="">Todos</option>
          <option value="true">Activos</option>
          <option value="false">Inactivos</option>
        </select>
      </div>

      {error && <div className="mb-4"><ErrorBox>{error}</ErrorBox></div>}

      <div className="card overflow-x-auto">
        <table className="tbl">
          <thead>
            <tr>
              <th>Usuario</th>
              <th>Rol</th>
              <th className="hidden xl:table-cell">Correo</th>
              <th className="text-center">Estado</th>
              <th className="hidden lg:table-cell">Última sesión</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={6} className="empty">Cargando usuarios…</td></tr>}
            {!loading && filtrados.length === 0 && <tr><td colSpan={6} className="empty">No se encontraron usuarios</td></tr>}
            {filtrados.map((u) => (
              <tr key={u.id}>
                <td>
                  <div className="flex items-center gap-3">
                    <Avatar id={u.id} nombre={u.nombre} username={u.username} />
                    <div className="min-w-0">
                      <p className="truncate font-medium">
                        {u.nombre} {u.id === user.id && <span className="ml-1 text-xs font-normal text-slate-400">(tú)</span>}
                      </p>
                      <p className="truncate text-xs text-slate-400">@{u.username}</p>
                    </div>
                  </div>
                </td>
                <td><span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${ROL_COLOR[u.rol]}`}>{ROL_LABEL[u.rol]}</span></td>
                <td className="hidden max-w-48 truncate text-slate-500 xl:table-cell">{u.email || <span className="text-slate-300">—</span>}</td>
                <td className="text-center">
                  <span className={u.activo ? 'badge-ok' : 'badge-off'}>{u.activo ? 'Activo' : 'Inactivo'}</span>
                  {u.bloqueado && <span className="mt-1 block text-[11px] font-medium text-red-600">Bloqueado por intentos</span>}
                  {u.debe_cambiar_clave && <span className="mt-1 block text-[11px] text-amber-600">Clave temporal</span>}
                </td>
                <td className="hidden lg:table-cell"><UltimaSesion ts={u.ultimo_acceso} /></td>
                <td className="text-right">
                  {u.id !== user.id && (
                    <button onClick={() => setEditando(u)} title="Editar usuario" className="icon-btn hover:text-brand-600">
                      <Pencil size={15} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtrados.length > 0 && (
          <div className="border-t border-slate-100 px-5 py-3 text-xs text-slate-400">
            Mostrando {filtrados.length} de {usuarios.length} usuarios
          </div>
        )}
      </div>

      {bitacora && <Bitacora onClose={() => setBitacora(false)} />}
      {nuevo && (
        <FormNuevo
          onClose={() => setNuevo(false)}
          onDone={(u) => {
            setUsuarios((us) => [...us, u])
            setNuevo(false)
            setToast({ msg: `Usuario ${u.username} creado.`, type: 'ok' })
          }}
        />
      )}
      {editando && (
        <FormEditar
          u={editando}
          onClose={() => setEditando(null)}
          onSaved={(n) => setUsuarios((us) => us.map((x) => (x.id === n.id ? n : x)))}
          onDeleted={(id) => { setUsuarios((us) => us.filter((x) => x.id !== id)); setEditando(null) }}
          onToast={setToast}
        />
      )}
    </div>
  )
}
