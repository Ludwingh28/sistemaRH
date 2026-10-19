// Sistema RH bajo PM2 (Windows).  Desde la raíz del proyecto:  pm2 start deploy\windows\ecosystem.config.js
// Escucha solo en 127.0.0.1: Nginx es el único que llega al backend.
const path = require('path')

const raiz = path.resolve(__dirname, '..', '..')
const backend = path.join(raiz, 'backend')
const logs = path.join(raiz, 'logs')

module.exports = {
  apps: [
    {
      name: 'sistema-rh',
      cwd: backend, // aquí se lee backend\.env
      script: path.join(backend, '.venv', 'Scripts', 'python.exe'),
      // Un solo proceso (--workers 1): el límite de intentos de inicio de sesión vive en memoria.
      args: '-m uvicorn app.main:app --host 127.0.0.1 --port 8100 --workers 1 --proxy-headers --no-server-header',
      interpreter: 'none', // no es un script de Node: se ejecuta tal cual
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      min_uptime: '10s',
      max_restarts: 10,
      restart_delay: 5000,
      env: { PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1' },
      out_file: path.join(logs, 'salida.log'),
      error_file: path.join(logs, 'error.log'),
      merge_logs: true,
      time: true,
    },
  ],
}
