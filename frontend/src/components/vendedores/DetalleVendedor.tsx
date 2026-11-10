import { Check, FileText, FolderOpen, History, Pencil, Plus, RefreshCw, Trash2, UserCheck, UserMinus } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { api } from '../../api'
import { useAuth } from '../../auth'
import { fmt, finPorDefecto, hoyIso, sumarDias } from '../../format'
import type {
  Contrato, DocCategoria, EstadoContratoFila, Regional, VendedorDetalle, VendedorEditable,
} from '../../types'
import { Avatar, ErrorBox, Modal, alEscribirMayus, labelCls, type ToastData } from '../ui'
import Documentos from './Documentos'

const ESTADO_CONTRATO: Record<EstadoContratoFila, { texto: string; clase: string }> = {
  vigente: { texto: 'Vigente', clase: 'badge-ok' },
  por_vencer: { texto: 'Por vencer', clase: 'badge-warn' },
  vencido: { texto: 'Vencido', clase: 'badge-bad' },
  anterior: { texto: 'Anterior', clase: 'badge-off' },
  futuro: { texto: 'Programado', clase: 'badge-info' },
  anticipado: { texto: 'Finalizado anticipadamente', clase: 'badge-warn' },
  finalizado: { texto: 'Finalizado', clase: 'badge-off' },
}

