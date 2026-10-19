# Despliegue a producción — Cruzimex · Sistema RH (Canal DTS)

> **Esquema recomendado para el servidor de Cruzimex** (nginx + servicio de Windows, sin Docker): `deploy/DESPLIEGUE-WINDOWS-SERVER.md`. Esta guía describe la variante de un solo proceso/puerto (frontend servido por el propio backend); para ella compila el frontend con `set VITE_BASE=/&& npm run build`.

En producción **todo corre en un solo proceso y un solo puerto**: el backend (FastAPI) atiende la API y también
entrega las pantallas ya compiladas. No hace falta Node en el servidor, salvo para compilar.

```
Navegador ──HTTPS──▶ (Nginx / IIS, opcional) ──▶ uvicorn :8000 ──▶ PostgreSQL (sistema_rh)
                                                         ├──▶ PostgreSQL del BI (solo lectura)
                                                         └──▶ Carpeta compartida de contratos (PDF)
```

## 1. Qué necesitas

| Cosa | Detalle |
|---|---|
| Servidor | Windows Server, con Python 3.13 (y Node 20+ solo para compilar el frontend) |
| PostgreSQL | Una base **nueva y vacía** para el sistema (p. ej. `sistema_rh`) con un usuario propio y una contraseña fuerte |
| BI | Acceso al PostgreSQL del BI. Conviene un usuario **solo de lectura** creado para este sistema |
| Unidad de contratos | La unidad compartida de RH (`Docs_RRHH`); la cuenta que ejecuta el servicio necesita lectura y escritura |
| Dirección | Un nombre interno (p. ej. `rh.cruzimex.local`) y, si se puede, HTTPS |

## 2. Instalación (Windows)

```powershell
# 1) Copiar el proyecto al servidor (sin las carpetas .venv ni node_modules) y, dentro de la carpeta raíz:
.\deploy\windows\construir.ps1            # instala dependencias y compila el frontend

# 2) Crear backend\.env a partir de backend\.env.example (ver sección 3)

# 3) Crear tablas, estructura DTS y el administrador, y revisar todo
.\deploy\windows\preparar-base.ps1

# 4) Iniciar (prueba manual)
.\deploy\windows\iniciar.ps1              # http://SERVIDOR:8000
```

`preparar-base.ps1` termina con un informe `[OK] / [AVISO] / [FALLA]` (`verificar_produccion.py`).
**No sigas mientras haya alguna `[FALLA]`.**

