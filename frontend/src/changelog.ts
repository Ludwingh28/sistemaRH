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

export const VERSION_ACTUAL = '1.1.2.0'

export const changelog: Version[] = [
  {
    version: '1.1.2.0',
    fecha: '2026-11-05',
    novedades: [
      'Al subir un contrato firmado, ahora queda claro a cuál contrato corresponde. Si el vendedor tiene un solo contrato, basta con arrastrar el PDF y se guarda en su carpeta como «1er contrato (NOMBRE DEL VENDEDOR)». Si tiene más de uno, primero eliges a cuál corresponde (aparecen con sus fechas) y se guarda como «2do contrato (NOMBRE)», «3er contrato (NOMBRE)», etc. La pantalla te muestra con qué nombre se va a guardar. Los contratos que ya estaban subidos no cambian de nombre.',
      'Lo mismo con el resto de los documentos: se guardan con un nombre ordenado, sin importar cómo se llame el archivo que subas. Por ejemplo «Kardex (NOMBRE DEL VENDEDOR)», «Hoja de vida (NOMBRE)», «Antecedentes FELCC (NOMBRE)», «Cuenta bancaria (NOMBRE)». La pantalla muestra con qué nombre se guardará. Si ya hay uno con ese nombre no se pisa: el nuevo se guarda con « - 2».',
      'Al soltar o elegir un archivo ya no se guarda de inmediato: aparece en una lista «Listo para guardar» y solo se guarda al pulsar «Guardar». Puedes quitarlo de la lista o cancelar si te equivocaste de archivo.',
      'El visor de documentos es más grande y se abre al instante con una animación de carga mientras llega el archivo, así sabes que está trabajando.',
      'Al quitar un archivo, la confirmación ahora es una ventana pequeña del propio sistema (antes era el aviso del navegador). Recuerda que no se borra: el archivo queda apartado en la carpeta _eliminados.',
      'Agregar un contrato anterior (o renovar) ya no pide el número: el sistema lo ubica según su fecha de inicio. Si el contrato es más antiguo que los que ya existen, queda como el nº 1 y los demás se corren un número (el que era nº 1 pasa a nº 2, etc.); los PDF ya subidos de esos contratos se renombran para seguir a su contrato («1er» pasa a «2do»). Un contrato anterior termina por defecto el día antes de que empiece el siguiente, y si sus fechas se cruzan con otro, el sistema lo avisa.',
      'Cuando un vendedor se retira antes de que termine su contrato, ese contrato figura como «Finalizado anticipadamente» (trabajó, pero terminó antes de tiempo) y muestra hasta cuándo debía durar. Si la baja llega después de la fecha de fin, figura como «Finalizado».',
      'Reingreso: si un vendedor que se retiró vuelve a la empresa, en su ficha aparece el botón «Reingreso». Se registra como un nuevo ingreso y recibe el siguiente contrato correlativo (si su último era el nº 1, el nuevo es el nº 2): no se anula ni se renumera nada. Su salida anterior sigue contando en la rotación de su mes y el reingreso cuenta como un alta. Si pasaron muy pocos días y la baja fue un error, un administrador puede usar «Anular la baja».',
    ],
    correcciones: [],
  },
  {
    version: '1.1.1.1',
    fecha: '2026-11-04',
    novedades: [],
    correcciones: [
      'En Vendedores, los totales de las tarjetas (Vigentes, Nuevos, Por vencer, Contrato vencido y Retirados) ahora cambian con los filtros: si eliges una zona, un equipo o escribes en el buscador, muestran las cantidades de esa selección y no las del total nacional.',
    ],
  },
  {
    version: '1.1.1.0',
    fecha: '2026-11-05',
    novedades: [
      'Anular una baja: si a un vendedor se le registró la baja por error (por ejemplo faltó unos días y volvió a trabajar), el administrador puede abrir su ficha y pulsar «Anular la baja». Se borran la fecha y el motivo de la baja, el vendedor vuelve a figurar vigente y su contrato deja de verse como retirado. Los contratos no se modifican. Queda registrado en su historial con tu usuario y una nota opcional.',
    ],
    correcciones: [],
  },
  {
    version: '1.1.0.0',
    fecha: '2026-11-03',
    novedades: [
      'El panel «Documentación» ahora controla 11 documentos por vendedor: Kardex, CI, Hoja de vida (CV), Antecedentes FELCC, Factura de luz/agua, Ubicación, Fachada, Cuenta bancaria, SUS, Acta de entrega y Contrato.',
      'Cada documento tiene su propia carpeta dentro de la carpeta del vendedor, igual que los anteriores. Lo que ya estaba subido (Kardex, CI, Fachada, Ubicación y Contratos) sigue exactamente donde estaba y sigue contando como entregado.',
      'Para que las carpetas nuevas existan en los vendedores que ya tienes, usa una vez «Crear las carpetas que faltan» (Vendedores → Carpetas de contratos, con alcance nacional). Los vendedores nuevos nacen con todas.',
      'El Contrato también aparece en el panel: figura como entregado si hay algún PDF en la carpeta «Contratos» del vendedor.',
      'Los documentos se ven dentro del sistema: al tocar el ojo de un archivo se abre el PDF en una ventana grande sobre la misma pantalla, sin abrir otra pestaña. También se puede descargar.',
      'Cuando un documento ya está subido, la ficha y el panel muestran el archivo y ya no ofrecen la zona de subida; si hace falta agregar otro, hay un enlace «Subir otro archivo».',
    ],
    correcciones: [],
  },
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
