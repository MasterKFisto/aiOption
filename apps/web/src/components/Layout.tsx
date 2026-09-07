import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/auth';
import { useUIStore } from '../stores/ui';
import {
  LayoutDashboard, Wallet, BarChart3, ListOrdered, Settings, Shield, LogOut, Menu, X,
} from 'lucide-react';

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/wallet', icon: Wallet, label: 'Wallet' },
  { to: '/trading', icon: BarChart3, label: 'Trading' },
  { to: '/positions', icon: ListOrdered, label: 'Positions' },
  { to: '/settings', icon: Settings, label: 'Settings' },
  { to: '/admin', icon: Shield, label: 'Admin' },
];

export default function Layout() {
  const { user, logout } = useAuthStore();
  const { sidebarOpen, toggleSidebar } = useUIStore();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <aside className={`${sidebarOpen ? 'w-64' : 'w-0'} transition-all duration-300 bg-surface-800 border-r border-surface-700 flex flex-col overflow-hidden`}>
        <div className="p-4 border-b border-surface-700">
          <h1 className="text-lg font-bold text-brand-400">AI Options MVP</h1>
          <p className="text-xs text-surface-400">Paper Trading</p>
        </div>
        <nav className="flex-1 p-2 space-y-1">
          {navItems.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                  isActive ? 'bg-brand-600/20 text-brand-400' : 'text-surface-300 hover:bg-surface-700 hover:text-surface-100'
                }`
              }
            >
              <Icon size={18} />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="p-4 border-t border-surface-700">
          <p className="text-xs text-surface-400 truncate">{user?.email}</p>
          <button onClick={handleLogout} className="mt-2 flex items-center gap-2 text-sm text-red-400 hover:text-red-300">
            <LogOut size={14} /> Logout
          </button>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="h-14 bg-surface-800 border-b border-surface-700 flex items-center px-4 gap-4">
          <button onClick={toggleSidebar} className="text-surface-400 hover:text-surface-100">
            {sidebarOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
          <div className="flex-1" />
          {/* Risk Disclaimer Banner */}
          <div className="hidden md:block bg-amber-900/30 border border-amber-700/50 rounded px-3 py-1 text-xs text-amber-400">
            ⚠️ Paper Trading Mode - No real funds are used
          </div>
        </header>

        {/* Disclaimer for mobile */}
        <div className="md:hidden bg-amber-900/30 border-b border-amber-700/50 px-4 py-1.5 text-xs text-amber-400">
          ⚠️ Paper Trading Mode
        </div>

        <main className="flex-1 overflow-y-auto p-4 md:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}