const EVENTO: Record<string, string> = {
  alta: 'Alta',
  renovacion: 'Renovación de contrato',
  contrato_anterior: 'Contrato anterior registrado',
  contrato_editado: 'Contrato modificado',
  contrato_eliminado: 'Contrato eliminado',
  cambio_equipo: 'Cambio de equipo',
  baja: 'Baja',
  reingreso: 'Reingreso (nuevo ingreso)',
  reactivacion: 'Baja anulada',
  baja_corregida: 'Baja corregida',
  cambio_codigo: 'Cambio de código',
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
  // Fin por defecto: 1 año; pero un contrato anterior termina el día antes de que empiece el siguiente.
  const finAuto = (() => {
    if (!f.inicio) return ''
    const base = finPorDefecto(f.inicio)
    const sig = det.contratos.map((c) => c.fecha_inicio).filter((d) => d > f.inicio).sort()[0]
    return sig && base >= sig ? sumarDias(sig, -1) : base
  })()
  const fin = finManual ? f.fin : finAuto
  // «Finalizado anticipadamente»: el vendedor se retiró antes de la fecha en que debía terminar el contrato.
  // Se sugiere solo cuando el contrato anterior quedó cortado por el que le sigue; también se puede marcar a mano.
  const prevista = (modo.tipo === 'editar' && modo.contrato.fecha_fin_prevista) || (f.inicio ? finPorDefecto(f.inicio) : '')
  const [motivos, setMotivos] = useState<string[]>([])
  const motivoInicial = modo.tipo === 'editar' ? modo.contrato.motivo_fin ?? '' : ''
  const [motivo, setMotivo] = useState(motivoInicial && motivos.includes(motivoInicial) ? motivoInicial : motivoInicial ? 'OTRO' : '')
  const [otro, setOtro] = useState(motivoInicial)
  useEffect(() => {
    api.motivosBaja().then(setMotivos).catch(() => setMotivos([]))
  }, [])
  const [anticManual, setAnticManual] = useState<boolean | null>(modo.tipo === 'editar' ? !!modo.contrato.fecha_fin_prevista : null)
  const anticipado = anticManual ?? (modo.tipo !== 'editar' && !finManual && !!f.inicio && fin < prevista)
  const anticValido = anticipado && !!prevista && !!fin && fin < prevista
  // El número lo da la fecha: va después del contrato que empezó antes; los que ocupan ese lugar se corren uno.
  const previos = det.contratos.filter((c) => f.inicio && c.fecha_inicio < f.inicio)
  const numeroAuto = previos.length ? Math.max(...previos.map((c) => c.numero)) + 1 : 1
  const renumeran = det.contratos.filter((c) => c.numero >= numeroAuto)

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
      fecha_fin_prevista: anticValido ? prevista : modo.tipo === 'editar' ? null : undefined,
      motivo_fin: anticValido ? (motivo === 'OTRO' ? otro.trim() || 'OTRO' : motivo) || undefined : undefined,
    }
    if (anticipado && !anticValido) {
      setError(`Si terminó antes de tiempo, el último día trabajado debe ser anterior al ${fmt(prevista)}.`)
      setBusy(false)
      return
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
          {modo.tipo === 'editar' && (
            <div>
              <label className={labelCls}>Nº de contrato</label>
              <input type="number" min={1} className="input-field" value={f.numero} onChange={(e) => setF({ ...f, numero: e.target.value })} required />
            </div>
          )}
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
            <label className={labelCls}>{anticipado ? 'Último día trabajado' : 'Fin'}</label>
            <input
              type="date" className="input-field" value={fin} required
              onChange={(e) => { setF({ ...f, fin: e.target.value }); setFinManual(true) }}
            />
          </div>
        </div>
        {modo.tipo !== 'renovar' && (
          <div className="rounded-xl border border-slate-200 px-3 py-2.5">
            <label className="flex cursor-pointer items-start gap-2 text-sm text-slate-700">
              <input
                type="checkbox" className="mt-0.5" checked={anticipado}
                onChange={(e) => {
                  setAnticManual(e.target.checked)
                  if (e.target.checked && !finManual) { setF({ ...f, fin: finAuto }); setFinManual(true) }
                }}
              />
              <span>
                Terminó antes de tiempo (finalizado anticipadamente)
                <span className="block text-xs text-slate-500">
                  {anticipado
                    ? <>Debía durar hasta el <b>{prevista ? fmt(prevista) : '—'}</b>; en «Fin» pon el último día que trabajó.</>
                    : 'Márcalo si el vendedor se retiró antes de cumplir el año de este contrato.'}
                </span>
              </span>
            </label>
            {anticipado && (
              <div className="mt-3 space-y-2">
                <label className={labelCls}>Motivo</label>
                <select className="input-field" value={motivo} onChange={(e) => setMotivo(e.target.value)}>
                  <option value="">Sin especificar</option>
                  {motivos.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
                {motivo === 'OTRO' && (
                  <input className="input-field mayus" placeholder="Describe el motivo" value={otro} onChange={alEscribirMayus(setOtro)} />
                )}
              </div>
            )}
          </div>
        )}
        <div>
          <label className={labelCls}>Observación</label>
          <input className="input-field mayus" value={f.obs} onChange={alEscribirMayus((v) => setF((x) => ({ ...x, obs: v })))} />
        </div>
        {modo.tipo !== 'editar' && f.inicio && (
          <p className="rounded-xl bg-slate-50 px-3 py-2.5 text-xs text-slate-600">
            Quedará como <b>contrato nº {numeroAuto}</b>, según su fecha de inicio.
            {renumeran.length > 0 && <> Los contratos {renumeran.map((c) => `nº ${c.numero}`).join(', ')} pasarán a ser {renumeran.map((c) => `nº ${c.numero + 1}`).join(', ')}, y sus PDF ya subidos se renombran.</>}
          </p>
        )}
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
  det, onDone, onClose, corregir = false,
}: {
  det: VendedorDetalle
  onDone: (d: VendedorDetalle) => void
  onClose: () => void
  corregir?: boolean // corregir la fecha/motivo de una baja ya registrada
}) {
  const [fecha, setFecha] = useState(corregir && det.fecha_baja ? det.fecha_baja : hoyIso())
  const [motivos, setMotivos] = useState<string[]>([])
  const [motivo, setMotivo] = useState(corregir ? det.motivo_baja ?? '' : '')
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
      const m = motivo === 'OTRO' ? otro.trim() || 'OTRO' : motivo
      onDone(await (corregir ? api.corregirBaja : api.darDeBaja)(det.id, fecha, m))
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal titulo={corregir ? `Corregir la baja de ${det.nombre}` : `Dar de baja a ${det.nombre}`} onClose={onClose}>
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
            {motivo && motivo !== 'OTRO' && !motivos.includes(motivo) && <option value={motivo}>{motivo}</option>}
            {motivos.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        {motivo === 'OTRO' && (
          <input className="input-field mayus" placeholder="Describe el motivo" value={otro} onChange={alEscribirMayus(setOtro)} />
        )}
        {error && <ErrorBox>{error}</ErrorBox>}
        <button disabled={busy} className="btn-primary w-full bg-red-600 text-sm hover:bg-red-700 focus:ring-red-500">
          <UserMinus size={15} /> {busy ? 'Guardando…' : corregir ? 'Guardar corrección' : 'Confirmar baja'}
        </button>
      </form>
    </Modal>
  )
}

