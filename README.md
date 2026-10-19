# Sistema RH · Canal DTS — Cruzimex

Gestión de vendedores del canal DTS: contratos y renovaciones, asistencia (a partir de las preventas del BI), panel de rotación, usuarios y seguridad, y carpeta de contratos en PDF.

- **Backend:** FastAPI + SQLAlchemy 2 + PostgreSQL (`backend/`)
- **Frontend:** React 19 + Vite + Tailwind v4 (`frontend/`)
- **Versión actual y novedades:** `CHANGELOG.md` (técnico) y `frontend/src/changelog.ts` (para usuarios)

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

Windows Server + Nginx: **`deploy/DESPLIEGUE-WINDOWS-SERVER.md`** (backend con PM2, PostgreSQL por localhost, publicado en `/rh/`).
Variante de un solo proceso y puerto: `deploy/README-DESPLIEGUE.md`.

En el servidor el frontend se compila con `npm run build`; `frontend/.env.production` fija la ruta pública (`/rh/`).

## Qué NO está en el repositorio

Los archivos `.env` (claves y conexiones), los datos de RRHH (`recurses/`, Excel, `.pbix`, PDF), los contratos, `.venv`, `node_modules`, `frontend/dist` y los logs. Cada entorno crea su propio `backend/.env` a partir de `backend/.env.example`.
