# Despliegue en Windows Server 2022 (nativo, con Nginx)

Instalación nativa del backend (FastAPI) administrado con **PM2**, conviviendo con el BI (Django) y el chatbot (FastAPI), todos detrás del **Nginx** que ya tienes. El sistema se publica en `http://IP-DEL-SERVIDOR/rh/`.

## 1. Resumen

- El backend corre **directo en Windows**, administrado con **PM2** (igual que tus otros sistemas), sin contenedores.
- PostgreSQL por **`localhost`** (la misma instancia del BI, otra base): no hay que abrir PostgreSQL a la red ni tocar `pg_hba.conf`.
- `E:\Docs_RRHH` es una partición local: el backend la lee y escribe directo.
- Nginx (el que ya tienes) publica el frontend y reenvía `/rh/api/` al backend.
- El aislamiento entre sistemas (BI, chatbot, RH…) se logra con un `venv`, un puerto, un proceso de PM2 y un `.env` propios por sistema (sección 8).

**Único punto a vigilar:** las variables de entorno **de todo el sistema** (sección 8, regla 4).

---

## 2. Cómo queda todo

```
 PC de RH ──http://IP-DEL-SERVIDOR/rh/──▶ nginx :80  (público; es lo único expuesto)
                                         ├─ /sistemabi/      → frontend BI (disco)        + /sistemabi/api/ → Django    127.0.0.1:8000
                                         ├─ /rh/             → frontend RH (disco)        + /rh/api/        → FastAPI   127.0.0.1:8100   ← este sistema
                                         └─ /chatbot/ …      → (cuando lo integres)                         → FastAPI   127.0.0.1:8200

 PostgreSQL (un solo servicio, localhost):   BI  |  sistema_rh  |  (chatbot, si usa base)
 E:\Docs_RRHH  ← lo lee/escribe el proceso sistema-rh
```

**Tabla de puertos** (anótala; cada sistema nuevo toma el siguiente y **solo escucha en `127.0.0.1`**):

| Sistema | Puerto | Proceso en PM2 |
|---|---|---|
| BI (Django) | 8000 | el que ya tienes |
| **Sistema RH (FastAPI)** | **8100** | `sistema-rh` |
| Chatbot (FastAPI) | 8200 (sugerido) | `chatbot-bi` (sugerido) |

---

## 3. Requisitos

| Cosa | Detalle |
|---|---|
| Python 3.13 | Instalado **para todos los usuarios** (`C:\Program Files\Python313`), con "Add to PATH". Si ya lo usas para el chatbot, sirve el mismo |
| Node.js | Ya lo tienes (compilas el BI con él) |
| PM2 | Ya lo tienes (administra tus otros sistemas). Debe estar configurado para arrancar con Windows, igual que para los demás |
| Nginx | El que ya tienes (`C:\nginx`) |
| PostgreSQL | El que ya tienes |

---

## 4. Base de datos (la misma instancia, por `localhost`)

Con `psql` o pgAdmin, como `postgres`:

```sql
-- Base propia del sistema (nueva y vacía = producción limpia)
CREATE ROLE user_rh LOGIN PASSWORD '<clave-fuerte>';
CREATE DATABASE sistema_rh OWNER user_rh ENCODING 'UTF8';

-- Usuario de solo lectura para la asistencia (lee del BI; nunca escribe)
CREATE ROLE rh_lector LOGIN PASSWORD '<otra-clave>';
GRANT CONNECT ON DATABASE <base-del-bi> TO rh_lector;
-- conectado a <base-del-bi>:
GRANT USAGE ON SCHEMA dual TO rh_lector;
GRANT SELECT ON dual.fact_detalle_pedidos TO rh_lector;
```

- No hay que tocar `pg_hba.conf` ni `postgresql.conf`: Django ya se conecta por `localhost`, así que la regla `127.0.0.1` ya existe. (Si `user_rh` no puede conectar, revisa que haya una línea `host all all 127.0.0.1/32 scram-sha-256` —o `md5`— y recarga PostgreSQL.)
- `user_rh` **no** tiene acceso a la base del BI, y `rh_lector` **no** tiene acceso a `sistema_rh`: cada sistema ve solo lo suyo.

