import {
  CalendarCheck, KeyRound, LogOut, Megaphone, Menu, PanelLeftClose, PanelLeftOpen, ShieldUser, TrendingDown, Users, X,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { NavLink, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import { useAuth } from './auth'
import logo from './assets/logo.png'
import { VERSION_ACTUAL } from './changelog'
import { ROL_LABEL } from './components/ui'
import WhatsNewModal from './components/WhatsNewModal'
import Asistencia from './pages/Asistencia'
import SesionAviso from './components/SesionAviso'
import CambiarClave from './pages/CambiarClave'
import Login from './pages/Login'
import Novedades from './pages/Novedades'
import Rotacion from './pages/Rotacion'
import Usuarios from './pages/Usuarios'
import Vendedores from './pages/Vendedores'

const LS_SIDEBAR = 'rh_sidebar_colapsado'

const leerColapsado = () => {
  try {
    return localStorage.getItem(LS_SIDEBAR) === '1'
  } catch {
    return false
  }
}

function Item({ to, icono: Icono, texto, colapsado }: { to: string; icono: LucideIcon; texto: string; colapsado: boolean }) {
  return (
    <NavLink
      to={to}
      title={colapsado ? texto : undefined}
      className={({ isActive }) =>
        `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
          colapsado ? 'lg:justify-center lg:px-0' : ''
        } ${isActive ? 'bg-white/10 text-white' : 'text-navy-300 hover:bg-white/5 hover:text-white'}`
      }
    >
      <Icono size={18} className="shrink-0" />
      <span className={colapsado ? 'lg:hidden' : ''}>{texto}</span>
    </NavLink>
  )
}

function Layout() {
  const { user, loading, logout } = useAuth()
  const { pathname } = useLocation()
  const [colapsado, setColapsado] = useState(leerColapsado)
  const [abierto, setAbierto] = useState(false) // menú deslizable en pantallas chicas

  useEffect(() => setAbierto(false), [pathname])
  useEffect(() => {
    try {
      localStorage.setItem(LS_SIDEBAR, colapsado ? '1' : '0')
    } catch {
      /* sin almacenamiento: no se recuerda, no es crítico */
    }
  }, [colapsado])

  if (loading) return <p className="p-8 text-navy-500">Cargando…</p>
  if (!user) return <Navigate to="/login" replace />
  // Cuenta nueva o con contraseña restablecida por un administrador: debe elegir la suya antes de usar el sistema.
  if (user.debe_cambiar_clave) return <CambiarClave obligatorio />

  const iniciales = user.nombre
    .split(' ')
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase()
  const oculto = colapsado ? 'lg:hidden' : '' // textos que desaparecen con el menú colapsado

  return (
    <div className="min-h-screen lg:flex">
      {/* Barra superior (solo pantallas chicas) */}
      <header className="sticky top-0 z-30 flex items-center gap-3 bg-navy-900 px-4 py-3 text-white lg:hidden">
        <button onClick={() => setAbierto(true)} aria-label="Abrir menú" className="rounded-lg p-1.5 hover:bg-white/10">
          <Menu size={22} />
        </button>
        <img src={logo} alt="" className="h-7 w-auto" />
        <p className="text-sm font-semibold">Cruzimex · Sistema RH</p>
      </header>

      {abierto && <div className="fixed inset-0 z-40 bg-black/50 lg:hidden" onClick={() => setAbierto(false)} aria-hidden />}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-64 shrink-0 flex-col overflow-y-auto bg-navy-900 p-3 transition-[transform,width] duration-200
          lg:sticky lg:top-0 lg:z-auto lg:h-screen lg:translate-x-0 ${abierto ? 'translate-x-0' : '-translate-x-full'}
          ${colapsado ? 'lg:w-[4.5rem]' : 'lg:w-60'}`}
      >
        <div className={`mb-6 flex items-center gap-3 px-1 pt-1 ${colapsado ? 'lg:flex-col lg:gap-2' : ''}`}>
          <img src={logo} alt="" className="h-9 w-auto shrink-0" />
          <div className={`min-w-0 flex-1 leading-tight ${oculto}`}>
            <p className="text-sm font-semibold text-white">Cruzimex</p>
            <p className="truncate text-xs text-navy-300">Sistema RH · Canal DTS</p>
          </div>
          <button
            onClick={() => setColapsado((c) => !c)}
            title={colapsado ? 'Expandir menú' : 'Contraer menú'}
            aria-label={colapsado ? 'Expandir menú' : 'Contraer menú'}
            className="hidden rounded-lg p-1.5 text-navy-300 transition hover:bg-white/10 hover:text-white lg:block"
          >
            {colapsado ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
          </button>
          <button onClick={() => setAbierto(false)} aria-label="Cerrar menú" className="rounded-lg p-1.5 text-navy-300 hover:bg-white/10 lg:hidden">
            <X size={20} />
          </button>
        </div>

        <nav className="flex flex-col gap-1">
          <Item to="/vendedores" icono={Users} texto="Vendedores" colapsado={colapsado} />
          <Item to="/asistencia" icono={CalendarCheck} texto="Asistencia" colapsado={colapsado} />
          <Item to="/rotacion" icono={TrendingDown} texto="Rotación" colapsado={colapsado} />
          {user.rol === 'admin' && <Item to="/usuarios" icono={ShieldUser} texto="Usuarios" colapsado={colapsado} />}
          <Item to="/novedades" icono={Megaphone} texto="Novedades" colapsado={colapsado} />
        </nav>

        <div className="mt-auto border-t border-white/10 pt-4">
          <div className={`flex items-center gap-3 px-1 ${colapsado ? 'lg:justify-center' : ''}`} title={colapsado ? user.nombre : undefined}>
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-navy-700 text-xs font-semibold text-white">
              {iniciales}
            </div>
            <div className={`min-w-0 leading-tight ${oculto}`}>
              <p className="truncate text-sm font-medium text-white">{user.nombre}</p>
              <p className="text-xs text-navy-300">{ROL_LABEL[user.rol]}</p>
            </div>
          </div>
          <div className="mt-2 flex flex-col gap-1">
            <Item to="/cuenta/contrasena" icono={KeyRound} texto="Cambiar contraseña" colapsado={colapsado} />
            <button
              onClick={logout}
              title={colapsado ? 'Cerrar sesión' : undefined}
              className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-navy-300 transition hover:bg-white/5 hover:text-white ${colapsado ? 'lg:justify-center lg:px-0' : ''}`}
            >
              <LogOut size={18} className="shrink-0" />
              <span className={oculto}>Cerrar sesión</span>
            </button>
          </div>
          <p className={`mt-2 px-3 text-[11px] text-navy-500 ${oculto}`}>Versión {VERSION_ACTUAL}</p>
        </div>
      </aside>

      <main className="min-w-0 flex-1 px-4 py-5 sm:px-6 lg:px-8 lg:py-8 xl:px-10">
        <Outlet />
      </main>
      <SesionAviso />
      <WhatsNewModal />
    </div>
  )
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<Layout />}>
        <Route path="/vendedores" element={<Vendedores />} />
        <Route path="/asistencia" element={<Asistencia />} />
        <Route path="/rotacion" element={<Rotacion />} />
        <Route path="/usuarios" element={<Usuarios />} />
        <Route path="/novedades" element={<Novedades />} />
        <Route path="/cuenta/contrasena" element={<CambiarClave />} />
        <Route path="*" element={<Navigate to="/vendedores" replace />} />
      </Route>
    </Routes>
  )
}
