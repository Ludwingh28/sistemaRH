import { Search, X } from 'lucide-react'

/** Campo de búsqueda con lupa y botón para limpiar (la tecla Escape también limpia). */
export default function Buscador({
  valor, onChange, placeholder = 'Nombre o código…', className = '',
}: {
  valor: string
  onChange: (v: string) => void
  placeholder?: string
  className?: string
}) {
  return (
    <div className={`relative ${className}`}>
      <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
      <input
        type="search"
        className="input-field pl-9 pr-9 [&::-webkit-search-cancel-button]:hidden"
        placeholder={placeholder}
        aria-label="Buscar"
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Escape') onChange('') }}
      />
      {valor && (
        <button type="button" onClick={() => onChange('')} aria-label="Limpiar la búsqueda" title="Limpiar"
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
          <X size={14} />
        </button>
      )}
    </div>
  )
}