---

## 5. Instalar el sistema

El proyecto vive en `C:\inetpub\cruzimex\SistemaRH` (igual que el BI).

### 5.1 Copiar y preparar
1. Copia la carpeta `sistemaRH` a `C:\inetpub\cruzimex\SistemaRH` (sin `node_modules`, `.venv` ni tu `backend\.env`).
2. Desde la raíz del proyecto, en PowerShell:
   ```powershell
   cd C:\inetpub\cruzimex\SistemaRH
   .\deploy\windows\construir.ps1
   ```
   Crea `backend\.venv` (el entorno **propio** de este sistema), instala las dependencias fijadas en `requirements.txt` y compila el frontend (`npm ci` + `npm run build`, que lee `frontend\.env.production` y deja todo apuntando a `/rh/`).

### 5.2 Configurar `backend\.env`
Copia `backend\.env.example` como `backend\.env` y completa (todo por `localhost`):

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

SECRET_KEY=<64 caracteres: python -c "import secrets; print(secrets.token_hex(32))">
TOKEN_MINUTES=60
SESION_MAX_HORAS=12

ADMIN_USERNAME=admin
ADMIN_PASSWORD=<minimo-10-caracteres>      # solo para el primer arranque; BÓRRALA después

CONTRATOS_DIR=E:\Docs_RRHH
CONTRATOS_RUTA_RED=\\SERVIDOR\Docs_RRHH     # cómo la ven RH en sus PCs (solo se muestra)
```

Protege el archivo (contiene claves):
```powershell
icacls C:\inetpub\cruzimex\SistemaRH\backend\.env /inheritance:r /grant:r "Administrators:F" "SYSTEM:F"
```

### 5.3 Crear tablas, administrador y revisar
```powershell
.\deploy\windows\preparar-base.ps1
```
Termina con un informe `[OK] / [AVISO] / [FALLA]`. **No sigas mientras haya alguna `[FALLA]`.** Después **borra `ADMIN_PASSWORD` de `backend\.env`**.

---

## 6. Ponerlo en PM2 (arranca solo)

El proyecto trae el archivo `deploy\windows\ecosystem.config.js`, que ya define el proceso `sistema-rh` (usa el Python del `.venv` del propio proyecto, escucha solo en `127.0.0.1:8100`, **un solo worker** y deja los logs en `logs\`).

```powershell
cd C:\inetpub\cruzimex\SistemaRH
New-Item -ItemType Directory -Force logs | Out-Null
pm2 start deploy\windows\ecosystem.config.js
pm2 save                                   # recuerda la lista para que vuelva a arrancar con el servidor
```

- **Arranque con Windows:** usa el mismo mecanismo que ya tienes para los demás sistemas (el que hayas configurado: `pm2-windows-startup`, `pm2-installer`, una tarea programada…). `pm2 save` es lo único que se agrega por sistema.
- **Un solo proceso** (`--workers 1`): el bloqueo de intentos de inicio de sesión vive en memoria. En el `ecosystem` ya está `instances: 1` en modo `fork`; no uses modo `cluster`.
- **`127.0.0.1`**: el backend **solo** lo alcanza Nginx; no queda expuesto a la red.
- **Prueba:** `curl http://127.0.0.1:8100/api/health` → `{"estado":"ok","version":"0.0.0.2"}` y `pm2 status` debe mostrar `sistema-rh` en `online`.
- **Logs:** `pm2 logs sistema-rh`; los archivos están en `logs\salida.log` y `logs\error.log`. Para que no crezcan sin límite: `pm2 install pm2-logrotate` (una vez para todo PM2).
- **Si el puerto 8100 queda ocupado tras detener/reiniciar** (`netstat -ano | findstr :8100` sigue mostrando un proceso): en Windows el `python.exe` de un `venv` puede lanzar un proceso hijo. PM2 normalmente cierra todo el árbol, pero si queda uno huérfano: `taskkill /PID <número> /F`.
- **Permisos:** el backend corre con la cuenta que ejecuta PM2. Esa cuenta necesita lectura y escritura en `E:\Docs_RRHH`, y escritura en la carpeta `logs\` del proyecto. Si PM2 corre como administrador o como *Sistema local*, ya los tiene; si usas una cuenta dedicada, otórgalos: `icacls E:\Docs_RRHH /grant "CUENTA:(OI)(CI)M"`.
- **PostgreSQL:** PM2 no puede "esperar" a un servicio de Windows. Si el servidor reinicia y el backend arranca antes que PostgreSQL, las primeras peticiones fallan y luego funcionan solas (se reconecta); no hace falta reiniciarlo.

---

## 7. Nginx

Agrega este bloque dentro del `server { listen 80; server_name IP-DEL-SERVIDOR; ... }`, **antes** de `location / { root C:/inetpub/www; ... }`, junto a los del BI. No cambies nada de lo existente.

```nginx
        # ==========================================================
        # SISTEMA RH
        #   Backend  → FastAPI (proceso sistema-rh de PM2) en 127.0.0.1:8100
        #   Frontend → archivos de C:/inetpub/cruzimex/SistemaRH/frontend/dist
        #   http://IP-DEL-SERVIDOR/rh/
        # ==========================================================

        # IMPORTANTE: /rh/api/ debe estar ANTES de /rh/ (igual que en el BI)
        location /rh/api/ {
            # include rh-acceso.conf;     # ← quita el # para limitar por IP (ver 7.1)

            client_max_body_size 20m;     # IMPRESCINDIBLE: por defecto Nginx limita a 1 MB y los PDF de contratos fallarían

            proxy_pass         http://127.0.0.1:8100/api/;
            proxy_http_version 1.1;

            proxy_set_header Host              $host;
            proxy_set_header X-Real-IP         $remote_addr;
            proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;

            proxy_connect_timeout  60s;
            proxy_send_timeout     60s;
            proxy_read_timeout    120s;

            # Los headers de seguridad ya los pones a nivel de server: se quitan los del backend para no duplicarlos
            proxy_hide_header X-Frame-Options;
            proxy_hide_header X-Content-Type-Options;
            proxy_hide_header X-XSS-Protection;
        }

        # Archivos con hash (Vite los renombra en cada build): se pueden cachear 1 año
        location /rh/assets/ {
            # include rh-acceso.conf;
            alias C:/inetpub/cruzimex/SistemaRH/frontend/dist/assets/;
            expires 1y;
            add_header Cache-Control "public, immutable";
        }

        location = /rh { return 301 /rh/; }

        # Pantallas (React). index.html nunca se cachea: es el punto de entrada y cambia con cada build
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

