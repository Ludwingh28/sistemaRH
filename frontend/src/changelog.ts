// Novedades visibles para los usuarios. Lenguaje simple, sin términos técnicos.
// La bitácora técnica completa está en /CHANGELOG.md.

export interface Version {
  version: string
  fecha: string
  novedades: string[]
  correcciones: string[]
}

export const VERSION_ACTUAL = '0.0.0.2'

export const changelog: Version[] = [
  {
    version: '0.0.0.2',
    fecha: '2026-10-19',
    novedades: [
      'Las contraseñas deben tener al menos 8 caracteres, con letras y números, y no pueden ser iguales al usuario.',
      'Cuando el administrador crea tu cuenta o te restablece la contraseña, la que recibes es temporal: al ingresar el sistema te pide elegir la tuya antes de continuar.',
      'Por seguridad, la sesión se cierra sola tras un rato sin actividad. Mientras trabajas se renueva sin que tengas que hacer nada; si estás por quedarte sin sesión, aparece un aviso con cuenta regresiva y el botón «Seguir conectado». Una sesión dura como máximo 12 horas seguidas.',
      'Si tu sesión termina (por inactividad o porque un administrador la cerró), al volver al ingreso verás el motivo.',
      'El administrador puede cerrar las sesiones abiertas de cualquier persona, desbloquear una cuenta bloqueada por intentos fallidos sin esperar los 15 minutos, y ver quién tiene la cuenta bloqueada o con clave temporal en la lista de usuarios.',
      'Nueva «Bitácora» de seguridad en Usuarios: registra los ingresos, intentos fallidos, bloqueos y cambios de contraseña o de cuentas, con fecha y hora. En cada usuario, la pestaña «Seguridad» muestra su actividad reciente.',
    ],
    correcciones: [],
  },
  {
    version: '0.0.0.1',
    fecha: '2026-10-14',
    novedades: [
      'Ya puedes ingresar al sistema con tu usuario y contraseña.',
      'Vendedores ahora es el panel de gestión completo: ves quién está vigente, quién es nuevo, a quién se le vence el contrato y quién se retiró.',
      'Cada vendedor tiene su historial de contratos (de 1 año, renovables): puedes renovar con un clic, registrar contratos anteriores y ver cuántos lleva.',
      'Un aviso de colores indica los contratos por vencer en los próximos 15, 30, 60 o 90 días, y los que ya vencieron sin renovar.',
      'Al registrar un vendedor se guardan sus datos completos: código, carnet, nombre, sexo, teléfonos, cargo, zona y equipo.',
      'Puedes dar de baja a un vendedor indicando la fecha de salida y el motivo (bajo desempeño, salud, etc.).',
      'Nueva asistencia por gestión: eliges el año y el día-mes de inicio y de fin (puedes ver una semana que cruza de un mes a otro) y ves una tabla con un día por columna (lun 01-09, mar 02-09…), marcando cuándo hizo preventa, cuándo no y los días de capacitación. Hay botones para moverte de semana en semana.',
      'Todo lo que se escribe en los formularios (nombres, carnet, cargo, motivos, observaciones, feriados) se guarda en MAYÚSCULAS, para mantener la misma nomenclatura.',
      'En Asistencia y Rotación el día del rango se escribe como número, y los botones «anterior» y «siguiente» se adaptan: si estás viendo una semana avanzan una semana, si estás viendo un mes avanzan un mes. El botón de semana o de mes se pinta de azul según lo que estés viendo.',
      'Nueva tarjeta en Asistencia: «Vendedores trabajando hoy» (por ejemplo 55 de 66), que cambia según la zona y el equipo que elijas y se actualiza sola cada 2 minutos.',
      'El menú lateral se puede contraer para dar más espacio a las pantallas, y todo el sistema se adapta a tablets y celulares (el menú se abre con el botón de arriba a la izquierda).',
      'Ahora puedes exportar la asistencia a Excel con el botón «Exportar a Excel»: descarga exactamente lo que estás viendo (mismo rango de fechas, zona y equipo), con una hoja de detalle lista para tablas dinámicas.',
      'En la ficha del vendedor los datos se ven en modo lectura y solo se pueden cambiar al pulsar «Editar datos», para evitar modificaciones por accidente.',
      'Al registrar un vendedor, el sistema le crea su carpeta de contratos en la unidad de RH, y ahí mismo puedes arrastrar y soltar su contrato en PDF. En la ficha del vendedor también hay una zona «Suelta aquí» para subir contratos (uno o varios a la vez); lo que RH guarde directamente en la carpeta aparece solo.',
      'Por seguridad, después de 5 intentos fallidos de ingreso el usuario se bloquea 15 minutos.',
      'La asistencia cuenta de lunes a sábado, descuenta los feriados de cada zona y calcula días hábiles, asistidos y faltas por vendedor.',
      'Nuevo calendario de feriados, nacionales o por zona, que se genera solo con los feriados nacionales y los de cada departamento (Cochabamba, Santa Cruz, La Paz) y se puede completar o ajustar a mano desde la pantalla de Asistencia.',
      'Nuevo panel de Rotación, basado en el dashboard de Desarrollo Humano: muestra la rotación del período, los vendedores al cierre, los ingresos, las salidas y el ausentismo, por equipo y por motivo de retiro, para cualquier rango de fechas (una semana, un mes, el año).',
      'La rotación se calcula sola con las fechas de ingreso y de salida de cada vendedor, con el mismo método del Power BI, y además se muestra la fórmula estándar para comparar.',
      'El administrador puede crear usuarios, editar sus datos (nombre, correo, rol), activarlos o desactivarlos, cambiarles la contraseña y eliminarlos.',
      'La lista de usuarios se puede buscar y filtrar, y muestra cuándo fue la última vez que cada persona ingresó.',
      'Cada persona puede cambiar su propia contraseña desde el menú, con un indicador de qué tan segura es.',
      'Cuando se cambia una contraseña, las sesiones abiertas con la contraseña anterior se cierran.',
    ],
    correcciones: [],
  },
]
