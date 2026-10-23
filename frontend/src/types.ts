export type Rol = 'admin' | 'jefe_rrhh' | 'dh' | 'analista_dh' | 'lector'

export interface Usuario {
  id: number
  username: string
  nombre: string
  email: string | null
  rol: Rol
  activo: boolean
  ultimo_acceso: string | null
  debe_cambiar_clave: boolean
  bloqueado: boolean
  permisos?: string[] // permisos efectivos (solo viene en /auth/me)
  todas_regionales: boolean // alcance: true = nacional
  regionales: number[] // si no es nacional: regionales que ve
}

export interface EventoAuditoria {
  id: number
  fecha: string
  evento: string
  usuario: string | null
  actor: string | null
  detalle: string | null
  ip: string | null
}

export interface Sesion {
  access_token: string
  expires_in: number
}

export interface Equipo {
  id: number
  nombre: string
  supervisor: string | null
}

export interface Regional {
  id: number
  nombre: string
  equipos: Equipo[]
}

// ── Vendedores y contratos ───────────────────────────────────────────────────

export type EstadoVendedor = 'activo' | 'nuevo' | 'retirado'
export type EstadoContrato = 'vigente' | 'por_vencer' | 'vencido' | 'retirado'
export type EstadoContratoFila = 'vigente' | 'por_vencer' | 'vencido' | 'anterior' | 'futuro' | 'rescindido'

export interface Contrato {
  id: number
  numero: number
  fecha_inicio: string
  fecha_fin: string
  dias_capacitacion: number
  fecha_inicio_ventas: string
  observacion: string | null
  estado: EstadoContratoFila
  dias_para_vencer: number
}

export interface Vendedor {
  id: number
  codigo_vendedor: string
  documento: string | null
  nombre: string
  sexo: 'M' | 'F' | null
  fecha_nacimiento: string | null
  telefono_corporativo: string | null
  telefono_personal: string | null
  cargo: string
  area: string
  equipo_id: number
  equipo_nombre: string
  regional_id: number
  regional: string
  fecha_primer_ingreso: string
  fecha_baja: string | null
  motivo_baja: string | null
  vigente: boolean
  estado: EstadoVendedor
  contrato_actual: Contrato | null
  estado_contrato: EstadoContrato | ''
  dias_para_vencer: number | null
  total_contratos: number
}

export interface EventoHistorial {
  id: number
  evento: string
  fecha: string
  detalle: string | null
  usuario: string | null
  creado_en: string
}

export interface VendedorDetalle extends Vendedor {
  contratos: Contrato[]
  historial: EventoHistorial[]
}

export interface ResumenVendedores {
  vigentes: number
  nuevos: number
  por_vencer: number
  vencidos: number
  retirados: number
}

export interface ContratoForm {
  numero?: number
  fecha_inicio?: string
  fecha_fin?: string
  dias_capacitacion?: number
  observacion?: string
}

export interface VendedorCrear {
  codigo_vendedor: string
  documento?: string
  nombre: string
  sexo?: 'M' | 'F'
  fecha_nacimiento?: string
  telefono_corporativo?: string
  telefono_personal?: string
  cargo?: string
  area?: string
  equipo_id: number
  fecha_primer_ingreso?: string
  contrato: ContratoForm
}

export type VendedorEditable = Partial<
  Pick<
    Vendedor,
    | 'codigo_vendedor'
    | 'documento'
    | 'nombre'
    | 'sexo'
    | 'fecha_nacimiento'
    | 'telefono_corporativo'
    | 'telefono_personal'
    | 'cargo'
    | 'area'
    | 'equipo_id'
    | 'fecha_primer_ingreso'
  >
>

// ── Asistencia ───────────────────────────────────────────────────────────────

/** P presente · F falta · C capacitación · N no laborable · - fuera de contrato o aún no */
export type CeldaAsistencia = 'P' | 'F' | 'C' | 'N' | '-'

export interface DiaAsistencia {
  fecha: string
  etiqueta: string
  domingo: boolean
}

export interface FilaAsistencia {
  vendedor_id: number
  codigo_vendedor: string
  nombre: string
  regional_id: number
  zona: string
  equipo: string
  retirado: string | null
  celdas: CeldaAsistencia[]
  habiles: number
  asistidos: number
  faltas: number
  extra: number
}

export interface Feriado {
  id: number
  fecha: string
  regional_id: number | null
  regional: string | null
  descripcion: string
  origen: 'manual' | 'holidays'
  tipo: string | null
  activo: boolean
}

