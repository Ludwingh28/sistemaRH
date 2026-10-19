# Crea las tablas, la estructura DTS y el administrador, y revisa que todo esté listo.
# Requiere backend\.env con ENTORNO=produccion. Ejecutar:  .\deploy\windows\preparar-base.ps1
$ErrorActionPreference = "Stop"
Set-Location "$PSScriptRoot\..\..\backend"
$env:PYTHONIOENCODING = "utf-8"
& .\.venv\Scripts\python.exe seed.py
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& .\.venv\Scripts\python.exe verificar_produccion.py
exit $LASTEXITCODE
