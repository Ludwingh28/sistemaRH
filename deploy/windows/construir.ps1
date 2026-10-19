# Prepara el sistema para producción en Windows: dependencias del backend y frontend compilado.
# Ejecutar desde la carpeta raíz del proyecto:  .\deploy\windows\construir.ps1
$ErrorActionPreference = "Stop"
$raiz = Resolve-Path "$PSScriptRoot\..\.."

Write-Host "== Backend: entorno virtual y dependencias ==" -ForegroundColor Cyan
Set-Location "$raiz\backend"
if (-not (Test-Path ".venv")) { python -m venv .venv }
& .\.venv\Scripts\python.exe -m pip install --upgrade pip
& .\.venv\Scripts\python.exe -m pip install -r requirements.txt

Write-Host "== Frontend: compilación ==" -ForegroundColor Cyan
Set-Location "$raiz\frontend"
npm ci
npm run build

Write-Host "`nListo. Siguiente paso: configurar backend\.env y ejecutar .\deploy\windows\preparar-base.ps1" -ForegroundColor Green
