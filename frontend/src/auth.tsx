import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { api, getDuracion, getExpira, getToken, guardarAviso, limpiarAviso, setToken } from './api'
import type { Usuario } from './types'

interface AuthCtx {
  user: Usuario | null
  loading: boolean
  login: (username: string, password: string) => Promise<void>
  logout: () => void
  /** ¿Tiene este permiso? (los permisos los define el admin por rol y por usuario; el admin tiene todos) */
  puede: (permiso: string) => boolean
  /** La sesión vence en menos de 2 minutos y la persona no la ha renovado. */
  porVencer: boolean
  /** Ya se llegó al máximo de la sesión: renovar no la extiende y hay que ingresar de nuevo. */
  topeAlcanzado: boolean
  renovar: () => Promise<void>
  /** Guarda el token nuevo (p. ej. tras cambiar la contraseña) y vuelve a leer al usuario. */
  adoptarSesion: (access_token: string, expires_in: number) => Promise<void>
}

const Ctx = createContext<AuthCtx | null>(null)

const REVISION_MS = 15_000
const AVISO_MS = 120_000
const ACTIVIDAD = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Usuario | null>(null)
  const [loading, setLoading] = useState(!!getToken())
  const [porVencer, setPorVencer] = useState(false)
  const [topeAlcanzado, setTopeAlcanzado] = useState(false)
  const ultimaActividad = useRef(Date.now())
  const renovando = useRef(false)

  useEffect(() => {
    if (!getToken()) return
    api
      .me()
      .then(setUser)
      .catch(() => setToken(null))
      .finally(() => setLoading(false))
  }, [])

  const cerrar = useCallback((aviso?: string) => {
    if (aviso) guardarAviso(aviso)
    else limpiarAviso()
    setToken(null)
    setUser(null)
    setPorVencer(false)
    setTopeAlcanzado(false)
  }, [])

  const renovar = useCallback(async () => {
    if (renovando.current) return
    renovando.current = true
    try {
      const antes = getExpira()
      const s = await api.renovarSesion()
      setToken(s.access_token, s.expires_in)
      // Si la nueva fecha casi no avanza, es porque se llegó al máximo de la sesión.
      const extendida = getExpira() - antes > 60_000
      setTopeAlcanzado(!extendida)
      setPorVencer(getExpira() - Date.now() <= AVISO_MS)
    } catch {
      /* si el servidor rechazó el token, api.ts ya llevó al login con el motivo */
    } finally {
      renovando.current = false
    }
  }, [])

  // Si el admin cambia los permisos, se reflejan al volver a esta pestaña (el servidor ya los aplica en cada petición).
  useEffect(() => {
    if (!user) return
    const releer = () => {
      if (document.visibilityState === 'visible') api.me().then((u) => setUser((a) => (a && a.id === u.id ? u : a))).catch(() => {})
    }
    document.addEventListener('visibilitychange', releer)
    return () => document.removeEventListener('visibilitychange', releer)
  }, [user?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Sesión deslizante: mientras la persona trabaja se renueva sola; si deja de trabajar, vence.
  useEffect(() => {
    if (!user) return
    const marcar = () => {
      ultimaActividad.current = Date.now()
    }
    ACTIVIDAD.forEach((e) => window.addEventListener(e, marcar, { passive: true }))
    const revisar = () => {
      const exp = getExpira()
      if (!exp) return
      const resta = exp - Date.now()
      if (resta <= 0) return cerrar('Tu sesión expiró por inactividad. Vuelve a ingresar.')
      const dur = getDuracion() || 3_600_000
      const activo = Date.now() - ultimaActividad.current < Math.min(dur / 2, 10 * 60_000)
      if (activo && resta < dur / 2 && !topeAlcanzado) void renovar()
      else setPorVencer(resta <= AVISO_MS)
    }
    const id = window.setInterval(revisar, REVISION_MS)
    document.addEventListener('visibilitychange', revisar)
    return () => {
      ACTIVIDAD.forEach((e) => window.removeEventListener(e, marcar))
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', revisar)
    }
  }, [user, cerrar, renovar, topeAlcanzado])

  const login = async (username: string, password: string) => {
    const { access_token, expires_in } = await api.login(username, password)
    setToken(access_token, expires_in)
    limpiarAviso()
    ultimaActividad.current = Date.now()
    setTopeAlcanzado(false)
    setPorVencer(false)
    setUser(await api.me())
  }

  const adoptarSesion = async (access_token: string, expires_in: number) => {
    setToken(access_token, expires_in)
    setUser(await api.me())
  }

  const logout = () => cerrar()

  const puede = useCallback((permiso: string) => !!user && (user.rol === 'admin' || !!user.permisos?.includes(permiso)), [user])

  return (
    <Ctx.Provider value={{ user, loading, login, logout, puede, porVencer, topeAlcanzado, renovar, adoptarSesion }}>
      {children}
    </Ctx.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const c = useContext(Ctx)
  if (!c) throw new Error('useAuth fuera de AuthProvider')
  return c
}
