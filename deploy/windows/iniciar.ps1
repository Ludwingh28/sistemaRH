# Inicia el backend a mano (prueba). En producción lo administra PM2 (deploy\windows\ecosystem.config.js): ver deploy\DESPLIEGUE-WINDOWS-SERVER.md
# Escucha solo en 127.0.0.1: Nginx es el único que llega a él. Ejecutar:  .\deploy\windows\iniciar.ps1
param([int]$Puerto = 8100, [string]$Direccion = "127.0.0.1")
$ErrorActionPreference = "Stop"
Set-Location "$PSScriptRoot\..\..\backend"
$env:PYTHONIOENCODING = "utf-8"
# Un solo proceso: el límite de intentos de inicio de sesión vive en memoria.
& .\.venv\Scripts\python.exe -m uvicorn app.main:app --host $Direccion --port $Puerto --workers 1 --proxy-headers --no-server-header
