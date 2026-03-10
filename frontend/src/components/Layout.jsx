import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Layout() {
  const { user, logout, isAdmin } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  const linkClass = ({ isActive }) =>
    `px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
      isActive ? 'bg-brand-600 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-800'
    }`;

  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-gray-900 border-b border-gray-800 sticky top-0 z-40">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-6">
            <span className="font-bold text-brand-500 tracking-tight text-lg">VPN Panel</span>
            <nav className="flex items-center gap-1">
              {isAdmin && <NavLink to="/admin"     className={linkClass}>Пользователи</NavLink>}
              <NavLink to="/dashboard" className={linkClass}>Кабинет</NavLink>
              <NavLink to="/settings"  className={linkClass}>Настройки</NavLink>
            </nav>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-400 hidden sm:block">{user?.login}</span>
            <button onClick={handleLogout} className="btn-ghost btn-sm text-sm">
              Выйти
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-6xl mx-auto w-full px-4 py-8">
        <Outlet />
      </main>
    </div>
  );
}
