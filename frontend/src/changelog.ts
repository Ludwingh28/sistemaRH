// Novedades en lenguaje simple (sin términos técnicos). Se muestran en la ventana «Novedades» que aparece al ingresar cuando hay una
// versión que la persona no ha visto. NO hay un panel de Novedades en el menú: el historial completo se consulta aquí, en el
// código fuente, y en /CHANGELOG.md (bitácora técnica). Al publicar una versión hay que subir VERSION_ACTUAL (también se ve en
// el menú lateral y en el login).

export interface Version {
  version: string
  fecha: string
  novedades: string[]
  correcciones: string[]
}

export const VERSION_ACTUAL = '1.0.0.0'

export const changelog: Version[] = [
  {
    version: '1.0.0.0',
    fecha: '2026-10-23',
    novedades: [
      // Usuarios, permisos y alcance
      'Roles nuevos: Jefe RRHH y Jefe DDHH (antes «Desarrollo Humano»), además de Analista DH y Solo lectura. Cada uno tiene sus propios permisos.',
      'Permisos por rol: el administrador decide qué puede hacer cada rol con los paneles (ver vendedores, registrarlos, importar el Excel, gestionar contratos, descargar la asistencia, gestionar feriados, ver y subir documentos…) desde «Usuarios → Roles y permisos». El administrador siempre tiene todo.',
      'Permisos por usuario: además del rol, se le puede dar o quitar un permiso puntual a una persona desde su ficha de usuario, en la pestaña «Permisos».',
      'Al crear un usuario se define su alcance: «Nacional» (ve todo el país) o una o varias regionales específicas (por ejemplo solo Santa Cruz). Quien tiene alcance regional solo ve y gestiona los vendedores, contratos, asistencia, rotación, documentación y feriados de sus regionales, y en los filtros solo aparecen sus zonas y equipos. El alcance se puede cambiar después desde «Editar» el usuario, y se ve en la lista de usuarios.',
      'Cada persona solo ve en el menú los paneles a los que tiene acceso, y los botones que no puede usar no aparecen. Los cambios de permisos se aplican de inmediato.',
      // Seguridad
      'Las contraseñas deben tener al menos 8 caracteres, con letras y números, y no pueden ser iguales al usuario.',
      'Cuando el administrador crea tu cuenta o te restablece la contraseña, la que recibes es temporal: al ingresar el sistema te pide elegir la tuya antes de continuar.',
      'Por seguridad, la sesión se cierra sola tras un rato sin actividad. Mientras trabajas se renueva sin que tengas que hacer nada; si estás por quedarte sin sesión, aparece un aviso con cuenta regresiva y el botón «Seguir conectado». Una sesión dura como máximo 12 horas seguidas. Si tu sesión termina (por inactividad o porque un administrador la cerró), al volver al ingreso verás el motivo.',
      'El administrador puede cerrar las sesiones abiertas de cualquier persona y desbloquear una cuenta bloqueada por intentos fallidos sin esperar los 15 minutos. En la lista de usuarios se ve quién tiene la cuenta bloqueada o con clave temporal.',
      'Nueva «Bitácora» de seguridad en Usuarios: registra los ingresos, intentos fallidos, bloqueos y cambios de contraseña, de cuentas y de permisos, con fecha y hora. En cada usuario, la pestaña «Seguridad» muestra su actividad reciente.',
      // Vendedores y contratos
      'Nuevo botón «Importar Excel» en Vendedores: sube el Excel mensual de RRHH (por ejemplo septiembre y luego octubre). Antes de cargar, el sistema muestra un resumen: cuántos vendedores se crean, a cuántos se les actualizan los datos, cuántas bajas hay y qué filas no se pueden cargar y por qué.',
      'La importación se puede repetir sin miedo: los vendedores nuevos se crean, a los que ya existen se les completan o corrigen los datos (teléfonos, nacimiento, carnet, zona, bajas…) y nunca se borra a nadie. Una celda vacía en el Excel no borra un dato que ya está en el sistema. Las filas con problemas (sin código, código o carnet repetido, zona desconocida, fechas dudosas) no se cargan y quedan explicadas en el resumen, para corregirlas en el Excel y volver a subirlo.',
      'Al importar, el sistema compara el código de cada vendedor con el del BI y avisa si no existe o si pertenece a otra persona (con el código correcto sugerido), porque un código equivocado hace que la asistencia salga con faltas. Ahora también se puede corregir el código de un vendedor desde su ficha, en «Editar datos».',
      'Opción para corregir automáticamente fechas de ingreso en el futuro que tengan el día y el mes invertidos (por ejemplo 09/11/2026 en lugar de 11/09/2026). Si el Excel trae la columna del número de contratos del vendedor (Nº CONTRATO), el sistema la usa.',
      'Los contratos duran 1 año exacto: si empiezan el 08/04/2026, terminan el 08/04/2027 (antes terminaban un día antes).',
      // Documentos y carpetas
      'Las carpetas de contratos ahora se organizan por regional: Santa Cruz, Cochabamba, La Paz… y dentro de cada una, «Vendedores», con la carpeta de cada vendedor y sus subcarpetas (Contratos, Kardex, CI, Fachada y Ubicación). Si se abre una regional nueva, su carpeta se crea sola. El botón «Crear las carpetas que faltan» (Vendedores → Carpetas de contratos, solo con alcance nacional) deja completa esa estructura.',
      'Nuevo panel «Documentación»: una tabla con los vendedores y los documentos que deben entregar (Kardex, CI, Fachada y Ubicación, todos en PDF). Un check verde indica que su PDF ya está en el sistema y una X roja que falta. Se filtra por zona, equipo, estado del vendedor y nombre, y se puede ver solo a quienes tienen faltantes o solo quienes deben un documento en particular.',
      'Al tocar un casillero se abre el documento del vendedor: se ve el archivo y se sube arrastrando y soltando el PDF. Un documento solo cuenta como entregado cuando su PDF está subido al sistema, aunque exista en físico. La ficha del vendedor tiene una pestaña «Documentación» con esos mismos documentos.',
      // Comodidad
      'Buscador en Asistencia y en Documentación: escribe parte del nombre, el código, el equipo o la zona y la tabla se acota al instante (sin acentos ni mayúsculas: «nandu» encuentra a «Ñandú»). Un botón X o la tecla Escape limpian la búsqueda. Al exportar la asistencia a Excel se respeta la búsqueda: baja lo que ves.',
      'Animaciones de carga en los paneles: al abrir un panel o cambiar un filtro aparece una barra de progreso y el contenido se atenúa mientras llegan los datos nuevos, y en la primera carga se ven marcadores grises en lugar de una pantalla vacía.',
      'Nuevo ícono de Cruzimex en la pestaña del navegador.',
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
