import { Check, Lock, RotateCcw } from 'lucide-react'
import { Fragment, useEffect, useMemo, useState } from 'react'
import { api } from '../../api'
import type { PermisoDef, PermisosRoles, PermisosUsuario, Usuario } from '../../types'
import { Esqueleto } from '../Cargando'
import { ErrorBox, Modal, ROL_LABEL } from '../ui'

const ROLES_EDITABLES = ['jefe_rrhh', 'dh', 'analista_dh', 'lector'] as const

const porGrupo = (catalogo: PermisoDef[]) => {
  const m = new Map<string, PermisoDef[]>()
  for (const p of catalogo) m.set(p.grupo, [...(m.get(p.grupo) ?? []), p])
  return [...m.entries()]
}

// ── Permisos de un usuario: los de su rol, más los ajustes que el admin le haga ─────────────

type Ajuste = 'rol' | 'ajuste'

export function PermisosDeUsuario({ u, onToast, onGuardado }: { u: Usuario; onToast: (msg: string) => void; onGuardado: () => void }) {
  const [catalogo, setCatalogo] = useState<PermisoDef[] | null>(null)
  const [datos, setDatos] = useState<PermisosUsuario | null>(null)
  const [ajustes, setAjustes] = useState<Record<string, Ajuste>>({}) // codigo -> 'ajuste' si se invierte lo que dice el rol
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const cargar = () =>
    Promise.all([api.permisos(), api.permisosUsuario(u.id)])
      .then(([c, p]) => {
        setCatalogo(c.catalogo)
        setDatos(p)
        const a: Record<string, Ajuste> = {}
        for (const k of [...p.permitir, ...p.denegar]) a[k] = 'ajuste'
        setAjustes(a)
      })
      .catch((e) => setError(e.message))
  useEffect(() => {
    void cargar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [u.id, u.rol])

  const grupos = useMemo(() => (catalogo ? porGrupo(catalogo) : []), [catalogo])
  if (u.rol === 'admin')
    return <p className="rounded-xl bg-slate-50 px-3 py-3 text-sm text-slate-600"><Lock size={14} className="mr-1 inline" /> El administrador siempre tiene todos los permisos y no se puede restringir.</p>
  if (error) return <ErrorBox>{error}</ErrorBox>
  if (!catalogo || !datos) return <Esqueleto filas={6} columnas={3} />

  const delRol = new Set(datos.del_rol)
  const efectivo = (c: string) => (ajustes[c] === 'ajuste' ? !delRol.has(c) : delRol.has(c))

  const guardar = async () => {
    setBusy(true)
    setError('')
    const permitir = Object.keys(ajustes).filter((c) => ajustes[c] === 'ajuste' && !delRol.has(c))
    const denegar = Object.keys(ajustes).filter((c) => ajustes[c] === 'ajuste' && delRol.has(c))
    try {
      setDatos(await api.guardarPermisosUsuario(u.id, permitir, denegar))
      onToast('Permisos de la cuenta actualizados.')
      onGuardado()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const hayAjustes = Object.values(ajustes).some((v) => v === 'ajuste')

  return (
    <div className="space-y-4">
      <p className="rounded-xl bg-slate-50 px-3 py-2.5 text-xs text-slate-600">
        Esta cuenta tiene el rol <b>{ROL_LABEL[u.rol]}</b>: parte de los permisos de ese rol. Aquí puedes <b>darle un permiso extra</b> o <b>quitarle uno</b> solo a esta persona.
        Los permisos de cada rol se editan en «Roles y permisos».
      </p>
      {grupos.map(([grupo, lista]) => (
        <section key={grupo}>
          <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">{grupo}</h4>
          <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
            {lista.map((p) => {
              const cambiado = ajustes[p.codigo] === 'ajuste'
              return (
                <li key={p.codigo} className="flex items-center gap-3 px-3 py-2">
                  <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] ${efectivo(p.codigo) ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-400'}`} aria-hidden>
                    {efectivo(p.codigo) ? <Check size={12} strokeWidth={3} /> : '–'}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-slate-700">{p.etiqueta}</p>
                    {p.descripcion && <p className="text-[11px] text-slate-400">{p.descripcion}</p>}
                  </div>
                  <select
                    className="input-field w-44 py-1 text-xs"
                    value={cambiado ? 'ajuste' : 'rol'}
                    aria-label={`Permiso: ${p.etiqueta}`}
                    onChange={(e) => setAjustes({ ...ajustes, [p.codigo]: e.target.value as Ajuste })}
                  >
                    <option value="rol">Según su rol ({delRol.has(p.codigo) ? 'sí' : 'no'})</option>
                    <option value="ajuste">{delRol.has(p.codigo) ? 'Quitárselo' : 'Darle este permiso'}</option>
                  </select>
                </li>
              )
            })}
          </ul>
        </section>
      ))}
      <div className="flex items-center justify-between">
        <button onClick={() => setAjustes({})} disabled={busy || !hayAjustes} className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700 disabled:opacity-40">
          <RotateCcw size={13} /> Usar solo los permisos de su rol
        </button>
        <button onClick={guardar} disabled={busy} className="btn-primary text-sm"><Check size={14} /> {busy ? 'Guardando…' : 'Guardar permisos'}</button>
      </div>
      {error && <ErrorBox>{error}</ErrorBox>}
    </div>
  )
}

// ── Permisos de cada rol (matriz) ────────────────────────────────────────────────────────

export function RolesYPermisos({ onClose, onToast }: { onClose: () => void; onToast: (msg: string) => void }) {
  const [datos, setDatos] = useState<PermisosRoles | null>(null)
  const [sel, setSel] = useState<Record<string, Set<string>>>({})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const cargar = () =>
    api.permisos().then((d) => {
      setDatos(d)
      setSel(Object.fromEntries(Object.entries(d.roles).map(([r, l]) => [r, new Set(l)])))
    }).catch((e) => setError(e.message))
  useEffect(() => { void cargar() }, [])

  const grupos = useMemo(() => (datos ? porGrupo(datos.catalogo) : []), [datos])
  const alternar = (rol: string, c: string) =>
    setSel((s) => {
      const n = new Set(s[rol])
      if (n.has(c)) n.delete(c); else n.add(c)
      return { ...s, [rol]: n }
    })
  const cambiados = datos ? ROLES_EDITABLES.filter((r) => [...sel[r] ?? []].sort().join() !== [...datos.roles[r]].sort().join()) : []

  const guardar = async () => {
    setBusy(true)
    setError('')
    try {
      for (const r of cambiados) await api.guardarPermisosRol(r, [...sel[r]])
      onToast('Permisos de los roles guardados.')
      await cargar()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const restablecer = async (r: string) => {
    if (!window.confirm(`¿Volver a los permisos de fábrica del rol ${ROL_LABEL[r]}?`)) return
    setBusy(true)
    try {
      await api.restablecerPermisosRol(r)
      await cargar()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal titulo="Roles y permisos" onClose={onClose} ancho="max-w-3xl">
      <p className="-mt-2 mb-4 text-sm text-slate-500">
        Elige qué puede hacer cada rol con los paneles. Los cambios se aplican de inmediato a todas las cuentas de ese rol. El administrador siempre tiene todo.
      </p>
      {!datos && !error && <Esqueleto filas={8} columnas={4} />}
      {datos && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs text-slate-500">
                <th className="py-2 text-left font-medium">Permiso</th>
                <th className="w-24 py-2 text-center font-medium">Admin</th>
                {ROLES_EDITABLES.map((r) => (
                  <th key={r} className="w-28 py-2 text-center font-medium">
                    {ROL_LABEL[r]}
                    {datos.personalizados.includes(r) && (
                      <button onClick={() => restablecer(r)} disabled={busy} title="Volver a los permisos de fábrica" className="ml-1 text-slate-400 hover:text-slate-700"><RotateCcw size={11} className="inline" /></button>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grupos.map(([grupo, lista]) => (
                <Fragment key={grupo}>
                  <tr><td colSpan={6} className="pt-4 pb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{grupo}</td></tr>
                  {lista.map((p) => (
                    <tr key={p.codigo} className="border-b border-slate-50">
                      <td className="py-1.5 pr-3">
                        <p className="text-slate-700">{p.etiqueta}</p>
                        {p.descripcion && <p className="text-[11px] text-slate-400">{p.descripcion}</p>}
                      </td>
                      <td className="text-center text-emerald-600"><Check size={15} className="inline" strokeWidth={3} aria-label="siempre" /></td>
                      {ROLES_EDITABLES.map((r) => (
                        <td key={r} className="text-center">
                          <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={sel[r]?.has(p.codigo) ?? false} onChange={() => alternar(r, p.codigo)} aria-label={`${ROL_LABEL[r]}: ${p.etiqueta}`} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {error && <div className="mt-3"><ErrorBox>{error}</ErrorBox></div>}
      <div className="mt-5 flex items-center justify-end gap-3 border-t border-slate-100 pt-4">
        <button onClick={onClose} className="rounded-lg px-3 py-2 text-sm text-slate-500 hover:bg-slate-100">Cerrar</button>
        <button onClick={guardar} disabled={busy || cambiados.length === 0} className="btn-primary text-sm">
          <Check size={14} /> {busy ? 'Guardando…' : cambiados.length ? `Guardar (${cambiados.length} ${cambiados.length === 1 ? 'rol' : 'roles'})` : 'Guardar'}
        </button>
      </div>
    </Modal>
  )
}