function FormReingreso({ det, estructura, onClose, onDone }: { det: VendedorDetalle; estructura: Regional[]; onClose: () => void; onDone: (d: VendedorDetalle) => void }) {
  const [fecha, setFecha] = useState(hoyIso())
  const [equipo, setEquipo] = useState(String(det.equipo_id))
  const [cap, setCap] = useState('0')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const siguiente = (det.contratos[det.contratos.length - 1]?.numero ?? 0) + 1
  const dias = det.fecha_baja && fecha ? Math.round((new Date(fecha).getTime() - new Date(det.fecha_baja).getTime()) / 86400000) : null

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      onDone(await api.reingreso(det.id, { fecha_ingreso: fecha, equipo_id: Number(equipo) !== det.equipo_id ? Number(equipo) : undefined, dias_capacitacion: Number(cap) }))
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal titulo={`Reingreso de ${det.nombre}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <p className="rounded-xl bg-blue-50 px-3 py-2.5 text-sm text-blue-800">
          Se retiró el {fmt(det.fecha_baja)}{det.motivo_baja ? ` (${det.motivo_baja})` : ''}. Al volver cuenta como <b>nuevo ingreso</b> y recibe el <b>contrato nº {siguiente}</b>.
          El contrato anterior queda como «finalizado anticipadamente».
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className={labelCls}>Fecha de reingreso *</label>
            <input type="date" className="input-field" value={fecha} min={det.fecha_baja ? sumarDias(det.fecha_baja, 1) : undefined} onChange={(e) => setFecha(e.target.value)} required />
          </div>
          <div>
            <label className={labelCls}>Días de capacitación</label>
            <select className="input-field" value={cap} onChange={(e) => setCap(e.target.value)}>
              {[0, 1, 2, 3].map((d) => <option key={d} value={d}>{d === 0 ? 'Sin capacitación' : d}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className={labelCls}>Equipo DTS</label>
          <select className="input-field" value={equipo} onChange={(e) => setEquipo(e.target.value)}>
            {estructura.map((r) => (
              <optgroup key={r.id} label={r.nombre}>
                {r.equipos.map((eq) => <option key={eq.id} value={eq.id}>{eq.nombre}</option>)}
              </optgroup>
            ))}
          </select>
        </div>
        {dias !== null && dias <= 3 && (
          <p className="rounded-xl bg-amber-50 px-3 py-2.5 text-xs text-amber-800">
            Pasaron solo {dias} {dias === 1 ? 'día' : 'días'} desde la baja. Si la baja fue un error, un administrador puede usar «Anular la baja» y el vendedor sigue con el mismo contrato.
          </p>
        )}
        {error && <ErrorBox>{error}</ErrorBox>}
        <button disabled={busy} className="btn-primary w-full text-sm">
          <UserCheck size={15} /> {busy ? 'Guardando…' : 'Registrar reingreso'}
        </button>
      </form>
    </Modal>
  )
}

function FormReactivar({ det, onClose, onDone }: { det: VendedorDetalle; onClose: () => void; onDone: (d: VendedorDetalle) => void }) {
  const [nota, setNota] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      onDone(await api.anularBaja(det.id, nota.trim()))
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal titulo={`Anular la baja de ${det.nombre}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <p className="rounded-xl bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
          Estaba dado de baja el {fmt(det.fecha_baja)}{det.motivo_baja ? ` por «${det.motivo_baja}»` : ''}. Al anularla se borran la fecha y el motivo de la baja y vuelve a figurar vigente, con su contrato.
          Los contratos no se modifican: si el actual ya venció, seguirá figurando vencido hasta renovarlo.
        </p>
        <div>
          <label className={labelCls}>Nota (opcional)</label>
          <input className="input-field mayus" placeholder="Por qué se anula, p. ej. SE PRESENTÓ A TRABAJAR" value={nota} onChange={alEscribirMayus(setNota)} maxLength={150} />
          <p className="mt-1 text-xs text-slate-400">Queda guardada en su historial junto con tu usuario y la fecha de hoy.</p>
        </div>
        {error && <ErrorBox>{error}</ErrorBox>}
        <button disabled={busy} className="btn-primary w-full text-sm">
          <UserCheck size={15} /> {busy ? 'Guardando…' : 'Anular la baja y reactivar'}
        </button>
      </form>
    </Modal>
  )
}