Notas:
- Los bloques de `/rh/assets/` y `/rh/` repiten los *headers* porque en Nginx, si un `location` define sus propios `add_header`, deja de heredar los del `server`.
- No hay `location` anidados a propósito: con `alias` los anidados no heredan la ruta y darían 404.

Recarga sin cortar el BI (en otra consola, como siempre):
```cmd
cd C:\nginx
nginx -t              (debe decir «syntax is ok»)
nginx -s reload       (no uses «stop»)
```

### 7.1 ⚠️ Seguridad: IP pública, HTTP sin cifrar
`IP-DEL-SERVIDOR` parece una **IP pública** y hoy todo va por HTTP. El Sistema RH maneja datos personales (contratos, carnets, teléfonos) y contraseñas. Recomendación, de mejor a peor:
1. **Limitar `/rh/` a la red interna y la VPN**: crea `C:\nginx\conf\rh-acceso.conf` con
   ```nginx
   allow  192.168.1.0/24;    # red interna de la oficina
   allow  10.8.0.0/24;       # VPN
   allow  127.0.0.1;
   deny   all;
   ```
   y quita el `#` de las líneas `include rh-acceso.conf;` de los tres bloques. Si las PCs llegan por un router con NAT, Nginx verá la IP del router y no la de cada PC: mira `logs\cruzimex-access.log` para ver qué IP aparece y ajusta **antes** de activar el `deny all`.