### Dejarlo como servicio de Windows (arranca solo y se reinicia si falla)
1. Instala [NSSM](https://nssm.cc) y ejecuta (como administrador):
   ```powershell
   nssm install SistemaRH "C:\ruta\sistemaRH\backend\.venv\Scripts\python.exe" "-m uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 1 --proxy-headers --no-server-header"
   nssm set SistemaRH AppDirectory "C:\ruta\sistemaRH\backend"
   nssm set SistemaRH AppEnvironment "PYTHONIOENCODING=utf-8"
   nssm set SistemaRH Start SERVICE_AUTO_START
   nssm set SistemaRH AppStdout "C:\ruta\sistemaRH\logs\salida.log"
   nssm set SistemaRH AppStderr "C:\ruta\sistemaRH\logs\error.log"
   ```
2. **Cuenta del servicio**: si la unidad de contratos es una ruta de red (`\\servidor\Docs_RRHH`), el servicio **no** puede correr como "Sistema local": en `nssm edit SistemaRH` → pestaña *Log on*, usa una cuenta de dominio con permiso sobre esa carpeta compartida.
3. Abre el puerto en el firewall de Windows solo para la red interna.

## 3. Configuración (`backend\.env`)

```ini
ENTORNO=produccion
APP_DB_HOST=...            APP_DB_PORT=5432
APP_DB_NAME=sistema_rh     APP_DB_USER=...      APP_DB_PASSWORD=<fuerte>
SECRET_KEY=<64 caracteres: python -c "import secrets; print(secrets.token_hex(32))">
ADMIN_USERNAME=admin
ADMIN_PASSWORD=<mínimo 10 caracteres>      # solo para el primer arranque; BÓRRALA después
DB_HOST=... DB_PORT=... DB_NAME=... DB_USER=<usuario de solo lectura> DB_PASSWORD=...
CONTRATOS_DIR=E:\Docs_RRHH                # raíz de la unidad de RH (ver sección 5)
CONTRATOS_RUTA_RED=\\SERVIDOR\Docs_RRHH       # cómo la ven RH en sus PCs (solo se muestra)
TOKEN_MINUTES=60            # vida de cada token; se renueva solo mientras la persona trabaja
SESION_MAX_HORAS=12         # tope absoluto de una sesión, aunque se renueve
```

En producción el sistema **se niega a arrancar** con una `SECRET_KEY` corta o de ejemplo, y `seed.py` no crea el
administrador con una clave débil. Se oculta `/docs`, se añaden cabeceras de seguridad, las respuestas de la API no
se guardan en caché y el inicio de sesión se bloquea 15 minutos tras 5 intentos fallidos (por usuario y equipo).

> Después de crear al administrador, **borra `ADMIN_PASSWORD` del `.env`** y cambia la clave desde «Cambiar contraseña».

## 4. Datos limpios y primer día

1. La base nueva solo contiene lo que crea `seed.py`: las zonas y equipos DTS y **un** administrador. No hay vendedores ni datos de prueba.
2. Entra con el administrador y, en **Usuarios**, crea las cuentas de RH y DH con su rol:
   | Rol | Puede |
   |---|---|
   | Administrador | Todo, incluida la gestión de usuarios y el escaneo de la carpeta de contratos |
   | Desarrollo Humano / Analista DH | Registrar y editar vendedores, contratos, bajas, feriados, ver/adjuntar contratos en PDF y exportar |
   | Solo lectura | Ver vendedores, asistencia y rotación. **No ve los contratos en PDF** (son datos personales) |
3. Cargar los vendedores existentes (opcional, desde el Excel mensual de RRHH):
   ```powershell
   cd backend
   .\.venv\Scripts\python.exe importar_vendedores.py "RUTA\9. Septiembre.xlsx"            # simulación: solo informa
   .\.venv\Scripts\python.exe importar_vendedores.py "RUTA\9. Septiembre.xlsx" --aplicar  # carga de verdad
   ```
   Revisa el informe antes de aplicar (códigos repetidos, fechas dudosas). Ver `CHANGELOG.md`.
4. Los feriados nacionales y departamentales se generan solos; los «puentes» que decrete el Gobierno se cargan a mano en **Asistencia → Feriados**.

## 5. Contratos en la unidad compartida de RH

Estructura (la unidad del servidor, p. ej. `E:\Docs_RRHH`, que se comparte en la red):

```
Docs_RRHH\
└── Vendedores\
    └── NOMBRE DEL VENDEDOR\
        └── Contratos\
            ├── Contrato 2025.pdf
            └── Contrato 2026.pdf
```

- **`CONTRATOS_DIR=E:\Docs_RRHH`** en el `.env` (y `CONTRATOS_RUTA_RED=\\SERVIDOR\Docs_RRHH`, solo para mostrar la ruta a RH).
- **Los archivos se leen en vivo de la carpeta**: lo que RH copie ahí aparece en la ficha del vendedor sin hacer nada más. En la base solo se guarda el **nombre de la carpeta de cada vendedor** (nunca una ruta absoluta ni una dirección por archivo), así que no se rompe si cambia la letra de la unidad.
- **Vendedor nuevo**: al registrarlo, el sistema crea su carpeta `Vendedores\NOMBRE\Contratos`. Si la unidad no está disponible en ese momento, el alta se guarda igual y la carpeta se crea después (botón *Crear carpeta* en la ficha o *Crear las carpetas que faltan*).
- **Contratos nuevos**: en el alta del vendedor hay una zona *Suelta aquí el contrato en PDF*; en la ficha (*Contratos firmados*) también, para uno o varios archivos a la vez. Solo PDF, hasta 15 MB. Nunca se pisa un archivo existente (se agrega ` (2)`). Lo que RH deje directamente en la carpeta, en cualquier formato, también se lista.
- **Otros documentos a futuro**: se agregan como un tipo más (`CATEGORIAS` en `backend/app/services/carpetas.py`): cada tipo es una subcarpeta junto a `Contratos` y se muestra en la ficha con su propia zona para soltar archivos.
- **Quitar** un archivo no lo borra: lo aparta en `Docs_RRHH\_eliminados\NOMBRE\`.
- **Primer día — vincular lo que RH ya tiene**: en *Vendedores → Carpetas de contratos* (solo admin):
  1. *Crear las carpetas que faltan* crea la de cada vendedor vigente y reconoce las que RH ya armó cuando el nombre coincide (sin importar acentos ni mayúsculas).
  2. *Revisar nombres* lista las carpetas de RH que no coinciden con ningún vendedor (por ejemplo `TORREZ` en la carpeta y `TORRES` en el sistema) y propone el vendedor parecido para vincularlas con un clic. Si el nombre en el sistema tiene un error, corrígelo en la ficha; la carpeta ya vinculada no se pierde.
- Dos vendedores con el mismo nombre no comparten carpeta: la segunda lleva el código (`NOMBRE (4112)`).
- Los archivos se abren **solo a través del sistema** (con sesión y permisos), nunca por un enlace directo. Solo admin, DH y Analista DH los ven; «solo lectura» no.
- **Permisos de la unidad**: que escriban solo la cuenta del servicio y el equipo de RH; evita «Todos». Si RH abre los archivos directamente desde la red, la cuenta del servicio y RH deben compartir permiso sobre `Vendedores\`.
- **Respaldo**: incluye toda la unidad en la copia de seguridad diaria.

## 6. Seguridad y operación

- **HTTPS**: los datos son personales. Pon un proxy con certificado (Nginx; ver `deploy/DESPLIEGUE-WINDOWS-SERVER.md`). Con HTTPS agrega la cabecera `Strict-Transport-Security`.
- **Respaldos**: `pg_dump` diario de la base `sistema_rh` + la carpeta de contratos. Prueba una restauración al menos una vez.
- **Monitoreo**: `GET /api/health` devuelve 200 si el servicio y su base responden (úsalo en el monitor de la empresa).
- **Un solo proceso** (`--workers 1`): el bloqueo de intentos de inicio de sesión vive en memoria.
- **Usuarios**: cada persona su cuenta; desactiva (no elimines) a quien salga de RH. Al cambiar o restablecer una contraseña, o al desactivar la cuenta, se cierran sus sesiones abiertas.
- **Contraseñas**: mínimo 8 caracteres con letras y números. La que fija el administrador al crear o restablecer es **temporal**: la persona debe elegir la suya al ingresar.
- **Sesiones**: los tokens duran `TOKEN_MINUTES` y se renuevan solos con actividad; sin actividad vencen, y ninguna sesión pasa de `SESION_MAX_HORAS`. En *Usuarios → editar → Seguridad* el administrador puede cerrar las sesiones de alguien o desbloquear una cuenta; *Usuarios → Bitácora* muestra ingresos, fallos, bloqueos y cambios (tabla `auditoria`).
- **`SECRET_KEY`**: si se cambia, todas las sesiones abiertas se cierran. Guárdala fuera del repositorio.
- **BI**: el usuario del BI debe poder leer solo `dual.fact_detalle_pedidos`.

## 7. Actualizar a una versión nueva

1. Respaldar la base y la carpeta de contratos.
2. Detener el servicio, copiar los archivos nuevos (conserva `backend\.env`).
3. `.\deploy\windows\construir.ps1` y `.\deploy\windows\preparar-base.ps1` (el seed agrega columnas nuevas sin tocar los datos).
4. Iniciar el servicio y revisar `/api/health`.
5. Subir la versión en `frontend\src\changelog.ts` (al entrar, los usuarios verán las novedades).

## 8. Problemas frecuentes

| Síntoma | Causa probable |
|---|---|
| El servicio no arranca y habla de configuración insegura | `SECRET_KEY` corta/de ejemplo o `APP_DB_PASSWORD` débil |
| Asistencia dice «No se pudo consultar el BI» | Credenciales/red del BI (`DB_*`); ver `verificar_produccion.py` |
| «La unidad de contratos no está disponible» | La unidad/red no está conectada o la cuenta del servicio no tiene permiso |
| «Demasiados intentos fallidos» | Se bloquea 15 min por usuario y equipo; el administrador lo libera en *Usuarios → editar → Seguridad → Desbloquear* (o reiniciando el servicio) |
| Pantalla en blanco | Falta compilar el frontend (`construir.ps1`) |
