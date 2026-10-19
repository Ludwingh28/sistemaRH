import { useEffect, useState } from 'react'

/** true mientras la pantalla cumple la consulta (p. ej. '(max-width: 767px)'). */
export function useMediaQuery(consulta: string) {
  const [coincide, setCoincide] = useState(() => window.matchMedia(consulta).matches)
  useEffect(() => {
    const m = window.matchMedia(consulta)
    const alCambiar = () => setCoincide(m.matches)
    alCambiar()
    m.addEventListener('change', alCambiar)
    return () => m.removeEventListener('change', alCambiar)
  }, [consulta])
  return coincide
}