2. **HTTPS**, cuando tengas certificado y un nombre de dominio (tu bloque comentado al final del `nginx.conf` ya lo contempla; los mismos `location` sirven en el `server` de 443).
3. Abierto a Internet por HTTP: **no recomendado** para este sistema.

---

## 8. Que los 3 (o más) sistemas no se pisen: 4 reglas

| # | Regla | Por qué |
|---|---|---|
| 1 | **Un `venv` por sistema** (`backend\.venv` dentro de cada proyecto). **Nunca** `pip install` en el Python global | Cada sistema tiene sus propias versiones de FastAPI, SQLAlchemy, etc. El chatbot puede usar otras sin afectar a RH |
| 2 | **Un puerto por sistema, solo en `127.0.0.1`**, anotado en la tabla de la sección 2 | Evita choques; Nginx es lo único público |
| 3 | **Un proceso de PM2 por sistema**, con nombre propio (`sistema-rh`, `chatbot-bi`…), su `cwd`, su `.env` y sus logs | Se inician, detienen y actualizan por separado; si uno falla los demás siguen |
| 4 | **No definas variables de entorno de todo el sistema** con nombres como `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `SECRET_KEY`, `ENTORNO`… (Panel de control → Variables de entorno) | Este sistema lee su configuración de `backend\.env`, **pero una variable del sistema operativo tiene prioridad sobre el `.env`**. Si el BI o el chatbot definieran `DB_HOST` globalmente, pisarían la de RH sin avisar. Toda configuración debe ir en el `.env` de cada proyecto |

Además:
- **Bases y usuarios separados** en PostgreSQL (sección 4): cada sistema solo ve lo suyo. Los nombres de las tablas pueden repetirse sin problema porque están en bases distintas.
- **Python**: si algún día actualizas Python a otra versión menor (3.13 → 3.14), **no desinstales** la anterior sin recrear los `venv` de cada sistema (borra `.venv` y vuelve a ejecutar `construir.ps1`), porque un `venv` depende del Python con el que se creó. Mientras no cambies de versión, nada pasa.
- **Cada sistema, su propio `SECRET_KEY`** (las sesiones de uno no valen en otro).
- **Conexiones a PostgreSQL**: cada sistema abre unas pocas (RH: ~5–15). Con 3 sistemas queda muy por debajo del `max_connections` por defecto (100).
- **Nginx**: cada sistema vive bajo su propia ruta (`/sistemabi/`, `/rh/`, `/chatbot/`), con su `location .../api/` **antes** de la del frontend.
- El **chatbot** que se integrará al BI es independiente: tendrá su propio puerto (8200), proceso de PM2, `venv` y `.env`. Si el BI lo llama, lo hace por `http://127.0.0.1:8200`, sin pasar por Nginx.

---

## 9. Operación y actualizaciones

| Quiero… | Comando (PowerShell administrador) |
|---|---|
| Ver estado | `pm2 status` |
| Reiniciar / detener / iniciar | `pm2 restart sistema-rh` / `pm2 stop sistema-rh` / `pm2 start sistema-rh` |
| Ver errores | `pm2 logs sistema-rh --lines 50` (o `logs\error.log`) |
| Salud del sistema | `curl http://127.0.0.1:8100/api/health` |

**Actualizar a una versión nueva** (respalda antes la base y `E:\Docs_RRHH`):

