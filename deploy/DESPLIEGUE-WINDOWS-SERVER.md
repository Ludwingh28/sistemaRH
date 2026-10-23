# Despliegue — Windows Server + PM2 + Nginx

El sistema queda en **`http://IP-DEL-SERVIDOR/rh/`**, conviviendo con el BI (`/sistemabi/`).

```
PC de RH ──▶ Nginx :80 ─┬─ /sistemabi/  → BI (frontend en disco + Django  127.0.0.1:8000)   ← ya existe, no se toca
                        └─ /rh/         → Sistema RH (frontend en disco + FastAPI 127.0.0.1:8100, en PM2)
PostgreSQL (el mismo servicio, por localhost): base del BI  |  sistema_rh (nueva)
```

---

## 1. Requisitos (en el servidor)

Python 3.13 (en el PATH) · Node.js · Git · PM2 · Nginx · PostgreSQL. Todo menos Git ya lo tienes por el BI.

---

## 2. Base de datos

Con `psql` o pgAdmin, como `postgres`:

```sql
CREATE ROLE user_rh LOGIN PASSWORD '<clave-fuerte>';
CREATE DATABASE sistema_rh OWNER user_rh ENCODING 'UTF8';

-- Usuario de solo lectura para leer la asistencia del BI
CREATE ROLE rh_lector LOGIN PASSWORD '<otra-clave>';
GRANT CONNECT ON DATABASE <base-del-bi> TO rh_lector;
-- conéctate a <base-del-bi> y ejecuta:
GRANT USAGE ON SCHEMA dual TO rh_lector;
GRANT SELECT ON dual.fact_detalle_pedidos TO rh_lector;
```

> Ejecuta todo esto conectado como **`postgres`** (superusuario). Con otro usuario, PostgreSQL 16+ puede fallar con `must be able to SET ROLE "user_rh"`; en ese caso ejecuta antes `GRANT user_rh TO <tu_usuario>;`.

No hay que tocar `pg_hba.conf` ni el firewall: todo va por `localhost`.

---

## 3. Descargar y construir

```powershell
git clone https://github.com/Ludwingh28/sistemaRH.git C:\inetpub\cruzimex\SistemaRH
cd C:\inetpub\cruzimex\SistemaRH
.\deploy\windows\construir.ps1
```

`construir.ps1` crea el entorno de Python (`backend\.venv`), instala las dependencias y compila el frontend (`npm ci` + `npm run build`). El frontend queda en `frontend\dist`, ya preparado para la ruta `/rh/`.

> Si PowerShell bloquea el script: `Set-ExecutionPolicy -Scope Process Bypass` y vuelve a ejecutarlo.

---

## 4. Configurar `backend\.env`

Copia `backend\.env.example` como `backend\.env` y completa estos valores (todo por `localhost`):

```ini
ENTORNO=produccion

APP_DB_HOST=localhost
APP_DB_PORT=5432
APP_DB_NAME=sistema_rh
APP_DB_USER=user_rh
APP_DB_PASSWORD=<clave-fuerte>

DB_HOST=localhost
DB_PORT=5432
DB_NAME=<base-del-bi>
DB_USER=rh_lector
DB_PASSWORD=<otra-clave>

# genera una con: python -c "import secrets; print(secrets.token_hex(32))"
SECRET_KEY=<64-caracteres-aleatorios>

ADMIN_USERNAME=admin
ADMIN_PASSWORD=<minimo-10-caracteres>

CONTRATOS_DIR=E:\Docs_RRHH
CONTRATOS_RUTA_RED=\\SERVIDOR\Docs_RRHH
```

`CONTRATOS_RUTA_RED` es solo el texto que ve RH para ubicar la carpeta; `CONTRATOS_DIR` es la que el sistema usa de verdad.

---

## 5. Crear tablas y administrador

```powershell
.\deploy\windows\preparar-base.ps1
```

Termina con un informe `[OK] / [AVISO] / [FALLA]`. **No sigas mientras haya alguna `[FALLA]`.**
Después **borra la línea `ADMIN_PASSWORD`** de `backend\.env`.

---

## 6. Ponerlo en PM2

