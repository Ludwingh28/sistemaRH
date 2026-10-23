// Fechas: el servidor usa AAAA-MM-DD; en pantalla se muestran como DD/MM/AAAA.

export const fmt = (iso: string | null | undefined) => {
  if (!iso) return '—'
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}

const aIso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

// Se trabaja con mediodía local para evitar saltos por horario de verano.
const aFecha = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00`)

export const hoyIso = () => aIso(new Date())

export const sumarDias = (iso: string, n: number) => {
  const d = aFecha(iso)
  d.setDate(d.getDate() + n)
  return aIso(d)
}

/** Contrato de 1 año exacto: del 8/4/2026 al 8/4/2027 (mismo cálculo que el servidor). */
export const finPorDefecto = (inicio: string) => {
  const d = aFecha(inicio)
  const fin = new Date(d.getFullYear() + 1, d.getMonth(), d.getDate(), 12)
  if (fin.getMonth() !== d.getMonth()) fin.setDate(0) // 29 de febrero
  return aIso(fin)
}

export const diasDelMes = (anio: number, mes: number) => new Date(anio, mes, 0).getDate()

const dosDigitos = (n: number) => String(n).padStart(2, '0')

/** Lunes de la semana de una fecha (la semana empieza en lunes). */
export const lunesDe = (iso: string) => {
  const d = aFecha(iso)
  return sumarDias(iso, -((d.getDay() + 6) % 7))
}

/**
 * Convierte día/mes de inicio y de fin (más el año) en fechas completas. Un día que no existe
 * (31 de febrero) se ajusta al último del mes; si el fin queda antes que el inicio, es del año siguiente.
 */
export const armarRango = (r: { anio: number; di: number; mi: number; df: number; mf: number }) => {
  const di = Math.min(r.di, diasDelMes(r.anio, r.mi))
  const desde = `${r.anio}-${dosDigitos(r.mi)}-${dosDigitos(di)}`
  const anioFin = r.mf < r.mi || (r.mf === r.mi && r.df < di) ? r.anio + 1 : r.anio
  const df = Math.min(r.df, diasDelMes(anioFin, r.mf))
  return { desde, hasta: `${anioFin}-${dosDigitos(r.mf)}-${dosDigitos(df)}` }
}

const ultimoDiaDe = (anio: number, mes: number) => `${anio}-${dosDigitos(mes)}-${dosDigitos(diasDelMes(anio, mes))}`

/** ¿El rango es una semana (lunes a sábado o a domingo)? */
export const esSemana = (desde: string, hasta: string) =>
  lunesDe(desde) === desde && (hasta === sumarDias(desde, 5) || hasta === sumarDias(desde, 6))

/** ¿El rango es un mes calendario completo? */
export const esMes = (desde: string, hasta: string) => {
  const [a, m, d] = desde.split('-').map(Number)
  return d === 1 && hasta === ultimoDiaDe(a, m)
}

/** Mes completo, `delta` meses después (o antes) del mes de una fecha. */
export const mesDesplazado = (iso: string, delta: number) => {
  const [a, m] = iso.split('-').map(Number)
  const f = new Date(a, m - 1 + delta, 1, 12)
  const anio = f.getFullYear()
  const mes = f.getMonth() + 1
  return { desde: `${anio}-${dosDigitos(mes)}-01`, hasta: ultimoDiaDe(anio, mes) }
}

/** Días que abarca un rango, ambos extremos incluidos. */
export const diasEnRango = (desde: string, hasta: string) =>
  Math.round((aFecha(hasta).getTime() - aFecha(desde).getTime()) / 86400000) + 1

/** Para buscar: sin acentos, en mayúsculas y con espacios simples («Ñandú» ≈ «NANDU»). */
export const sinAcentos = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toUpperCase()
