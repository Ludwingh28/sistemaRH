import type { ReactNode } from 'react'

/**
 * Animaciones de carga de los paneles.
 *  - <Zona cargando>: barra de progreso arriba y el contenido atenuado mientras llegan los datos nuevos
 *    (al cambiar un filtro se ve que el panel está trabajando, sin que el contenido «salte»).
 *  - <Esqueleto>: filas grises pulsantes mientras llega la primera carga.
 */
/** Barra de progreso fina en el borde superior del contenedor (que debe ser `relative`). */
export function BarraCarga({ activa }: { activa: boolean }) {
  return <div className={`barra-carga ${activa ? 'barra-carga-activa' : ''}`} role="progressbar" aria-hidden={!activa} aria-label="Cargando" />
}

export function Zona({ cargando, children, className = '' }: { cargando: boolean; children: ReactNode; className?: string }) {
  return (
    <div className={`relative ${className}`} aria-busy={cargando}>
      <BarraCarga activa={cargando} />
      <div className={`transition-opacity duration-200 ${cargando ? 'pointer-events-none opacity-50' : 'opacity-100'}`}>{children}</div>
    </div>
  )
}

export function Esqueleto({ filas = 6, columnas = 5, className = '' }: { filas?: number; columnas?: number; className?: string }) {
  return (
    <div className={`animate-pulse space-y-3 p-5 ${className}`} role="status" aria-label="Cargando datos">
      <div className="h-3 w-1/3 rounded bg-slate-200" />
      {Array.from({ length: filas }, (_, i) => (
        <div key={i} className="flex gap-3">
          {Array.from({ length: columnas }, (_, j) => (
            <div key={j} className="h-4 rounded bg-slate-100" style={{ flex: j === 1 ? 3 : 1 }} />
          ))}
        </div>
      ))}
    </div>
  )
}

/** Tarjetas grises pulsantes (para paneles con gráficos). */
export function EsqueletoTarjetas({ n = 4 }: { n?: number }) {
  return (
    <div className="grid animate-pulse grid-cols-2 gap-3 md:grid-cols-4" role="status" aria-label="Cargando datos">
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="card h-24 bg-slate-50" />
      ))}
    </div>
  )
}
