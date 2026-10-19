import { useRef, useState, type ReactNode } from 'react'

// Gráficos SVG propios, sin librería. Marcas finas (barras ≤ 24 px con el extremo redondeado de 4 px,
// líneas de 2 px), rejilla de 1 px apenas visible, valores con tinta de texto (nunca con el color
// de la serie) y una capa de información al pasar el mouse o enfocar con teclado.
// Paleta categórica validada con el script de la skill de dataviz (azul, aqua, naranja, violeta).

export const SERIE = {
  azul: '#2a78d6',
  aqua: '#1baf7a',
  naranja: '#eb6834',
  violeta: '#6250d6',
} as const

const TINTA = '#0f2338' // texto principal
const TINTA_2 = '#4a6580' // texto secundario
const REJILLA = '#e2e8f0'
const SUPERFICIE = '#ffffff'

export const pct = (v: number | null | undefined, dec = 1) => (v == null ? '—' : `${(v * 100).toFixed(dec)}%`)

/** Tope «redondo» del eje y marcas: 0, 5, 10... */
function eje(max: number, marcas = 4): { tope: number; ticks: number[] } {
  if (max <= 0) return { tope: 1, ticks: [0, 1] }
  const crudo = max / marcas
  const mag = 10 ** Math.floor(Math.log10(crudo))
  const paso = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((p) => p >= crudo) ?? crudo
  const n = Math.ceil(max / paso)
  return { tope: n * paso, ticks: Array.from({ length: n + 1 }, (_, i) => i * paso) }
}

// ── Información emergente ────────────────────────────────────────────────────

interface Tip {
  x: number
  y: number
  titulo: string
  filas: { color: string; nombre: string; valor: string }[]
}

function useTip() {
  const caja = useRef<HTMLDivElement>(null)
  const [tip, setTip] = useState<Tip | null>(null)
  const mostrar = (clientX: number, clientY: number, titulo: string, filas: Tip['filas']) => {
    const r = caja.current?.getBoundingClientRect()
    if (!r) return
    setTip({ x: clientX - r.left, y: clientY - r.top, titulo, filas })
  }
  const enFoco = (el: Element, titulo: string, filas: Tip['filas']) => {
    const e = el.getBoundingClientRect()
    mostrar(e.left + e.width / 2, e.top + e.height / 2, titulo, filas)
  }
  const ocultar = () => setTip(null)
  const vista = (
    <>
      {tip && (
        <div
          role="tooltip"
          className="pointer-events-none absolute z-10 min-w-36 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg"
          style={{ left: Math.min(tip.x + 14, (caja.current?.clientWidth ?? 0) - 170), top: Math.max(tip.y - 12, 0) }}
        >
          <p className="mb-1 font-medium text-slate-500">{tip.titulo}</p>
          {tip.filas.map((f) => (
            <p key={f.nombre} className="flex items-center gap-2">
              <span className="h-0.5 w-3 shrink-0 rounded" style={{ background: f.color }} />
              <span className="font-semibold tabular-nums" style={{ color: TINTA }}>{f.valor}</span>
              <span className="text-slate-500">{f.nombre}</span>
            </p>
          ))}
        </div>
      )}
    </>
  )
  return { caja, mostrar, enFoco, ocultar, vista }
}

export function Leyenda({ series }: { series: { label: string; color: string }[] }) {
  if (series.length < 2) return null // una sola serie: la nombra el título
  return (
    <div className="mb-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-600">
      {series.map((s) => (
        <span key={s.label} className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />
          {s.label}
        </span>
      ))}
    </div>
  )
}

// ── Barras horizontales (1 o más series) ─────────────────────────────────────

export interface SerieBarras {
  label: string
  color: string
  valores: number[]
}

const BARRA = 14 // alto de cada barra
const HUECO = 2 // separación entre barras pegadas (color de la superficie)

/** Barra con el extremo redondeado de 4 px y la base cuadrada (crece desde el eje). */
function trazoBarra(x: number, y: number, w: number, h: number) {
  if (w <= 0) return ''
  const r = Math.min(4, w, h / 2)
  return `M${x},${y}H${x + w - r}a${r},${r} 0 0 1 ${r},${r}V${y + h - r}a${r},${r} 0 0 1 ${-r},${r}H${x}Z`
}

