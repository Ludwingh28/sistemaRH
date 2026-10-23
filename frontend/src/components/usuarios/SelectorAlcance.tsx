import { Globe2, MapPin } from 'lucide-react'
import type { Regional } from '../../types'
import { labelCls } from '../ui'

export interface Alcance {
  todas: boolean
  regionales: number[]
}

/** Texto corto del alcance de una cuenta: «Nacional» o los nombres de sus regionales. */
export const textoAlcance = (a: Alcance, estructura: Regional[]) =>
  a.todas ? 'Nacional' : a.regionales.map((id) => estructura.find((r) => r.id === id)?.nombre ?? `#${id}`).join(', ') || 'Sin regional'

/**
 * Qué datos verá la persona: todo el país (nacional) o solo algunas regionales. Limita vendedores, contratos,
 * asistencia, rotación, documentación y feriados.
 */
export default function SelectorAlcance({
  valor, onChange, estructura, disabled = false,
}: {
  valor: Alcance
  onChange: (a: Alcance) => void
  estructura: Regional[]
  disabled?: boolean
}) {
  const alternar = (id: number) =>
    onChange({ ...valor, regionales: valor.regionales.includes(id) ? valor.regionales.filter((x) => x !== id) : [...valor.regionales, id] })

  return (
    <fieldset disabled={disabled} className="space-y-2">
      <legend className={labelCls}>Alcance: ¿qué regionales verá?</legend>
      <label className={`flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-2.5 transition ${valor.todas ? 'border-brand-500 bg-brand-50/50' : 'border-slate-200 hover:bg-slate-50'}`}>
        <input type="radio" name="alcance" className="mt-1 accent-brand-600" checked={valor.todas} onChange={() => onChange({ todas: true, regionales: [] })} />
        <span>
          <span className="flex items-center gap-1.5 text-sm font-medium text-slate-700"><Globe2 size={14} /> Nacional</span>
          <span className="block text-xs text-slate-400">Ve todo el país, todas las regionales (y las que se abran después).</span>
        </span>
      </label>
      <label className={`flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-2.5 transition ${!valor.todas ? 'border-brand-500 bg-brand-50/50' : 'border-slate-200 hover:bg-slate-50'}`}>
        <input type="radio" name="alcance" className="mt-1 accent-brand-600" checked={!valor.todas} onChange={() => onChange({ todas: false, regionales: valor.regionales })} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 text-sm font-medium text-slate-700"><MapPin size={14} /> Regionales específicas</span>
          <span className="block text-xs text-slate-400">Solo verá (y podrá gestionar) los vendedores y datos de las regionales que marques.</span>
          {!valor.todas && (
            <span className="mt-2 flex flex-wrap gap-2">
              {estructura.map((r) => {
                const sel = valor.regionales.includes(r.id)
                return (
                  <button type="button" key={r.id} onClick={() => alternar(r.id)} aria-pressed={sel}
                    className={`rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset transition ${sel ? 'bg-brand-600 text-white ring-brand-600' : 'bg-white text-slate-600 ring-slate-300 hover:bg-slate-50'}`}>
                    {r.nombre}
                  </button>
                )
              })}
            </span>
          )}
          {!valor.todas && valor.regionales.length === 0 && <span className="mt-1.5 block text-xs text-red-500">Elige al menos una regional.</span>}
        </span>
      </label>
    </fieldset>
  )
}