// ── Detalle ──────────────────────────────────────────────────────────────────

type Tab = 'datos' | 'contratos' | 'documentos' | 'historial'

const MAYUS = new Set(['nombre', 'codigo', 'documento', 'cargo', 'area']) // se escriben en MAYÚSCULAS

export default function DetalleVendedor({
  id, estructura, tabInicial = 'contratos', onClose, onChanged, onToast,
}: {
  id: number
  estructura: Regional[]
  tabInicial?: Tab
  onClose: () => void
  onChanged: () => void
  onToast: (t: ToastData) => void
}) {
  const { puede, user } = useAuth()
  const puedeEditar = puede('vendedores.editar')
  const puedeContratos = puede('contratos.gestionar')
  const [det, setDet] = useState<VendedorDetalle | null>(null)
  const [categorias, setCategorias] = useState<DocCategoria[]>([])
  const [editando, setEditando] = useState(false) // los datos se ven en lectura; se editan solo a propósito
  const [tab, setTab] = useState<Tab>(tabInicial)
  const [datos, setDatos] = useState<Record<string, string>>({})
  const [modoContrato, setModoContrato] = useState<ModoContrato | null>(null)
  const [baja, setBaja] = useState(false)
  const [corregirBaja, setCorregirBaja] = useState(false)
  const [reactivar, setReactivar] = useState(false)
  const [reingreso, setReingreso] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const cargarDatos = (d: VendedorDetalle) =>
    setDatos({
      nombre: d.nombre, codigo: d.codigo_vendedor, documento: d.documento ?? '', sexo: d.sexo ?? '', nacimiento: d.fecha_nacimiento ?? '',
      telCorp: d.telefono_corporativo ?? '', telPers: d.telefono_personal ?? '', cargo: d.cargo, area: d.area,
      equipoId: String(d.equipo_id), primerIngreso: d.fecha_primer_ingreso,
    })

  useEffect(() => {
    if (puede('documentos.ver')) api.docCategorias().then(setCategorias).catch(() => setCategorias([]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
      codigo_vendedor: datos.codigo.trim(),
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
        type={tipo} className={`input-field ${MAYUS.has(k) ? 'mayus' : ''}`} value={datos[k] ?? ''} disabled={!puedeEditar}
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
    ...(puede('documentos.ver') ? [{ id: 'documentos', label: 'Documentación', icon: FolderOpen }] : []),
    { id: 'datos', label: 'Datos', icon: UserCheck },
    { id: 'historial', label: 'Historial', icon: History },
  ] as { id: Tab; label: string; icon: typeof FileText }[]

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
                {puedeContratos && det.vigente && (
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
                      {c.estado === 'anticipado' && <span className="text-xs text-slate-400">{c.fecha_fin_prevista ? `debía durar hasta el ${fmt(c.fecha_fin_prevista)}${c.motivo_fin ? ` · motivo: ${c.motivo_fin}` : ''}` : `la baja fue el ${fmt(det.fecha_baja)}`}</span>}
                      {c.estado === 'vencido' && <span className="text-xs text-red-500">venció hace {-c.dias_para_vencer} días</span>}
                      {puedeContratos && (
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

              {puede('documentos.ver') && <Documentos vendedorId={det.id} nombre={det.nombre} />}

              {puedeContratos && det.vigente && (
                <button onClick={() => setModoContrato({ tipo: 'anterior' })} className="flex items-center gap-1.5 text-sm text-brand-600 hover:text-brand-700">
                  <Plus size={14} /> Agregar un contrato anterior
                </button>
              )}
            </div>
          )}

          {tab === 'documentos' && (
            <div className="space-y-3">
              <p className="text-sm text-slate-500">
                Documentos de {det.nombre.split(' ')[0]} en su carpeta de la unidad compartida. Todos en PDF. Para ver qué falta de todos los vendedores usa el panel «Documentación».
              </p>
              {categorias.filter((c) => c.clave !== 'contratos').map((c) => (
                <Documentos key={c.clave} vendedorId={det.id} nombre={det.nombre} categoria={c.clave} titulo={c.titulo} extensiones={c.extensiones} />
              ))}
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
                {campo('codigo', 'Código de vendedor (el del BI)')}
                {campo('documento', 'Carnet de identidad')}
                <div>
                  <label className={labelCls}>Sexo</label>
                  <select className="input-field" value={datos.sexo ?? ''} disabled={!puedeEditar} onChange={(e) => setDatos({ ...datos, sexo: e.target.value })}>
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
                <select className="input-field" value={datos.equipoId ?? ''} disabled={!puedeEditar} onChange={(e) => setDatos({ ...datos, equipoId: e.target.value })}>
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
            {puede('vendedores.baja') && det.vigente && (
              <button onClick={() => setBaja(true)} className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-red-500 transition-colors hover:bg-red-50 hover:text-red-700">
                <UserMinus size={14} /> Dar de baja
              </button>
            )}
            {puede('contratos.gestionar') && !det.vigente && (
              <button onClick={() => setReingreso(true)} className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-brand-600 transition-colors hover:bg-brand-50 hover:text-brand-700">
                <Plus size={14} /> Reingreso
              </button>
            )}
            {puede('vendedores.baja') && !det.vigente && (
              <button onClick={() => setCorregirBaja(true)} className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-800">
                <Pencil size={14} /> Corregir baja
              </button>
            )}
            {user?.rol === 'admin' && !det.vigente && (
              <button onClick={() => setReactivar(true)} className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-emerald-600 transition-colors hover:bg-emerald-50 hover:text-emerald-700">
                <UserCheck size={14} /> Anular la baja
              </button>
            )}
            <div className="ml-auto flex items-center gap-3">
              <button onClick={onClose} className="rounded-lg px-3 py-2 text-sm text-slate-500 hover:bg-slate-100 hover:text-slate-700">Cerrar</button>
              {tab === 'datos' && puedeEditar && !editando && det.vigente && (
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
    {reingreso && det && (
      <FormReingreso
        det={det} estructura={estructura} onClose={() => setReingreso(false)}
        onDone={(d) => { setReingreso(false); aplicar(d, `${d.nombre} reingresó: contrato nº ${d.contratos[d.contratos.length - 1]?.numero}.`) }}
      />
    )}
    {reactivar && det && (
      <FormReactivar
        det={det} onClose={() => setReactivar(false)}
        onDone={(d) => { setReactivar(false); aplicar(d, `Se anuló la baja de ${d.nombre}: vuelve a figurar vigente.`) }}
      />
    )}
    {corregirBaja && det && (
      <FormBaja
        corregir det={det} onClose={() => setCorregirBaja(false)}
        onDone={(d) => { setCorregirBaja(false); aplicar(d, `Baja de ${d.nombre} corregida al ${fmt(d.fecha_baja)}.`) }}
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
