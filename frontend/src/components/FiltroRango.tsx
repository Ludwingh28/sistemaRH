import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import {
  armarRango, diasDelMes, diasEnRango, esMes, esSemana, hoyIso, lunesDe, mesDesplazado, sumarDias,
} from '../format'
import { labelCls } from './ui'

// Rango de fechas por día/mes + año (los usan Asistencia y Rotación). RH y DH miran por semanas,
// y una semana puede cruzar de un mes a otro.

export interface Rango {
  anio: number
  di: number
  mi: number
  df: number
  mf: number
}

const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
const anios = (() => {
  const a = new Date().getFullYear()
  return [a - 2, a - 1, a, a + 1]
})()

const desdeFechas = (d: string, h: string): Rango => {
  const [a, m, dd] = d.split('-').map(Number)
  const [, mf, df] = h.split('-').map(Number)
  return { anio: a, di: dd, mi: m, df, mf }
}

const mesEnCurso = (): Rango => {
  const [a, m] = hoyIso().split('-').map(Number)
  return { anio: a, di: 1, mi: m, df: diasDelMes(a, m), mf: m }
}

/** Estado del filtro: el mes en curso por defecto, y las fechas completas ya armadas. */
export function useRango() {
  const [rango, setRango] = useState<Rango>(mesEnCurso)
  const { desde, hasta } = useMemo(() => armarRango(rango), [rango])
  return { rango, setRango, desde, hasta }
}

/** Día del mes como número: se puede escribir con libertad y se confirma si es válido (1 a 31). */
function Dia({ valor, onChange, titulo }: { valor: number; onChange: (n: number) => void; titulo: string }) {
  const [texto, setTexto] = useState(String(valor))
  useEffect(() => setTexto(String(valor)), [valor])
  return (
    <input
      type="number" inputMode="numeric" min={1} max={31} aria-label={titulo} title={titulo}
      className="input-field w-18 px-3 text-center"
      value={texto}
      onChange={(e) => {
        setTexto(e.target.value)
        const n = Number(e.target.value)
        if (e.target.value !== '' && Number.isInteger(n) && n >= 1 && n <= 31) onChange(n)
      }}
      onBlur={() => setTexto(String(valor))}
    />
  )
}

export default function FiltroRango({
  rango,
  setRango,
  desde,
  hasta,
}: {
  rango: Rango
  setRango: (r: Rango) => void
  desde: string
  hasta: string
}) {
  const cambiar = (c: Partial<Rango>) => setRango({ ...rango, ...c })
  const semana = esSemana(desde, hasta)
  const mes = !semana && esMes(desde, hasta)

  const estaSemana = () => {
    const lun = lunesDe(hoyIso())
    setRango(desdeFechas(lun, sumarDias(lun, 5)))
  }
  const esteMes = () => setRango(mesEnCurso())

  // Anterior / siguiente respetan el tipo de rango: semana -> 7 días, mes -> mes calendario,
  // rango libre -> la misma cantidad de días.
  const mover = (dir: -1 | 1) => {
    if (semana) {
      const largo = diasEnRango(desde, hasta) - 1
      const lun = sumarDias(desde, 7 * dir)
      setRango(desdeFechas(lun, sumarDias(lun, largo)))
    } else if (mes) {
      const m = mesDesplazado(desde, dir)
      setRango(desdeFechas(m.desde, m.hasta))
    } else {
      const n = diasEnRango(desde, hasta)
      setRango(desdeFechas(sumarDias(desde, n * dir), sumarDias(hasta, n * dir)))
    }
  }
  const titulo = semana ? 'semana' : mes ? 'mes' : 'período'

  const boton = (activo: boolean) =>
    `rounded-lg border px-3 py-2 text-xs font-medium transition ${
      activo ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-200 text-slate-600 hover:bg-slate-50'
    }`

  return (
    <>
      <div>
        <label className={labelCls}>Año</label>
        <select className="input-field w-24" value={rango.anio} onChange={(e) => cambiar({ anio: Number(e.target.value) })}>
          {anios.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
      </div>
      <div>
        <label className={labelCls}>Desde (día · mes)</label>
        <div className="flex gap-1.5">
          <Dia valor={rango.di} onChange={(n) => cambiar({ di: n })} titulo="Día de inicio" />
          <select className="input-field w-24" value={rango.mi} onChange={(e) => cambiar({ mi: Number(e.target.value) })}>
            {MESES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
        </div>
      </div>
      <div>
        <label className={labelCls}>Hasta (día · mes)</label>
        <div className="flex gap-1.5">
          <Dia valor={rango.df} onChange={(n) => cambiar({ df: n })} titulo="Día final" />
          <select className="input-field w-24" value={rango.mf} onChange={(e) => cambiar({ mf: Number(e.target.value) })}>
            {MESES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
        </div>
      </div>
      <div className="flex items-center gap-1" role="group" aria-label="Período">
        <button onClick={() => mover(-1)} title={`Anterior (${titulo})`} aria-label={`Anterior ${titulo}`} className="icon-btn border border-slate-200"><ChevronLeft size={16} /></button>
        <button onClick={estaSemana} aria-pressed={semana} className={boton(semana)}>Esta semana</button>
        <button onClick={esteMes} aria-pressed={mes} className={boton(mes)}>Este mes</button>
        <button onClick={() => mover(1)} title={`Siguiente (${titulo})`} aria-label={`Siguiente ${titulo}`} className="icon-btn border border-slate-200"><ChevronRight size={16} /></button>
      </div>
    </>
  )
}
