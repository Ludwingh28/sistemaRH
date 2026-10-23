import type {
  Ausentismo,
  ContratoForm,
  DocumentosVendedor,
  EstadoCarpetas,
  ResultadoCrearCarpetas,
  RevisionCarpetas,
  EventoAuditoria,
  Importacion,
  DocCategoria,
  MatrizDoc,
  PermisosRoles,
  PermisosUsuario,
  Sesion,
  EstadoFeriados,
  Feriado,
  MatrizAsistencia,
  Regional,
  ResumenVendedores,
  Rotacion,
  Rol,
  TrabajandoHoy,
  Usuario,
  Vendedor,
  VendedorCrear,
  VendedorDetalle,
  VendedorEditable,
} from './types'

// Ruta donde se publica el sistema ('/' o, p. ej., '/rh/' detrás de nginx): ver vite.config.ts y .env.rh
const BASE = import.meta.env.BASE_URL
const API = `${BASE}api/v1`

const TOKEN_KEY = 'token'
const EXP_KEY = 'token_exp'
const DUR_KEY = 'token_dur'
const AVISO_KEY = 'rh_aviso_login'

export const getToken = () => localStorage.getItem(TOKEN_KEY)
/** Guarda (o borra) el token. `expiresIn` son los segundos de vida que informa el servidor. */
export const setToken = (t: string | null, expiresIn?: number) => {
  if (!t) {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(EXP_KEY)
    localStorage.removeItem(DUR_KEY)
    return
  }
  localStorage.setItem(TOKEN_KEY, t)
  if (expiresIn) {
    localStorage.setItem(EXP_KEY, String(Date.now() + expiresIn * 1000))
    localStorage.setItem(DUR_KEY, String(expiresIn * 1000))
  }
}
/** Momento (ms) en que vence el token actual; 0 si se desconoce. */
export const getExpira = () => Number(localStorage.getItem(EXP_KEY)) || 0
/** Duración (ms) del último token emitido; 0 si se desconoce. */
export const getDuracion = () => Number(localStorage.getItem(DUR_KEY)) || 0

/** Mensaje para mostrar en el login tras perder la sesión (sobrevive a la recarga de la página). */
export const guardarAviso = (m: string) => {
  try {
    sessionStorage.setItem(AVISO_KEY, m)
  } catch {
    /* sin almacenamiento: solo se pierde el aviso */
  }
}
/** Se lee sin borrar: la página puede recargarse al llegar al login. Se borra al ingresar o al cerrar sesión. */
export const leerAviso = (): string => {
  try {
    return sessionStorage.getItem(AVISO_KEY) ?? ''
  } catch {
    return ''
  }
}
export const limpiarAviso = () => {
  try {
    sessionStorage.removeItem(AVISO_KEY)
  } catch {
    /* nada que limpiar */
  }
}

/** El servidor rechazó el token: se limpia y se vuelve al login explicando el motivo. */
async function sesionPerdida(res: Response) {
  const body = await res.clone().json().catch(() => null)
  const d = typeof body?.detail === 'string' ? body.detail : ''
  guardarAviso(/cerrada|expir/i.test(d) ? d : 'Tu sesión terminó. Vuelve a ingresar.')
  setToken(null)
  window.location.href = `${BASE}login`
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken()
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      ...(init.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  })
  if (res.status === 401 && path !== '/auth/login') await sesionPerdida(res)
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    const detail = body?.detail
    throw new Error(
      typeof detail === 'string'
        ? detail
        : Array.isArray(detail)
          ? detail.map((d: { msg: string }) => d.msg).join(', ')
          : `Error ${res.status}`,
    )
  }
  return res.status === 204 ? (undefined as T) : res.json()
}

/** Descarga binaria autenticada (PDF, Excel): devuelve el archivo y el nombre que sugiere el servidor. */
async function archivo(path: string, init: RequestInit = {}): Promise<{ blob: Blob; nombre: string | null }> {
  const token = getToken()
  const res = await fetch(`${API}${path}`, { ...init, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...init.headers } })
  if (res.status === 401) await sesionPerdida(res)
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new Error(typeof body?.detail === 'string' ? body.detail : `Error ${res.status}`)
  }
  const cab = res.headers.get('Content-Disposition') ?? ''
  const nombre = /filename="?([^";]+)"?/i.exec(cab)?.[1] ?? null
  return { blob: await res.blob(), nombre }
}

