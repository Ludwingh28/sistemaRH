import { BarraCarga, Esqueleto, EsqueletoTarjetas } from '../components/Cargando'
import { Info } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { api } from '../api'
import { BarrasH, Linea, SERIE, pct } from '../components/charts'
import FiltroRango, { useRango } from '../components/FiltroRango'
import { ErrorBox, PageHeader, labelCls } from '../components/ui'
import { fmt } from '../format'
import type { Ausentismo, Regional, Rotacion as DatosRotacion } from '../types'

function Tarjeta({ titulo, subtitulo, children, ancho }: { titulo: string; subtitulo?: string; children: ReactNode; ancho?: boolean }) {
  return (
    <section className={`card p-5 ${ancho ? 'lg:col-span-2' : ''}`}>
      <h3 className="text-sm font-semibold">{titulo}</h3>
      {subtitulo && <p className="mb-3 mt-0.5 text-xs text-slate-500">{subtitulo}</p>}
      {!subtitulo && <div className="mb-3" />}
      {children}
    </section>
  )
}

function Dato({ etiqueta, valor, nota }: { etiqueta: string; valor: string; nota?: string }) {
  return (
    <div className="card p-4">
      <p className="text-xs text-slate-500">{etiqueta}</p>
      <p className="mt-1 text-3xl font-semibold tabular-nums leading-none">{valor}</p>
      {nota && <p className="mt-2 text-xs text-slate-400">{nota}</p>}
    </div>
  )
}