export function BarrasH({
  categorias,
  series,
  formato = (v: number) => String(v),
  ariaLabel,
}: {
  categorias: string[]
  series: SerieBarras[]
  formato?: (v: number) => string
  ariaLabel: string
}) {
  const { caja, mostrar, enFoco, ocultar, vista } = useTip()
  const W = 500
  const masLarga = Math.max(...categorias.map((c) => c.length))
  const izq = Math.min(190, Math.max(96, masLarga * 6.4 + 14)) // el texto largo no se recorta
  const der = 44 // espacio para el valor al extremo de la barra
  const sup = 6
  const inf = 24
  const grupo = series.length * BARRA + (series.length - 1) * HUECO
  const fila = grupo + 14
  const H = sup + categorias.length * fila + inf
  const { tope, ticks } = eje(Math.max(0, ...series.flatMap((s) => s.valores)))
  const ancho = W - izq - der
  const x = (v: number) => izq + (v / tope) * ancho

  return (
    <div ref={caja} className="relative">
      <Leyenda series={series} />
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={ariaLabel}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={sup} y2={H - inf} stroke={REJILLA} strokeWidth={1} />
            <text x={x(t)} y={H - 8} textAnchor="middle" fontSize={10} fill={TINTA_2}>{formato(t)}</text>
          </g>
        ))}
        {categorias.map((c, i) => {
          const y0 = sup + i * fila + (fila - grupo) / 2
          const filas = series.map((s) => ({ color: s.color, nombre: s.label, valor: formato(s.valores[i]) }))
          return (
            <g key={c}>
              <text x={izq - 8} y={y0 + grupo / 2 + 4} textAnchor="end" fontSize={11.5} fill={TINTA}>{c}</text>
              {series.map((s, j) => {
                const y = y0 + j * (BARRA + HUECO)
                const v = s.valores[i]
                return (
                  <g key={s.label}>
                    <path d={trazoBarra(x(0), y, x(v) - x(0), BARRA)} fill={s.color} />
                    <text x={x(v) + 6} y={y + BARRA / 2 + 4} fontSize={11} fontWeight={600} fill={TINTA_2}>{formato(v)}</text>
                  </g>
                )
              })}
              {/* El área de la fila entera es el objetivo del mouse y del teclado */}
              <rect
                x={0} y={sup + i * fila} width={W} height={fila} fill="transparent" tabIndex={0}
                aria-label={`${c}: ${filas.map((f) => `${f.nombre} ${f.valor}`).join(', ')}`}
                className="outline-none focus-visible:stroke-brand-600"
                onPointerMove={(e) => mostrar(e.clientX, e.clientY, c, filas)}
                onPointerLeave={ocultar}
                onFocus={(e) => enFoco(e.currentTarget, c, filas)}
                onBlur={ocultar}
              />
            </g>
          )
        })}
      </svg>
      {vista}
    </div>
  )
}

// ── Línea en el tiempo ───────────────────────────────────────────────────────

export interface PuntoLinea {
  etiqueta: string
  valor: number
  detalle: { nombre: string; valor: string }[]
}

export function Linea({
  puntos,
  color,
  formato,
  nombreSerie,
  ariaLabel,
  pie,
}: {
  puntos: PuntoLinea[]
  color: string
  formato: (v: number) => string
  nombreSerie: string
  ariaLabel: string
  pie?: ReactNode
}) {
  const { caja, mostrar, enFoco, ocultar, vista } = useTip()
  const [activo, setActivo] = useState<number | null>(null)
  const W = 1000
  const H = 260
  const izq = 44
  const der = 16
  const sup = 14
  const inf = 28
  const { tope, ticks } = eje(Math.max(0, ...puntos.map((p) => p.valor)))
  const n = puntos.length
  const px = (i: number) => (n === 1 ? izq + (W - izq - der) / 2 : izq + (i / (n - 1)) * (W - izq - der))
  const py = (v: number) => H - inf - (v / tope) * (H - inf - sup)
  const trazo = puntos.map((p, i) => `${i === 0 ? 'M' : 'L'}${px(i)},${py(p.valor)}`).join('')
  const area = n > 1 ? `${trazo}L${px(n - 1)},${H - inf}L${px(0)},${H - inf}Z` : ''

  const elegir = (i: number, clientX: number, clientY: number) => {
    setActivo(i)
    const p = puntos[i]
    mostrar(clientX, clientY, p.etiqueta, [
      { color, nombre: nombreSerie, valor: formato(p.valor) },
      ...p.detalle.map((d) => ({ color: 'transparent', nombre: d.nombre, valor: d.valor })),
    ])
  }

  return (
    <div ref={caja} className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={ariaLabel}
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          const xSvg = ((e.clientX - r.left) / r.width) * W
          let mejor = 0
          puntos.forEach((_, i) => { if (Math.abs(px(i) - xSvg) < Math.abs(px(mejor) - xSvg)) mejor = i })
          elegir(mejor, e.clientX, e.clientY)
        }}
        onPointerLeave={() => { setActivo(null); ocultar() }}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={izq} x2={W - der} y1={py(t)} y2={py(t)} stroke={REJILLA} strokeWidth={1} />
            <text x={izq - 6} y={py(t) + 3.5} textAnchor="end" fontSize={10} fill={TINTA_2}>{formato(t)}</text>
          </g>
        ))}
        {area && <path d={area} fill={color} opacity={0.1} />}
        <path d={trazo} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {activo !== null && (
          <line x1={px(activo)} x2={px(activo)} y1={sup} y2={H - inf} stroke={TINTA_2} strokeWidth={1} opacity={0.5} />
        )}
        {puntos.map((p, i) => (
          <g key={p.etiqueta}>
            <text x={px(i)} y={H - 9} textAnchor="middle" fontSize={10.5} fill={TINTA_2}>{p.etiqueta}</text>
            {/* Marca de 8 px con aro de 2 px del color de la superficie */}
            <circle cx={px(i)} cy={py(p.valor)} r={activo === i ? 6 : 4} fill={color} stroke={SUPERFICIE} strokeWidth={2} />
            {(i === n - 1 || activo === i) && (
              <text x={px(i)} y={py(p.valor) - 11} textAnchor="middle" fontSize={11} fontWeight={600} fill={TINTA}>{formato(p.valor)}</text>
            )}
            <circle
              cx={px(i)} cy={py(p.valor)} r={14} fill="transparent" tabIndex={0}
              aria-label={`${p.etiqueta}: ${formato(p.valor)}`} className="outline-none focus-visible:stroke-brand-600"
              onFocus={(e) => { setActivo(i); enFoco(e.currentTarget, p.etiqueta, [{ color, nombre: nombreSerie, valor: formato(p.valor) }, ...p.detalle.map((d) => ({ color: 'transparent', nombre: d.nombre, valor: d.valor }))]) }}
              onBlur={() => { setActivo(null); ocultar() }}
            />
          </g>
        ))}
      </svg>
      {pie}
      {vista}
    </div>
  )
}