/** Guarda un archivo en el equipo del usuario. */
export function guardarComo(blob: Blob, nombre: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nombre
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

const qs = (params: Record<string, string | number | boolean | undefined>) => {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') p.set(k, String(v))
  const s = p.toString()
  return s ? `?${s}` : ''
}

const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) })

export const api = {
  login: (username: string, password: string) =>
    request<Sesion>('/auth/login', json('POST', { username, password })),
  me: () => request<Usuario>('/auth/me'),
  renovarSesion: () => request<Sesion>('/auth/refresh', { method: 'POST' }),
  estructura: () => request<Regional[]>('/estructura'),

  // Vendedores y contratos
  vendedores: (f: {
    q?: string
    vigente?: boolean
    regional_id?: number
    equipo_id?: number
    contrato?: string
    vence_en?: number
  }) => request<Vendedor[]>(`/vendedores${qs(f)}`),
  resumenVendedores: () => request<ResumenVendedores>('/vendedores/resumen'),
  motivosBaja: () => request<string[]>('/vendedores/motivos-baja'),
  vendedor: (id: number) => request<VendedorDetalle>(`/vendedores/${id}`),
  crearVendedor: (data: VendedorCrear) => request<VendedorDetalle>('/vendedores', json('POST', data)),
  actualizarVendedor: (id: number, data: VendedorEditable) =>
    request<VendedorDetalle>(`/vendedores/${id}`, json('PATCH', data)),
  darDeBaja: (id: number, fecha_baja: string, motivo_baja: string) =>
    request<VendedorDetalle>(`/vendedores/${id}/baja`, json('POST', { fecha_baja, motivo_baja: motivo_baja || null })),
  agregarContrato: (id: number, data: ContratoForm) =>
    request<VendedorDetalle>(`/vendedores/${id}/contratos`, json('POST', data)),
  actualizarContrato: (contratoId: number, data: ContratoForm) =>
    request<VendedorDetalle>(`/vendedores/contratos/${contratoId}`, json('PATCH', data)),
  eliminarContrato: (contratoId: number) =>
    request<VendedorDetalle>(`/vendedores/contratos/${contratoId}`, { method: 'DELETE' }),

  // Asistencia y calendario laboral
  matriz: (f: { desde?: string; hasta?: string; regional_id?: number; equipo_id?: number }) =>
    request<MatrizAsistencia>(`/asistencia/matriz${qs(f)}`),
  hoy: (f: { regional_id?: number; equipo_id?: number }) => request<TrabajandoHoy>(`/asistencia/hoy${qs(f)}`),
  feriados: (anio: number) => request<Feriado[]>(`/asistencia/feriados${qs({ anio })}`),
  crearFeriado: (d: { fecha: string; regional_id?: number; descripcion: string }) =>
    request<Feriado>('/asistencia/feriados', json('POST', d)),
  eliminarFeriado: (id: number) => request<void>(`/asistencia/feriados/${id}`, { method: 'DELETE' }),
  activarFeriado: (id: number, activo: boolean) =>
    request<Feriado>(`/asistencia/feriados/${id}`, json('PATCH', { activo })),
  estadoFeriados: (anio: number) => request<EstadoFeriados>(`/asistencia/feriados/estado${qs({ anio })}`),
  sincronizarFeriados: (anio: number) =>
    request<EstadoFeriados>(`/asistencia/feriados/sincronizar${qs({ anio })}`, { method: 'POST' }),

  exportarAsistencia: (f: { desde?: string; hasta?: string; regional_id?: number; equipo_id?: number; q?: string }) =>
    archivo(`/asistencia/exportar${qs(f)}`),

  // Documentos de cada vendedor (carpeta compartida de RH). `categoria`: tipo de documento (hoy «contratos»).
  documentosVendedor: (id: number, categoria = 'contratos') =>
    request<DocumentosVendedor>(`/vendedores/${id}/documentos${qs({ categoria })}`),
  crearCarpetaVendedor: (id: number, categoria = 'contratos') =>
    request<DocumentosVendedor>(`/vendedores/${id}/documentos/carpeta${qs({ categoria })}`, { method: 'POST' }),
  subirDocumento: (id: number, file: File, categoria = 'contratos') => {
    const datos = new FormData()
    datos.append('archivo', file)
    return archivo(`/vendedores/${id}/documentos${qs({ categoria })}`, { method: 'POST', body: datos }).then(() => undefined)
  },
  verDocumento: (id: number, nombre: string, descargar = false, categoria = 'contratos') =>
    archivo(`/vendedores/${id}/documentos/archivo${qs({ nombre, descargar, categoria })}`),
  quitarDocumento: (id: number, nombre: string, categoria = 'contratos') =>
    request<void>(`/vendedores/${id}/documentos${qs({ nombre, categoria })}`, { method: 'DELETE' }),
  estadoCarpetas: () => request<EstadoCarpetas>('/documentos/carpetas/estado'),
  revisionCarpetas: () => request<RevisionCarpetas>('/documentos/carpetas/revision'),
  vincularCarpeta: (vendedor_id: number, carpeta: string) =>
    request<void>('/documentos/carpetas/vincular', json('POST', { vendedor_id, carpeta })),
  crearCarpetasFaltantes: () =>
    request<ResultadoCrearCarpetas>('/documentos/carpetas/crear-faltantes', { method: 'POST' }),

  // Rotación
  rotacion: (f: { desde?: string; hasta?: string; regional_id?: number; equipo_id?: number }) =>
    request<Rotacion>(`/rotacion${qs(f)}`),
  ausentismo: (f: { desde?: string; hasta?: string; regional_id?: number; equipo_id?: number }) =>
    request<Ausentismo>(`/rotacion/ausentismo${qs(f)}`),

  importarVendedores: (archivo: File, aplicar: boolean, corregirFechas: boolean) => {
    const datos = new FormData()
    datos.append('archivo', archivo)
    datos.append('aplicar', String(aplicar))
    datos.append('corregir_fechas', String(corregirFechas))
    return request<Importacion>('/vendedores/importar', { method: 'POST', body: datos })
  },

  // Usuarios
  usuarios: () => request<Usuario[]>('/usuarios'),
  crearUsuario: (d: { username: string; nombre: string; email?: string; rol: Rol; password: string; todas_regionales: boolean; regionales: number[] }) =>
    request<Usuario>('/usuarios', json('POST', d)),
  actualizarUsuario: (
    id: number,
    d: Partial<{ username: string; nombre: string; email: string; rol: Rol; activo: boolean; todas_regionales: boolean; regionales: number[] }>,
  ) => request<Usuario>(`/usuarios/${id}`, json('PATCH', d)),
  fijarPassword: (id: number, new_password: string) =>
    request<{ ok: boolean }>(`/usuarios/${id}/password`, json('POST', { new_password })),
  eliminarUsuario: (id: number) => request<void>(`/usuarios/${id}`, { method: 'DELETE' }),
  cambiarPassword: (current_password: string, new_password: string) =>
    request<Sesion>('/auth/change-password', json('POST', { current_password, new_password })),
  // Permisos (solo admin)
  permisos: () => request<PermisosRoles>('/permisos'),
  guardarPermisosRol: (rol: string, permisos: string[]) =>
    request<{ permisos: string[] }>(`/permisos/roles/${rol}`, json('PUT', { permisos })),
  restablecerPermisosRol: (rol: string) => request<{ permisos: string[] }>(`/permisos/roles/${rol}/restablecer`, { method: 'POST' }),
  permisosUsuario: (id: number) => request<PermisosUsuario>(`/usuarios/${id}/permisos`),
  guardarPermisosUsuario: (id: number, permitir: string[], denegar: string[]) =>
    request<PermisosUsuario>(`/usuarios/${id}/permisos`, json('PUT', { permitir, denegar })),

  // Documentación
  docCategorias: () => request<DocCategoria[]>('/documentacion/categorias'),
  docMatriz: (f: { regional_id?: number; equipo_id?: number; estado?: string; q?: string; solo_faltantes?: boolean }) =>
    request<MatrizDoc>(`/documentacion/matriz${qs(f)}`),

  cerrarSesiones: (id: number) => request<{ ok: boolean }>(`/usuarios/${id}/cerrar-sesiones`, { method: 'POST' }),
  desbloquearUsuario: (id: number) =>
    request<{ ok: boolean; bloqueos_levantados: number }>(`/usuarios/${id}/desbloquear`, { method: 'POST' }),
  auditoria: (f: { usuario?: string; limite?: number } = {}) => request<EventoAuditoria[]>(`/auditoria${qs(f)}`),
}
