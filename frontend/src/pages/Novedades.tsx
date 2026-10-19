import { PageHeader } from '../components/ui'
import { changelog } from '../changelog'

export default function Novedades() {
  return (
    <div className="max-w-2xl">
      <PageHeader titulo="Novedades" subtitulo="Lo que ha cambiado en el sistema." />
      <div className="space-y-4">
        {changelog.map((v) => (
          <section key={v.version} className="card p-6">
            <div className="mb-4 flex items-center gap-3">
              <span className="badge-ok">Versión {v.version}</span>
              <span className="text-sm text-navy-500">{v.fecha}</span>
            </div>
            {v.novedades.length > 0 && (
              <>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-navy-500">Qué hay de nuevo</p>
                <ul className="mb-4 list-disc space-y-1.5 pl-5 text-sm marker:text-brand-500">
                  {v.novedades.map((n) => <li key={n}>{n}</li>)}
                </ul>
              </>
            )}
            {v.correcciones.length > 0 && (
              <>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-navy-500">Qué se corrigió</p>
                <ul className="list-disc space-y-1.5 pl-5 text-sm marker:text-brand-500">
                  {v.correcciones.map((c) => <li key={c}>{c}</li>)}
                </ul>
              </>
            )}
          </section>
        ))}
      </div>
    </div>
  )
}
