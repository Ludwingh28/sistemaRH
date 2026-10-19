import { FileText, Plus, X } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { api } from '../../api'
import { finPorDefecto, hoyIso } from '../../format'
import type { Regional, VendedorDetalle } from '../../types'
import { ErrorBox, Modal, alEscribirMayus, labelCls } from '../ui'
import { motivoRechazo } from './Documentos'
import ZonaSuelta from './ZonaSuelta'

export default function FormAlta({
  estructura,
  onDone,
  onClose,
}: {
  estructura: Regional[]
  onDone: (v: VendedorDetalle, info: { subidos: number; aviso?: string }) => void
  onClose: () => void
}) {
  const [f, setF] = useState({
    codigo: '', documento: '', nombre: '', sexo: '', nacimiento: '',
    telCorp: '', telPers: '', cargo: 'ASESOR COMERCIAL', area: 'VENTAS', equipoId: '',
    numero: '1', inicio: hoyIso(), fin: '', finManual: false, capacitacion: '0', primerIngreso: '',
  })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [contratos, setContratos] = useState<File[]>([]) // PDF del contrato firmado, opcional
  const [avisoArchivos, setAvisoArchivos] = useState('')
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }))

  const finMostrado = f.finManual ? f.fin : f.inicio ? finPorDefecto(f.inicio) : ''
  const esPrimero = f.numero === '1' || f.numero === ''

  const agregar = (nuevos: File[]) => {
    const problemas: string[] = []
    const lista = [...contratos]
    for (const f of nuevos) {
      const motivo = motivoRechazo(f)
      if (motivo) problemas.push(motivo)
      else if (!lista.some((x) => x.name === f.name && x.size === f.size)) lista.push(f)
    }
    setContratos(lista)
    setAvisoArchivos(problemas.join('\n'))
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      const creado = await api.crearVendedor({
          codigo_vendedor: f.codigo.trim(),
          documento: f.documento.trim() || undefined,
          nombre: f.nombre.trim(),
          sexo: (f.sexo as 'M' | 'F') || undefined,
          fecha_nacimiento: f.nacimiento || undefined,
          telefono_corporativo: f.telCorp.trim() || undefined,
          telefono_personal: f.telPers.trim() || undefined,
          cargo: f.cargo.trim() || undefined,
          area: f.area.trim() || undefined,
          equipo_id: Number(f.equipoId),
          fecha_primer_ingreso: !esPrimero && f.primerIngreso ? f.primerIngreso : undefined,
          contrato: {
            numero: Number(f.numero) || 1,
            fecha_inicio: f.inicio,
            fecha_fin: finMostrado || undefined,
            dias_capacitacion: Number(f.capacitacion),
          },
        })
      // El vendedor ya existe y su carpeta de contratos también: se suben los archivos que se soltaron.
      let subidos = 0
      const fallos: string[] = []
      for (const pdf of contratos) {
        try {
          await api.subirDocumento(creado.id, pdf)
          subidos += 1
        } catch (err) {
          fallos.push(`«${pdf.name}»: ${(err as Error).message}`)
        }
      }
      onDone(creado, { subidos, aviso: fallos.length ? `Se registró el vendedor, pero no se pudo subir: ${fallos.join('; ')}. Súbelo desde su ficha.` : undefined })
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal titulo="Nuevo vendedor" onClose={onClose} ancho="max-w-2xl">
      <form onSubmit={submit} className="space-y-5">
        <section className="space-y-4">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Datos del colaborador</h4>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className={labelCls}>Código de vendedor (ERP) *</label>
              <input className="input-field mayus" value={f.codigo} onChange={alEscribirMayus((v) => set('codigo', v))} required autoFocus />
            </div>
            <div>
              <label className={labelCls}>Carnet de identidad</label>
              <input className="input-field mayus" value={f.documento} onChange={alEscribirMayus((v) => set('documento', v))} />
            </div>
          </div>
          <div>
            <label className={labelCls}>Nombre completo *</label>
            <input className="input-field mayus" value={f.nombre} onChange={alEscribirMayus((v) => set('nombre', v))} required />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className={labelCls}>Sexo</label>
              <select className="input-field" value={f.sexo} onChange={(e) => set('sexo', e.target.value)}>
                <option value="">—</option>
                <option value="F">Femenino</option>
                <option value="M">Masculino</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>Fecha de nacimiento</label>
              <input type="date" className="input-field" value={f.nacimiento} onChange={(e) => set('nacimiento', e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Equipo DTS *</label>
              <select className="input-field" value={f.equipoId} onChange={(e) => set('equipoId', e.target.value)} required>
                <option value="">Seleccionar…</option>
                {estructura.map((r) => (
                  <optgroup key={r.id} label={r.nombre}>
                    {r.equipos.map((eq) => <option key={eq.id} value={eq.id}>{eq.nombre}</option>)}
                  </optgroup>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className={labelCls}>Teléfono corporativo</label>
              <input className="input-field" value={f.telCorp} onChange={(e) => set('telCorp', e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Teléfono personal</label>
              <input className="input-field" value={f.telPers} onChange={(e) => set('telPers', e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Cargo</label>
              <input className="input-field mayus" value={f.cargo} onChange={alEscribirMayus((v) => set('cargo', v))} />
            </div>
            <div>
              <label className={labelCls}>Área</label>
              <input className="input-field mayus" value={f.area} onChange={alEscribirMayus((v) => set('area', v))} />
            </div>
          </div>
        </section>

        <section className="space-y-4 border-t border-slate-100 pt-5">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Contrato</h4>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <label className={labelCls}>Nº de contrato</label>
              <input type="number" min={1} className="input-field" value={f.numero} onChange={(e) => set('numero', e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Inicio *</label>
              <input type="date" className="input-field" value={f.inicio} onChange={(e) => set('inicio', e.target.value)} required />
            </div>
            <div>
              <label className={labelCls}>Fin (1 año)</label>
              <input
                type="date" className="input-field" value={finMostrado}
                onChange={(e) => setF((x) => ({ ...x, fin: e.target.value, finManual: true }))}
              />
            </div>
            <div>
              <label className={labelCls}>Días de capacitación</label>
              <select className="input-field" value={f.capacitacion} onChange={(e) => set('capacitacion', e.target.value)}>
                {[0, 1, 2, 3].map((d) => <option key={d} value={d}>{d === 0 ? 'Sin capacitación' : d}</option>)}
              </select>
            </div>
          </div>
          {!esPrimero && (
            <div>
              <label className={labelCls}>Primer ingreso a la empresa</label>
              <input type="date" className="input-field max-w-52" value={f.primerIngreso} onChange={(e) => set('primerIngreso', e.target.value)} />
              <p className="mt-1 text-xs text-slate-400">
                Si ya lleva varios contratos, indica cuándo ingresó por primera vez. Los contratos anteriores se pueden agregar después.
              </p>
            </div>
          )}

          <div>
            <label className={labelCls}>Contrato firmado (opcional)</label>
            <ZonaSuelta
              onArchivos={agregar}
              accept=".pdf"
              titulo="Suelta aquí el contrato en PDF"
              ayuda="hasta 15 MB"
              compacta
              disabled={busy}
            />
            {contratos.length > 0 && (
              <ul className="mt-2 space-y-1">
                {contratos.map((f) => (
                  <li key={f.name + f.size} className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-1.5 text-xs">
                    <FileText size={13} className="shrink-0 text-red-500" />
                    <span className="min-w-0 flex-1 truncate" title={f.name}>{f.name}</span>
                    <button type="button" className="icon-btn" aria-label={`Quitar ${f.name}`} onClick={() => setContratos((c) => c.filter((x) => x !== f))}><X size={13} /></button>
                  </li>
                ))}
              </ul>
            )}
            {avisoArchivos && <p className="mt-1 whitespace-pre-line text-xs text-amber-700">{avisoArchivos}</p>}
            <p className="mt-1 text-[11px] text-slate-400">Al guardar, el sistema crea la carpeta del vendedor en la unidad de RH y deja ahí el contrato. También puedes subirlo después desde su ficha.</p>
          </div>
        </section>

        {error && <ErrorBox>{error}</ErrorBox>}
        <button disabled={busy} className="btn-primary w-full text-sm">
          <Plus size={15} /> {busy ? 'Guardando…' : 'Guardar vendedor'}
        </button>
      </form>
    </Modal>
  )
}