```powershell
cd C:\inetpub\cruzimex\SistemaRH
New-Item -ItemType Directory -Force logs | Out-Null
pm2 start deploy\windows\ecosystem.config.js
pm2 save
curl http://127.0.0.1:8100/api/health
```

- `pm2 status` debe mostrar **`sistema-rh` en `online`**, y el `curl` responder `{"estado":"ok",...}`.
- El archivo `ecosystem.config.js` ya define todo (Python del `.venv`, `127.0.0.1:8100`, un solo worker, logs en `logs\`). No lo modifiques salvo para cambiar el puerto.
- **Un solo worker, modo `fork`**: no uses `cluster` ni `instances > 1` (el bloqueo por intentos fallidos vive en memoria).
- Arranque con Windows: el mismo mecanismo que ya usas para el BI; solo hace falta el `pm2 save`.
- La cuenta que ejecuta PM2 necesita lectura y escritura en `E:\Docs_RRHH` y en `logs\`.

---

## 7. Nginx (convivir con el BI)

**Pega este bloque dentro de tu `server { listen 80; ... }`, antes de `location / { root C:/inetpub/www; ... }`.** No cambies nada de lo que ya tienes (el BI sigue igual).

```nginx
        # ==========================================================
        # SISTEMA RH  →  http://IP-DEL-SERVIDOR/rh/
        #   API      : FastAPI en 127.0.0.1:8100 (PM2)
        #   Frontend : C:/inetpub/cruzimex/SistemaRH/frontend/dist
        # ==========================================================

        # /rh/api/ debe ir ANTES de /rh/ (igual que en el BI)
        location /rh/api/ {
            # include rh-acceso.conf;     # ← quita el # para limitar por IP (sección 9)
            client_max_body_size 20m;     # contratos en PDF; sin esto Nginx limita a 1 MB

            proxy_pass         http://127.0.0.1:8100/api/;
            proxy_http_version 1.1;
            proxy_set_header Host              $host;
            proxy_set_header X-Real-IP         $remote_addr;
            proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_connect_timeout  60s;
            proxy_send_timeout     60s;
            proxy_read_timeout    120s;

            # los headers de seguridad ya los pones a nivel de server: no duplicarlos
            proxy_hide_header X-Frame-Options;
            proxy_hide_header X-Content-Type-Options;
            proxy_hide_header X-XSS-Protection;
        }

        # Archivos con hash (Vite): cache de 1 año
        location /rh/assets/ {
            # include rh-acceso.conf;
            alias C:/inetpub/cruzimex/SistemaRH/frontend/dist/assets/;
            expires 1y;
            add_header Cache-Control "public, immutable";
        }

        location = /rh { return 301 /rh/; }

        # Pantallas (React). index.html nunca se cachea
        location /rh/ {
            # include rh-acceso.conf;
            alias C:/inetpub/cruzimex/SistemaRH/frontend/dist/;
            index index.html;
            try_files $uri $uri/ /rh/index.html;
            add_header Cache-Control "no-cache, no-store, must-revalidate";
            add_header X-Frame-Options        "SAMEORIGIN" always;
            add_header X-Content-Type-Options "nosniff"    always;
        }
```

Valida y recarga **sin cortar el BI**:

```cmd
cd C:\nginx
nginx -t
nginx -s reload
```

`nginx -t` debe decir `syntax is ok`. Nunca uses `nginx -s stop` (cortaría el BI).

---

## 8. Probar

1. Abre `http://IP-DEL-SERVIDOR/rh/` → aparece el login.
2. Entra con `admin` y su clave. En **Usuarios**, crea las cuentas de RH/DH (cada una recibe una clave temporal y debe elegir la suya al ingresar).
3. Crea un vendedor de prueba y sube un PDF: debe aparecer en `E:\Docs_RRHH\<Regional>\Vendedores\<NOMBRE>\Contratos\` (por ejemplo `Santa Cruz\Vendedores\...`). Bórralo después.
4. Comprueba que el BI sigue funcionando: `http://IP-DEL-SERVIDOR/sistemabi/`.
5. **Alcance y permisos:** al crear cada usuario elige su alcance (*Nacional* o las regionales que verá). Luego, en *Usuarios → Roles y permisos* define qué puede hacer cada rol; en la edición de un usuario, la pestaña *Permisos* permite darle o quitarle algo puntual. Por defecto Jefe RRHH, Jefe DDHH y Analista DH hacen todo lo de RRHH y «Solo lectura» solo consulta.
6. **Documentación:** el panel *Documentación* lee las subcarpetas `Kardex`, `CI`, `Fachada` y `Ubicación` de la carpeta de cada vendedor (PDF). Si RH copia archivos directamente ahí, aparecen solos con un check. Un documento solo cuenta cuando su PDF está en el sistema, aunque exista en físico.
7. **Cargar los datos de RRHH:** en *Vendedores → Importar Excel* sube primero el Excel de septiembre y, cuando esté bien, el de octubre. Cada subida muestra antes un resumen; las filas con problemas no se cargan y quedan explicadas (corrígelas en el Excel y vuelve a subirlo: nada se duplica). Los meses siguientes se suben igual.
8. Primer día con datos reales: en *Vendedores → Carpetas de contratos* (solo admin) usa «Crear las carpetas que faltan» y «Revisar nombres» para vincular las carpetas que RH ya tiene.

### Crear las carpetas de los vendedores ya cargados

Desde el sistema: *Vendedores → Carpetas de contratos → Crear las carpetas que faltan* (solo con alcance nacional). Crea, para cada vendedor vigente, `<Regional>\Vendedores\<NOMBRE>\Contratos | Kardex | CI | Fachada | Ubicación`. No borra ni mueve nada y reutiliza las carpetas que RH ya tenga con el mismo nombre.

### Estructura de la unidad de contratos

```
E:\Docs_RRHH\
├── Santa Cruz\Vendedores\NOMBRE DEL VENDEDOR\Contratos\*.pdf
├── Cochabamba\Vendedores\...
└── La Paz\Vendedores\...        (El Alto también va en La Paz)
```
Si se abre otra regional, su carpeta se crea sola con su primer vendedor. Si RH ya tenía carpetas con el mismo nombre (aunque cambien mayúsculas o acentos), el sistema las reconoce. Un vendedor que cambia de regional **conserva su carpeta donde está** (el sistema no mueve archivos solo).

### Repetir las pruebas de carga (vaciar los vendedores)

Mientras pruebas la importación puedes dejar la base de vendedores en cero y volver a subir el Excel. Desde el servidor:

```cmd
cd C:\inetpub\cruzimex\sistemaRH\backend
.venv\Scripts\python.exe limpiar_vendedores.py                         (solo muestra qué borraría)
.venv\Scripts\python.exe limpiar_vendedores.py --confirmo --produccion (lo borra)
```

Borra vendedores, contratos e historial. **Conserva** usuarios, regionales/equipos, feriados y la bitácora, y no toca la base del BI. Las carpetas creadas en `E:\Docs_RRHH` (`<Regional>\Vendedores\...`) no se borran solas: elimínalas a mano si quieres empezar limpio.

---

## 9. Seguridad: IP pública y HTTP

Si el servidor tiene IP pública, todo viaja **sin cifrar** y cualquiera podría llegar a `/rh/`. Este sistema maneja datos personales: restrínge el acceso.

1. Crea `C:\nginx\conf\rh-acceso.conf` con tus redes reales:
   ```nginx
   allow  192.168.1.0/24;    # red de la oficina
   allow  10.8.0.0/24;       # VPN
   allow  127.0.0.1;
   deny   all;
   ```
2. Quita el `#` de las tres líneas `include rh-acceso.conf;` del bloque de la sección 7 y haz `nginx -t` + `nginx -s reload`.
3. Antes de activar el `deny all`, mira en `logs\cruzimex-access.log` qué IP ve Nginx para tus PCs (detrás de un router con NAT puede ser la del router) y ajusta los rangos.
4. Cuando tengas certificado y dominio, pasa también `/rh/` a HTTPS (mismos `location` dentro del `server` de 443).

---

## 10. Convivencia entre sistemas (BI, chatbot, RH…)

| Sistema | Puerto (solo `127.0.0.1`) | Proceso en PM2 | Ruta en Nginx |
|---|---|---|---|
| BI (Django) | 8000 | `cruzimex-bi` | `/sistemabi/` |
| Sistema RH (FastAPI) | 8100 | `sistema-rh` | `/rh/` |
| Chatbot (FastAPI) | 8200 (sugerido) | `chatbot-bi` (sugerido) | `/chatbot/` |

Para que no se pisen:
1. **Un `venv` por sistema** (nunca `pip install` en el Python global).
2. **Un puerto por sistema**, solo en `127.0.0.1`.
3. **Un proceso de PM2 y un `.env` por sistema.**
4. **No definas variables de entorno de todo Windows** con nombres como `DB_HOST`, `DB_USER`, `DB_PASSWORD` o `SECRET_KEY`: tienen prioridad sobre el `.env` y pisarían la configuración de otro sistema sin avisar.
5. **Una base y un usuario de PostgreSQL por sistema** (ya hecho en la sección 2).

Si el BI llama al chatbot, lo hace por `http://127.0.0.1:8200`, sin pasar por Nginx.

---

## 11. Actualizar

Respalda antes (sección 12). Luego, en el servidor:

```powershell
cd C:\inetpub\cruzimex\SistemaRH
git pull
```

| Cambió… | Haz además |
|---|---|
| **Frontend** (pantallas) | `cd frontend` → `npm ci` (solo si cambió `package.json`) → `npm run build` → `nginx -s reload` |
| **Backend** | `pm2 stop sistema-rh` → `.\backend\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt` → `.\backend\.venv\Scripts\python.exe backend\seed.py` (agrega columnas nuevas sin tocar datos) → `pm2 start sistema-rh` |
| **Ambos** | Las dos filas |

Tu `backend\.env` no se toca con `git pull` (no está en el repositorio).

---

## 12. Respaldos

- **Base:** `pg_dump -h localhost -U user_rh -Fc -f D:\backups\sistema_rh_AAAAMMDD.dump sistema_rh` (diario, con el Programador de tareas).
- **Contratos:** `E:\Docs_RRHH` dentro de la copia diaria del servidor.
- **Configuración:** una copia de `backend\.env` fuera del servidor (sobre todo `SECRET_KEY`).

---

## 13. Problemas frecuentes

| Síntoma | Causa y solución |
|---|---|
| `[FALLA]` en `preparar-base.ps1` | El informe dice cuál: normalmente clave/usuario de la base mal en `backend\.env` o falta `frontend\dist` (ejecuta `construir.ps1`) |
| `sistema-rh` en `errored` | `pm2 logs sistema-rh --lines 50`. Si habla de configuración insegura: `SECRET_KEY` corta o `APP_DB_PASSWORD` débil |
| Pantalla en blanco en `/rh/` | En F12: 404 de `/rh/assets/...` → el `alias` de Nginx apunta a otra carpeta o falta compilar; 404 de `/assets/...` → compilaste sin `frontend\.env.production` |
| Login aparece pero la API da 404 | Falta la barra final en `proxy_pass http://127.0.0.1:8100/api/;` o `/rh/api/` quedó después de `/rh/` |
| 502 Bad Gateway | `sistema-rh` no está `online` en `pm2 status` |
| 413 al subir un PDF | Falta `client_max_body_size 20m;` en `/rh/api/` |
| 403 desde una PC permitida | Su IP no está en `rh-acceso.conf` (mira el log de acceso de Nginx) |
| «La unidad de contratos no está disponible» | `CONTRATOS_DIR` mal escrito o la cuenta de PM2 sin permiso sobre `E:\Docs_RRHH` |
| Asistencia: «No se pudo consultar el BI» | Credenciales `DB_*` o falta el `GRANT` de la sección 2 |
| El puerto 8100 sigue ocupado tras un `pm2 stop` | `netstat -ano \| findstr :8100` y `taskkill /PID <número> /F` (puede quedar un proceso hijo del `venv`) |
| Configuración que no coincide con tu `.env` | Hay una variable de entorno de Windows con ese mismo nombre (regla 4 de la sección 10) |
| «Demasiados intentos fallidos» | El administrador desbloquea en *Usuarios → editar → Seguridad* |
| Siguen viéndose pantallas viejas | `Ctrl + F5` |
