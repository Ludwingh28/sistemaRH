import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    // Ruta pública donde se sirve el sistema. Por defecto la raíz; `npm run build:rh` lo compila para /rh/ (ver .env.rh).
    base: env.VITE_BASE || '/',
    plugins: [react(), tailwindcss()],
    // Sin puerto fijo: si 5173 está ocupado, Vite toma el siguiente libre.
    server: {
      proxy: { '/api': env.API_URL || 'http://127.0.0.1:8000' },
    },
  }
})
