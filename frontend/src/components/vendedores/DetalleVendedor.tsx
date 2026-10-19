import { Check, FileText, History, Pencil, Plus, RefreshCw, Trash2, UserCheck, UserMinus } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { api } from '../../api'
import { fmt, finPorDefecto, hoyIso, sumarDias } from '../../format'
import type {
  Contrato, EstadoContratoFila, Regional, VendedorDetalle, VendedorEditable,
} from '../../types'
import { Avatar, ErrorBox, Modal, alEscribirMayus, labelCls, type ToastData } from '../ui'
import Documentos from './Documentos'

const ESTADO_CONTRATO: Record<EstadoContratoFila, { texto: string; clase: string }> = {
  vigente: { texto: 'Vigente', clase: 'badge-ok' },
  por_vencer: { texto: 'Por vencer', clase: 'badge-warn' },
  vencido: { texto: 'Vencido', clase: 'badge-bad' },
  anterior: { texto: 'Anterior', clase: 'badge-off' },
  futuro: { texto: 'Programado', clase: 'badge-info' },
  rescindido: { texto: 'Finalizado', clase: 'badge-off' },
}

const EVENTO: Record<string, string> = {
  alta: 'Alta',
  renovacion: 'Renovación de contrato',
  contrato_anterior: 'Contrato anterior registrado',
  contrato_editado: 'Contrato modificado',
  contrato_eliminado: 'Contrato eliminado',
  cambio_equipo: 'Cambio de equipo',
  baja: 'Baja',
}

// ── Contrato (renovar / agregar anterior / editar) ───────────────────────────

type ModoContrato = { tipo: 'renovar' } | { tipo: 'anterior' } | { tipo: 'editar'; contrato: Contrato }

