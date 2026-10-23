# Sistema RH · Canal DTS — Cruzimex

Gestión de vendedores del canal DTS: contratos y renovaciones, asistencia (a partir de las preventas del BI), panel de rotación, usuarios y seguridad, y carpeta de contratos en PDF.

- **Backend:** FastAPI + SQLAlchemy 2 + PostgreSQL (`backend/`)
- **Frontend:** React 19 + Vite + Tailwind v4 (`frontend/`)
- **Versión actual e historial de cambios:** `CHANGELOG.md` (técnico) y `frontend/src/changelog.ts` (en lenguaje simple). No hay un panel de Novedades en el menú; al subir de versión, la ventana «Novedades» aparece una vez al ingresar. La versión también se ve en el menú lateral y en el login

## Estructura

```
backend/    API (app/), seed.py (tablas + admin), verificar_produccion.py, importar_vendedores.py
frontend/   pantallas (src/), compilación en frontend/dist (no se versiona)
deploy/     guías y scripts de despliegue
```

## Desarrollo local

```powershell
# Backend
cd backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
copy .env.example .env          # y completa los valores
.\.venv\Scripts\python.exe seed.py
.\.venv\Scripts\python.exe -m uvicorn app.main:app --port 8000

# Frontend (otra consola)
cd frontend
copy .env.example .env
npm install
npm run dev
```

## Despliegue

Paso a paso en Windows Server con PM2 y Nginx (conviviendo con el BI): **`deploy/DESPLIEGUE-WINDOWS-SERVER.md`**.
El frontend se compila con `npm run build`; `frontend/.env.production` fija la ruta pública (`/rh/`).

## Qué NO está en el repositorio

Los archivos `.env` (claves y conexiones), los datos de RRHH (`recurses/`, Excel, `.pbix`, PDF), los contratos, `.venv`, `node_modules`, `frontend/dist` y los logs. Cada entorno crea su propio `backend/.env` a partir de `backend/.env.example`.