export interface EstadoFeriados {
  fuente: string
  ultima_actualizacion: string | null
}

export interface MatrizAsistencia {
  desde: string
  hasta: string
  dias: DiaAsistencia[]
  filas: FilaAsistencia[]
  feriados: Feriado[]
}

// ── Rotación ─────────────────────────────────────────────────────────────────

export interface GrupoRotacion {
  nombre: string
  zona: string | null
  inicial: number
  altas: number
  bajas: number
  final: number
  personal_periodo: number
  rotacion: number
  rotacion_estandar: number
}

export interface MesRotacion {
  mes: string
  etiqueta: string
  inicial: number
  altas: number
  bajas: number
  final: number
  rotacion: number
}

export interface Rotacion {
  desde: string
  hasta: string
  total: GrupoRotacion
  equipos: GrupoRotacion[]
  motivos: { motivo: string; cantidad: number }[]
  tendencia: MesRotacion[]
  avisos: string[]
}

export interface AusentismoGrupo {
  nombre: string
  habiles: number
  faltas: number
  ausentismo: number | null
}

export interface Ausentismo {
  disponible: boolean
  aviso: string | null
  total: AusentismoGrupo
  equipos: AusentismoGrupo[]
}

export interface TrabajandoHoy {
  fecha: string
  trabajando: number | null
  esperados: number
  en_capacitacion: number
  sin_jornada: number
  aviso: string | null
}

export interface ArchivoContrato {
  nombre: string
  tamano: number
  tipo: string
  modificado: string
}

export interface DocumentosVendedor {
  configurada: boolean
  disponible: boolean
  existe_carpeta: boolean
  carpeta: string | null
  ruta: string | null
  archivos: ArchivoContrato[]
  aviso: string | null
}

export interface EstadoCarpetas {
  configurada: boolean
  accesible: boolean
  escribible: boolean
  mensaje: string | null
  ruta: string | null
  vendedores: number
  con_carpeta: number
  sin_carpeta: number
}

export interface RevisionCarpetas {
  sin_vendedor: { carpeta: string; sugerencias: { id: number; nombre: string; similitud: number }[] }[]
  sin_carpeta: { id: number; codigo: string; nombre: string; vigente: boolean }[]
}

export interface ResultadoCrearCarpetas {
  vinculadas: number
  creadas: number
  subcarpetas: number
  errores: string[]
}

export interface ImportObservacion {
  nivel: 'OMITIDO' | 'AVISO' | 'CORREGIDO' | string
  fila: number
  codigo: string
  nombre: string
  mensaje: string
}

export interface Importacion {
  aplicado: boolean
  filas_leidas: number
  nuevos: { fila: number; codigo: string; nombre: string; equipo: string; estado: string; ingreso: string; baja: string | null }[]
  actualizados: { fila: number; codigo: string; nombre: string; cambios: string[] }[]
  sin_cambios: number
  omitidos: number
  bajas: number
  por_equipo: Record<string, number>
  contratos_vencidos: number
  por_vencer: number
  observaciones: ImportObservacion[]
  carpetas_creadas: number
  aviso_carpetas: string | null
}

// ── Permisos
export interface PermisoDef {
  codigo: string
  etiqueta: string
  grupo: string
  descripcion: string
}

export interface PermisosRoles {
  catalogo: PermisoDef[]
  roles: Record<string, string[]>
  defecto: Record<string, string[]>
  personalizados: string[]
}

export interface PermisosUsuario {
  rol: string
  del_rol: string[]
  permitir: string[]
  denegar: string[]
  efectivos: string[]
}

// ── Documentación
export interface DocCategoria {
  clave: string
  titulo: string
  corto: string
  extensiones: string[]
}

export type EstadoDoc = 'ok' | 'falta'

export interface CeldaDoc {
  estado: EstadoDoc
  archivos: number
}

export interface FilaDoc {
  vendedor_id: number
  codigo: string
  nombre: string
  equipo: string
  regional: string
  vigente: boolean
  docs: Record<string, CeldaDoc>
  faltan: number
}

export interface MatrizDoc {
  columnas: DocCategoria[]
  filas: FilaDoc[]
  resumen: { vendedores: number; completos: number; por_documento: Record<string, Record<EstadoDoc, number>> }
  unidad_disponible: boolean
  aviso: string | null
}