| Cambió… | Qué hacer |
|---|---|
| **Solo el frontend** | Copia `frontend\src`, `cd frontend` → `npm run build` → `nginx -s reload`. No se toca PM2 |
| **El backend** | `pm2 stop sistema-rh` → copia `backend\` (conserva tu `.env` y `.venv`) → `.\backend\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt` → `.\backend\.venv\Scripts\python.exe backend\seed.py` (agrega columnas/tablas nuevas sin tocar datos) → `pm2 start sistema-rh`. No se toca Nginx |
| **Ambos** | Los dos pasos |

Sube también la versión en `frontend\src\changelog.ts` para que los usuarios vean las novedades.

---

## 10. Respaldos

| Qué | Cómo |
|---|---|
| Base `sistema_rh` | `pg_dump -h localhost -U user_rh -Fc -f D:\backups\sistema_rh_AAAAMMDD.dump sistema_rh` (diario, con el Programador de tareas) |
| Contratos | `E:\Docs_RRHH` dentro de la copia diaria del servidor |
| Configuración | Una copia segura de `backend\.env` (sobre todo `SECRET_KEY`) fuera del servidor |

Prueba una restauración al menos una vez.

---

## 11. Problemas frecuentes

| Síntoma | Causa probable |
|---|---|
| El proceso no arranca o está en `errored` en `pm2 status` | Mira `pm2 logs sistema-rh` o `logs\error.log`. Si habla de configuración insegura: `SECRET_KEY` corta o `APP_DB_PASSWORD` débil |
| `password authentication failed` / `connection refused` | Usuario o clave mal en `backend\.env`, o PostgreSQL detenido |
| «La unidad de contratos no está disponible» | `CONTRATOS_DIR` mal escrito o la cuenta que ejecuta PM2 sin permiso sobre `E:\Docs_RRHH` |
| Asistencia dice «No se pudo consultar el BI» | Credenciales `DB_*` del usuario de solo lectura, o falta el `GRANT` de la sección 4 |
| Configuración "rara" que no coincide con tu `.env` | Hay una variable de entorno del sistema con el mismo nombre (regla 4 de la sección 8) |
| Pantalla en blanco en `/rh/` | Falta `npm run build`, `frontend\.env.production` sin `VITE_BASE=/rh/`, o el `alias` de Nginx apunta a otra carpeta. En F12: 404 de `/rh/assets/...` → el `alias`; 404 de `/assets/...` → falta la base `/rh/` |
| Login aparece pero la API da error 404 en `/rh/api/...` | Falta la barra final en `proxy_pass http://127.0.0.1:8100/api/;` o `/rh/api/` quedó después de `/rh/` |
| 502 Bad Gateway | `sistema-rh` no está `online` en `pm2 status` |
| 413 al subir un PDF | Falta `client_max_body_size 20m;` en `/rh/api/` |
| 403 desde una PC permitida | Su IP no está en `rh-acceso.conf` (mira el log de acceso de Nginx) |
| «Demasiados intentos fallidos» | El administrador desbloquea en *Usuarios → editar → Seguridad*, o `pm2 restart sistema-rh` |
| Un puerto ya está en uso | `netstat -ano \| findstr :8100`; cambia el puerto en el `ecosystem.config.js` **y** en Nginx |

---

## 12. Primer día — lista de comprobación

1. Base `sistema_rh` creada y roles con permisos (sección 4).
2. `construir.ps1` y `preparar-base.ps1` sin `[FALLA]`; `ADMIN_PASSWORD` borrada del `.env`.
3. Proceso `sistema-rh` en `online` (`pm2 status`), `pm2 save` ejecutado, y `curl http://127.0.0.1:8100/api/health` responde.
4. Bloque de Nginx pegado, `nginx -t` correcto, `nginx -s reload`.
5. `http://IP-DEL-SERVIDOR/rh/` abre el login; entras con `admin`; creas las cuentas de RH/DH (reciben clave temporal).
6. Subes un PDF de prueba y aparece en `E:\Docs_RRHH\Vendedores\...`.
7. El BI (`/sistemabi/`) sigue funcionando igual.
8. Restricción por IP activada (sección 7.1).