function FormContrato({
  det, modo, onDone, onClose,
}: {
  det: VendedorDetalle
  modo: ModoContrato
  onDone: (d: VendedorDetalle, mensaje: string) => void
  onClose: () => void
}) {
  const ultimo = det.contratos[det.contratos.length - 1]
  const primero = det.contratos[0]
  const inicial = (() => {
    if (modo.tipo === 'editar') {
      const c = modo.contrato
      return { numero: String(c.numero), inicio: c.fecha_inicio, fin: c.fecha_fin, cap: String(c.dias_capacitacion), obs: c.observacion ?? '' }
    }
    if (modo.tipo === 'renovar') {
      const inicio = ultimo ? sumarDias(ultimo.fecha_fin, 1) : hoyIso()
      return { numero: String((ultimo?.numero ?? 0) + 1), inicio, fin: finPorDefecto(inicio), cap: '0', obs: '' }
    }
    return { numero: primero && primero.numero > 1 ? String(primero.numero - 1) : '', inicio: '', fin: '', cap: '0', obs: '' }
  })()
  const [f, setF] = useState(inicial)
  const [finManual, setFinManual] = useState(modo.tipo === 'editar')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const fin = finManual ? f.fin : f.inicio ? finPorDefecto(f.inicio) : ''

  const titulo =
    modo.tipo === 'renovar' ? 'Renovar contrato'
    : modo.tipo === 'anterior' ? 'Agregar contrato anterior'
    : `Editar contrato nº ${modo.contrato.numero}`

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setBusy(true)
    const datos = {
      numero: Number(f.numero) || undefined,
      fecha_inicio: f.inicio || undefined,
      fecha_fin: fin || undefined,
      dias_capacitacion: Number(f.cap),
      observacion: f.obs.trim() || undefined,
    }
    try {
      const r =
        modo.tipo === 'editar'
          ? await api.actualizarContrato(modo.contrato.id, datos)
          : await api.agregarContrato(det.id, datos)
      onDone(r, modo.tipo === 'editar' ? 'Contrato actualizado.' : modo.tipo === 'renovar' ? 'Contrato renovado.' : 'Contrato registrado.')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal titulo={titulo} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        {modo.tipo === 'renovar' && ultimo && (
          <p className="rounded-xl bg-blue-50 px-3 py-2.5 text-xs text-blue-700">
            El contrato nº {ultimo.numero} vence el {fmt(ultimo.fecha_fin)}. El nuevo empieza al día siguiente y dura 1 año;
            puedes ajustar las fechas.
          </p>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className={labelCls}>Nº de contrato</label>
            <input type="number" min={1} className="input-field" value={f.numero} onChange={(e) => setF({ ...f, numero: e.target.value })} required />
          </div>
          <div>
            <label className={labelCls}>Días de capacitación</label>
            <select className="input-field" value={f.cap} onChange={(e) => setF({ ...f, cap: e.target.value })}>
              {[0, 1, 2, 3].map((d) => <option key={d} value={d}>{d === 0 ? 'Sin capacitación' : d}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Inicio *</label>
            <input type="date" className="input-field" value={f.inicio} onChange={(e) => setF({ ...f, inicio: e.target.value })} required />
          </div>
          <div>
            <label className={labelCls}>Fin</label>
            <input
              type="date" className="input-field" value={fin} required
              onChange={(e) => { setF({ ...f, fin: e.target.value }); setFinManual(true) }}
            />
          </div>
        </div>
        <div>
          <label className={labelCls}>Observación</label>
          <input className="input-field mayus" value={f.obs} onChange={alEscribirMayus((v) => setF((x) => ({ ...x, obs: v })))} />
        </div>
        {error && <ErrorBox>{error}</ErrorBox>}
        <button disabled={busy} className="btn-primary w-full text-sm">
          <Check size={15} /> {busy ? 'Guardando…' : 'Guardar contrato'}
        </button>
      </form>
    </Modal>
  )
}

// ── Baja ─────────────────────────────────────────────────────────────────────

function FormBaja({
  det, onDone, onClose,
}: {
  det: VendedorDetalle
  onDone: (d: VendedorDetalle) => void
  onClose: () => void
}) {
  const [fecha, setFecha] = useState(hoyIso())
  const [motivos, setMotivos] = useState<string[]>([])
  const [motivo, setMotivo] = useState('')
  const [otro, setOtro] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api.motivosBaja().then(setMotivos).catch(() => setMotivos([]))
  }, [])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      onDone(await api.darDeBaja(det.id, fecha, motivo === 'OTRO' ? otro.trim() || 'OTRO' : motivo))
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal titulo={`Dar de baja a ${det.nombre}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className={labelCls}>Fecha de salida</label>
          <input type="date" className="input-field" value={fecha} onChange={(e) => setFecha(e.target.value)} required />
          <p className="mt-1 text-xs text-slate-400">Es el primer día que ya no trabaja: la asistencia se cuenta hasta el día anterior.</p>
        </div>
        <div>
          <label className={labelCls}>Motivo</label>
          <select className="input-field" value={motivo} onChange={(e) => setMotivo(e.target.value)}>
            <option value="">Sin especificar</option>
            {motivos.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        {motivo === 'OTRO' && (
          <input className="input-field mayus" placeholder="Describe el motivo" value={otro} onChange={alEscribirMayus(setOtro)} />
        )}
        {error && <ErrorBox>{error}</ErrorBox>}
        <button disabled={busy} className="btn-primary w-full bg-red-600 text-sm hover:bg-red-700 focus:ring-red-500">
          <UserMinus size={15} /> {busy ? 'Guardando…' : 'Confirmar baja'}
        </button>
      </form>
    </Modal>
  )
}

// ── Detalle ──────────────────────────────────────────────────────────────────

type Tab = 'datos' | 'contratos' | 'historial'

const MAYUS = new Set(['nombre', 'documento', 'cargo', 'area']) // se escriben en MAYÚSCULAS

export default function DetalleVendedor({
  id, estructura, puedeEscribir, tabInicial = 'contratos', onClose, onChanged, onToast,
}: {
  id: number
  estructura: Regional[]
  puedeEscribir: boolean
  tabInicial?: Tab
  onClose: () => void
  onChanged: () => void
  onToast: (t: ToastData) => void
}) {
  const [det, setDet] = useState<VendedorDetalle | null>(null)
  const [editando, setEditando] = useState(false) // los datos se ven en lectura; se editan solo a propósito
  const [tab, setTab] = useState<Tab>(tabInicial)
  const [datos, setDatos] = useState<Record<string, string>>({})
  const [modoContrato, setModoContrato] = useState<ModoContrato | null>(null)
  const [baja, setBaja] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const cargarDatos = (d: VendedorDetalle) =>
    setDatos({
      nombre: d.nombre, documento: d.documento ?? '', sexo: d.sexo ?? '', nacimiento: d.fecha_nacimiento ?? '',
      telCorp: d.telefono_corporativo ?? '', telPers: d.telefono_personal ?? '', cargo: d.cargo, area: d.area,
      equipoId: String(d.equipo_id), primerIngreso: d.fecha_primer_ingreso,
    })

  useEffect(() => {
    api.vendedor(id).then((d) => { setDet(d); cargarDatos(d) }).catch((e) => setError(e.message))
  }, [id])

  const aplicar = (d: VendedorDetalle, mensaje?: string) => {
    setDet(d)
    cargarDatos(d)
    onChanged()
    if (mensaje) onToast({ msg: mensaje, type: 'ok' })
  }

  const guardarDatos = async () => {
    if (!det) return
    setError('')
    setBusy(true)
    const cambios: VendedorEditable = {
      nombre: datos.nombre.trim(),
      documento: datos.documento.trim(),
      sexo: (datos.sexo as 'M' | 'F') || null,
      fecha_nacimiento: datos.nacimiento || null,
      telefono_corporativo: datos.telCorp.trim(),
      telefono_personal: datos.telPers.trim(),
      cargo: datos.cargo.trim(),
      area: datos.area.trim(),
      equipo_id: Number(datos.equipoId),
      fecha_primer_ingreso: datos.primerIngreso,
    }
    try {
      aplicar(await api.actualizarVendedor(det.id, cambios), 'Datos actualizados correctamente.')
      setEditando(false)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const eliminarContrato = async (c: Contrato) => {
    if (!window.confirm(`¿Eliminar el contrato nº ${c.numero}?`)) return
    setError('')
    try {
      aplicar(await api.eliminarContrato(c.id), 'Contrato eliminado.')
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const campo = (k: string, label: string, tipo = 'text') => (
    <div>
      <label className={labelCls}>{label}</label>
      <input
        type={tipo} className={`input-field ${MAYUS.has(k) ? 'mayus' : ''}`} value={datos[k] ?? ''} disabled={!puedeEscribir}
        onChange={(e) =>
          MAYUS.has(k)
            ? alEscribirMayus((v) => setDatos((d) => ({ ...d, [k]: v })))(e)
            : setDatos({ ...datos, [k]: e.target.value })
        }
      />
    </div>
  )

  const tabs = [
    { id: 'contratos', label: 'Contratos', icon: FileText },
    { id: 'datos', label: 'Datos', icon: UserCheck },
    { id: 'historial', label: 'Historial', icon: History },
  ] as const

  const titulo = det ? (
    <span className="flex items-center gap-3">
      <Avatar id={det.id} nombre={det.nombre} size="h-9 w-9 text-sm" />
      <span className="leading-tight">
        <span className="block">{det.nombre}</span>
        <span className="block text-xs font-normal text-slate-400">
          Cód. {det.codigo_vendedor} · {det.equipo_nombre}
          {!det.vigente && ` · Retirado el ${fmt(det.fecha_baja)}`}
        </span>
      </span>
    </span>
  ) : 'Cargando…'

  return (
    <>
    <Modal titulo={titulo} onClose={onClose} ancho="max-w-2xl">
      {!det && !error && <p className="py-10 text-center text-sm text-slate-400">Cargando…</p>}
      {det && (
        <>
          <div className="-mt-1 mb-5 flex border-b border-slate-100">
            {tabs.map(({ id: t, label, icon: Icon }) => (
              <button
                key={t} onClick={() => { setTab(t); setError(''); setEditando(false) }}
                className={`-mb-px flex items-center gap-1.5 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
                  tab === t ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-500 hover:text-slate-700'
                }`}
              >
                <Icon size={14} /> {label}
              </button>
            ))}
          </div>

          {tab === 'contratos' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm text-slate-500">
                  {det.total_contratos} {det.total_contratos === 1 ? 'contrato' : 'contratos'} · ingresó el {fmt(det.fecha_primer_ingreso)}
                </p>
                {puedeEscribir && det.vigente && (
                  <button onClick={() => setModoContrato({ tipo: 'renovar' })} className="btn-primary text-sm">
                    <RefreshCw size={14} /> Renovar contrato
                  </button>
                )}
              </div>

              {[...det.contratos].reverse().map((c) => {
                const e = ESTADO_CONTRATO[c.estado]
                return (
                  <div key={c.id} className="rounded-xl border border-slate-200 p-4">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">Contrato nº {c.numero}</span>
                      <span className={e.clase}>{e.texto}</span>
                      {(c.estado === 'vigente' || c.estado === 'por_vencer') && (
                        <span className="text-xs text-slate-400">
                          {c.dias_para_vencer === 0 ? 'vence hoy' : `vence en ${c.dias_para_vencer} días`}
                        </span>
                      )}
                      {c.estado === 'vencido' && <span className="text-xs text-red-500">venció hace {-c.dias_para_vencer} días</span>}
                      {puedeEscribir && (
                        <span className="ml-auto flex gap-1">
                          <button className="icon-btn" title="Editar contrato" onClick={() => setModoContrato({ tipo: 'editar', contrato: c })}>
                            <Pencil size={14} />
                          </button>
                          {det.contratos.length > 1 && (
                            <button className="icon-btn hover:text-red-600!" title="Eliminar contrato" onClick={() => eliminarContrato(c)}>
                              <Trash2 size={14} />
                            </button>
                          )}
                        </span>
                      )}
                    </div>
                    <p className="mt-1.5 text-sm tabular-nums text-slate-600">
                      {fmt(c.fecha_inicio)} → {fmt(c.fecha_fin)}
                      {c.dias_capacitacion > 0 && (
                        <span className="ml-2 text-xs text-slate-400">
                          · {c.dias_capacitacion} {c.dias_capacitacion === 1 ? 'día' : 'días'} de capacitación (ventas desde el {fmt(c.fecha_inicio_ventas)})
                        </span>
                      )}
                    </p>
                    {c.observacion && <p className="mt-1 text-xs text-slate-400">{c.observacion}</p>}
                  </div>
                )
              })}

              {puedeEscribir && <Documentos vendedorId={det.id} nombre={det.nombre} />}

              {puedeEscribir && det.vigente && (
                <button onClick={() => setModoContrato({ tipo: 'anterior' })} className="flex items-center gap-1.5 text-sm text-brand-600 hover:text-brand-700">
                  <Plus size={14} /> Agregar un contrato anterior
                </button>
              )}
            </div>
          )}

          {tab === 'datos' && !editando && (
            <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
              {([
                ['Nombre completo', det.nombre],
                ['Código de vendedor', det.codigo_vendedor],
                ['Carnet de identidad', det.documento],
                ['Sexo', det.sexo === 'F' ? 'FEMENINO' : det.sexo === 'M' ? 'MASCULINO' : null],
                ['Fecha de nacimiento', det.fecha_nacimiento ? fmt(det.fecha_nacimiento) : null],
                ['Primer ingreso a la empresa', fmt(det.fecha_primer_ingreso)],
                ['Teléfono corporativo', det.telefono_corporativo],
                ['Teléfono personal', det.telefono_personal],
                ['Cargo', det.cargo],
                ['Área', det.area],
                ['Zona', det.regional],
                ['Equipo DTS', det.equipo_nombre],
              ] as [string, string | null][]).map(([etiqueta, valor]) => (
                <div key={etiqueta} className="border-b border-slate-100 pb-2">
                  <dt className="text-xs text-slate-400">{etiqueta}</dt>
                  <dd className="mt-0.5 text-sm font-medium text-slate-800">{valor || '—'}</dd>
                </div>
              ))}
              {det.motivo_baja && (
                <div className="border-b border-slate-100 pb-2 sm:col-span-2">
                  <dt className="text-xs text-slate-400">Motivo de la baja ({fmt(det.fecha_baja)})</dt>
                  <dd className="mt-0.5 text-sm font-medium text-slate-800">{det.motivo_baja}</dd>
                </div>
              )}
            </dl>
          )}

          {tab === 'datos' && editando && (
            <div className="space-y-4">
              {campo('nombre', 'Nombre completo')}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {campo('documento', 'Carnet de identidad')}
                <div>
                  <label className={labelCls}>Sexo</label>
                  <select className="input-field" value={datos.sexo ?? ''} disabled={!puedeEscribir} onChange={(e) => setDatos({ ...datos, sexo: e.target.value })}>
                    <option value="">—</option>
                    <option value="F">Femenino</option>
                    <option value="M">Masculino</option>
                  </select>
                </div>
                {campo('nacimiento', 'Fecha de nacimiento', 'date')}
                {campo('primerIngreso', 'Primer ingreso a la empresa', 'date')}
                {campo('telCorp', 'Teléfono corporativo')}
                {campo('telPers', 'Teléfono personal')}
                {campo('cargo', 'Cargo')}
                {campo('area', 'Área')}
              </div>
              <div>
                <label className={labelCls}>Equipo DTS</label>
                <select className="input-field" value={datos.equipoId ?? ''} disabled={!puedeEscribir} onChange={(e) => setDatos({ ...datos, equipoId: e.target.value })}>
                  {estructura.map((r) => (
                    <optgroup key={r.id} label={r.nombre}>
                      {r.equipos.map((eq) => <option key={eq.id} value={eq.id}>{eq.nombre}</option>)}
                    </optgroup>
                  ))}
                </select>
              </div>
              {det.motivo_baja && (
                <p className="rounded-xl bg-slate-50 px-3 py-2.5 text-sm text-slate-600">
                  Motivo de la baja: <span className="font-medium">{det.motivo_baja}</span>
                </p>
              )}
            </div>
          )}

          {tab === 'historial' && (
            <ul className="space-y-2">
              {det.historial.length === 0 && <li className="py-6 text-center text-sm text-slate-400">Sin movimientos</li>}
              {det.historial.map((h) => (
                <li key={h.id} className="flex items-start gap-3 rounded-xl border border-slate-100 px-4 py-3 text-sm">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-400" />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{EVENTO[h.evento] ?? h.evento}</p>
                    {h.detalle && <p className="text-xs text-slate-500">{h.detalle}</p>}
                  </div>
                  <div className="shrink-0 text-right text-xs text-slate-400">
                    <p>{fmt(h.fecha)}</p>
                    {h.usuario && <p>{h.usuario}</p>}
                  </div>
                </li>
              ))}
            </ul>
          )}

          {error && <div className="mt-4"><ErrorBox>{error}</ErrorBox></div>}

          <div className="mt-6 flex items-center gap-3 border-t border-slate-100 pt-4">
            {puedeEscribir && det.vigente && (
              <button onClick={() => setBaja(true)} className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-red-500 transition-colors hover:bg-red-50 hover:text-red-700">
                <UserMinus size={14} /> Dar de baja
              </button>
            )}
            <div className="ml-auto flex items-center gap-3">
              <button onClick={onClose} className="rounded-lg px-3 py-2 text-sm text-slate-500 hover:bg-slate-100 hover:text-slate-700">Cerrar</button>
              {tab === 'datos' && puedeEscribir && !editando && det.vigente && (
                <button onClick={() => { cargarDatos(det); setError(''); setEditando(true) }} className="btn-primary text-sm"><Pencil size={14} /> Editar datos</button>
              )}
              {tab === 'datos' && editando && (
                <>
                  <button onClick={() => { cargarDatos(det); setError(''); setEditando(false) }} className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50">Cancelar</button>
                  <button onClick={guardarDatos} disabled={busy} className="btn-primary text-sm"><Check size={14} /> Guardar cambios</button>
                </>
              )}
            </div>
          </div>
        </>
      )}
    </Modal>
    {modoContrato && det && (
      <FormContrato
        det={det} modo={modoContrato} onClose={() => setModoContrato(null)}
        onDone={(d, m) => { setModoContrato(null); aplicar(d, m) }}
      />
    )}
    {baja && det && (
      <FormBaja
        det={det} onClose={() => setBaja(false)}
        onDone={(d) => { setBaja(false); aplicar(d, `${d.nombre} fue dado de baja.`) }}
      />
    )}
    </>
  )
}