export default function Rotacion() {
  const { rango, setRango, desde, hasta } = useRango()
  const [estructura, setEstructura] = useState<Regional[]>([])
  const [regionalId, setRegionalId] = useState('')
  const [equipoId, setEquipoId] = useState('')
  const [datos, setDatos] = useState<DatosRotacion | null>(null)
  const [aus, setAus] = useState<Ausentismo | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => { api.estructura().then(setEstructura).catch((e) => setError(e.message)) }, [])

  // Dos consultas: el panel principal es rápido; el ausentismo consulta el BI y llega después.
  // `cancelado` descarta respuestas viejas si el filtro cambió mientras viajaban.
  useEffect(() => {
    let cancelado = false
    const filtros = {
      desde,
      hasta,
      regional_id: regionalId ? Number(regionalId) : undefined,
      equipo_id: equipoId ? Number(equipoId) : undefined,
    }
    setLoading(true)
    setAus(null)
    api
      .rotacion(filtros)
      .then((d) => { if (!cancelado) { setDatos(d); setError('') } })
      .catch((e) => { if (!cancelado) setError(e.message) })
      .finally(() => { if (!cancelado) setLoading(false) })
    api
      .ausentismo(filtros)
      .then((a) => { if (!cancelado) setAus(a) })
      .catch(() => { if (!cancelado) setAus({ disponible: false, aviso: 'No se pudo calcular el ausentismo.', total: { nombre: 'Total', habiles: 0, faltas: 0, ausentismo: null }, equipos: [] }) })
    return () => { cancelado = true }
  }, [desde, hasta, regionalId, equipoId])

  const equipos = estructura.filter((r) => !regionalId || r.id === Number(regionalId)).flatMap((r) => r.equipos)

  const porRotacion = useMemo(() => [...(datos?.equipos ?? [])].sort((a, b) => b.rotacion - a.rotacion), [datos])
  const porAusentismo = useMemo(
    () => [...(aus?.equipos ?? [])].filter((g) => g.ausentismo != null).sort((a, b) => (b.ausentismo ?? 0) - (a.ausentismo ?? 0)),
    [aus],
  )
  const ausDe = (nombre: string) => aus?.equipos.find((g) => g.nombre === nombre)?.ausentismo ?? null
  const totalSalidas = datos?.motivos.reduce((s, m) => s + m.cantidad, 0) ?? 0
  const t = datos?.total

  return (
    <div>
      <PageHeader
        titulo="Rotación"
        subtitulo="Ingresos, salidas y rotación de vendedores, con el mismo cálculo del dashboard de Desarrollo Humano."
      />

      <div className="card mb-5 flex flex-wrap items-end gap-3 p-4">
        <FiltroRango rango={rango} setRango={setRango} desde={desde} hasta={hasta} />
        <div>
          <label className={labelCls}>Zona</label>
          <select className="input-field w-36" value={regionalId} onChange={(e) => { setRegionalId(e.target.value); setEquipoId('') }}>
            <option value="">Todas</option>
            {estructura.map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls}>Equipo</label>
          <select className="input-field w-36" value={equipoId} onChange={(e) => setEquipoId(e.target.value)}>
            <option value="">Todos</option>
            {equipos.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
          </select>
        </div>
        <p className="ml-auto text-right text-sm font-medium text-slate-700">Del {fmt(desde)} al {fmt(hasta)}</p>
      </div>

      {error && <div className="mb-4"><ErrorBox>{error}</ErrorBox></div>}
      {datos?.avisos.map((a) => (
        <p key={a} className="mb-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
          <Info size={16} className="mt-0.5 shrink-0" /> {a}
        </p>
      ))}

      {/* Mientras recarga se conserva lo anterior, atenuado */}
      {datos && t && (
        <div className={`relative transition-opacity duration-200 ${loading ? 'opacity-50' : ''}`}>
          <BarraCarga activa={loading} />
          <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-[1.4fr_1fr_1fr_1fr_1fr]">
            <div className="card col-span-2 p-5 lg:col-span-1">
              <p className="text-xs text-slate-500">Rotación del período</p>
              <p className="mt-1 text-5xl font-semibold leading-none">
                {pct(t.rotacion)}
              </p>
              <p className="mt-3 text-xs text-slate-400">
                {t.bajas} {t.bajas === 1 ? 'salida' : 'salidas'} sobre un promedio de {((t.personal_periodo + t.final) / 2).toLocaleString('es-BO', { maximumFractionDigits: 1 })} vendedores.
                Fórmula estándar: <span className="font-medium text-slate-600">{pct(t.rotacion_estandar)}</span>
              </p>
            </div>
            <Dato etiqueta="Vendedores al cierre" valor={String(t.final)} nota={`${t.inicial} al inicio`} />
            <Dato etiqueta="Ingresos" valor={String(t.altas)} />
            <Dato etiqueta="Salidas" valor={String(t.bajas)} />
            <Dato
              etiqueta="Ausentismo"
              valor={aus ? pct(aus.total.ausentismo) : '…'}
              nota={!aus ? 'Consultando el BI…' : aus.disponible ? 'Días hábiles sin preventa (BI)' : (aus.aviso ?? 'No disponible')}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Tarjeta titulo="Vendedores por equipo" subtitulo="Personal al cierre, ingresos y salidas del período">
              <BarrasH
                ariaLabel="Vendedores por equipo: personal al cierre, ingresos y salidas"
                categorias={datos.equipos.map((g) => g.nombre)}
                series={[
                  { label: 'Al cierre', color: SERIE.azul, valores: datos.equipos.map((g) => g.final) },
                  { label: 'Ingresos', color: SERIE.aqua, valores: datos.equipos.map((g) => g.altas) },
                  { label: 'Salidas', color: SERIE.naranja, valores: datos.equipos.map((g) => g.bajas) },
                ]}
              />
            </Tarjeta>

            <Tarjeta titulo="Rotación por equipo" subtitulo="Salidas sobre el promedio de personal, de mayor a menor">
              <BarrasH
                ariaLabel="Rotación por equipo"
                categorias={porRotacion.map((g) => g.nombre)}
                series={[{ label: 'Rotación', color: SERIE.naranja, valores: porRotacion.map((g) => g.rotacion) }]}
                formato={(v) => pct(v, 0 < v && v < 0.1 ? 1 : 0)}
              />
            </Tarjeta>

            <Tarjeta titulo="Motivo de retiro" subtitulo={totalSalidas ? `${totalSalidas} salidas en el período` : undefined}>
              {datos.motivos.length === 0 ? (
                <p className="py-8 text-center text-sm text-slate-400">No hubo salidas en este período</p>
              ) : (
                <BarrasH
                  ariaLabel="Salidas por motivo"
                  categorias={datos.motivos.map((m) => m.motivo)}
                  series={[{ label: 'Salidas', color: SERIE.naranja, valores: datos.motivos.map((m) => m.cantidad) }]}
                />
              )}
            </Tarjeta>

            <Tarjeta titulo="Ausentismo por equipo" subtitulo="Días hábiles sin preventa sobre días hábiles">
              {porAusentismo.length === 0 ? (
                <p className="py-8 text-center text-sm text-slate-400">{aus ? (aus.aviso ?? 'No disponible para este rango') : 'Consultando el BI…'}</p>
              ) : (
                <BarrasH
                  ariaLabel="Ausentismo por equipo"
                  categorias={porAusentismo.map((g) => g.nombre)}
                  series={[{ label: 'Ausentismo', color: SERIE.violeta, valores: porAusentismo.map((g) => g.ausentismo ?? 0) }]}
                  formato={(v) => pct(v, 0)}
                />
              )}
            </Tarjeta>

            <Tarjeta
              titulo={`Rotación mensual ${hasta.slice(0, 4)}`}
              subtitulo="Con los filtros de zona y equipo; no depende del rango de fechas. * mes en curso"
              ancho
            >
              {datos.tendencia.length < 3 ? (
                <p className="py-10 text-center text-sm text-slate-400">
                  La tendencia aparece cuando hay al menos 3 meses con bajas registradas
                  ({datos.tendencia.length === 0 ? 'todavía ninguno' : `hay ${datos.tendencia.length}`}).
                </p>
              ) : (
                <Linea
                  ariaLabel="Rotación mensual"
                  nombreSerie="Rotación"
                  color={SERIE.naranja}
                  formato={(v) => pct(v, 0)}
                  puntos={datos.tendencia.map((m) => ({
                    etiqueta: m.etiqueta,
                    valor: m.rotacion,
                    detalle: [
                      { nombre: 'salidas', valor: String(m.bajas) },
                      { nombre: 'al cierre', valor: String(m.final) },
                    ],
                  }))}
                />
              )}
            </Tarjeta>
          </div>

          {/* Vista en tabla: los mismos números, sin depender del color */}
          <section className="card mt-4 overflow-x-auto">
            <h3 className="px-5 pt-5 text-sm font-semibold">Detalle por equipo</h3>
            <table className="tbl mt-3">
              <thead>
                <tr>
                  <th>Zona</th>
                  <th>Equipo</th>
                  <th className="num">Al inicio</th>
                  <th className="num">Ingresos</th>
                  <th className="num">Salidas</th>
                  <th className="num">Al cierre</th>
                  <th className="num" title="Método de RH: salidas / ((inicio + ingresos + cierre) / 2)">Rotación</th>
                  <th className="num" title="Estándar: salidas / ((inicio + cierre) / 2)">Rot. estándar</th>
                  <th className="num">Ausentismo</th>
                </tr>
              </thead>
              <tbody>
                {datos.equipos.map((g) => (
                  <tr key={g.nombre}>
                    <td>{g.zona}</td>
                    <td className="font-medium">{g.nombre}</td>
                    <td className="num">{g.inicial}</td>
                    <td className="num">{g.altas}</td>
                    <td className="num">{g.bajas}</td>
                    <td className="num">{g.final}</td>
                    <td className="num font-semibold">{pct(g.rotacion)}</td>
                    <td className="num text-slate-500">{pct(g.rotacion_estandar)}</td>
                    <td className="num text-slate-500">{pct(ausDe(g.nombre))}</td>
                  </tr>
                ))}
                <tr className="font-semibold">
                  <td colSpan={2}>Total</td>
                  <td className="num">{t.inicial}</td>
                  <td className="num">{t.altas}</td>
                  <td className="num">{t.bajas}</td>
                  <td className="num">{t.final}</td>
                  <td className="num">{pct(t.rotacion)}</td>
                  <td className="num text-slate-500">{pct(t.rotacion_estandar)}</td>
                  <td className="num text-slate-500">{aus ? pct(aus.total.ausentismo) : '…'}</td>
                </tr>
              </tbody>
            </table>
          </section>

          <details className="card mt-4 px-5 py-4 text-sm text-slate-600">
            <summary className="cursor-pointer font-medium text-slate-700">¿Cómo se calcula la rotación?</summary>
            <ul className="mt-3 list-disc space-y-1.5 pl-5">
              <li><b>Personal del período</b> = quienes ya estaban al empezar + los que ingresaron en el período.</li>
              <li><b>Al cierre</b> = personal del período − salidas.</li>
              <li><b>Rotación</b> = salidas ÷ promedio de (personal del período y personal al cierre). Es el cálculo del Power BI de Desarrollo Humano.</li>
              <li><b>Fórmula estándar</b> = salidas ÷ promedio de (personal al inicio y al cierre); suele dar un poco más.</li>
              <li>La fecha de salida es el primer día que ya no trabajó. Las renovaciones de contrato no cuentan como ingreso.</li>
              <li><b>Ausentismo</b> = días hábiles (lunes a sábado, sin feriados de su zona) sin preventa en el BI ÷ días hábiles.</li>
            </ul>
          </details>
        </div>
      )}
      {!datos && loading && (
        <div className="space-y-4">
          <EsqueletoTarjetas n={5} />
          <div className="card"><Esqueleto filas={6} columnas={6} /></div>
        </div>
      )}
    </div>
  )
}
