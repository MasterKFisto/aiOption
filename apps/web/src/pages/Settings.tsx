import { useAuthStore } from '../stores/auth';
import { useNavigate } from 'react-router-dom';
import { LogOut } from 'lucide-react';

export default function Settings() {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();

  const handleLogout = () => { logout(); navigate('/login'); };

  return (
    <div className="space-y-6 max-w-lg">
      <h2 className="text-2xl font-bold">Settings</h2>

      <div className="bg-surface-800 border border-surface-700 rounded-xl p-5 space-y-4">
        <h3 className="font-semibold">Profile</h3>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div><span className="text-surface-400">Email</span><p>{user?.email}</p></div>
          <div><span className="text-surface-400">Status</span><p>{user?.status}</p></div>
          <div><span className="text-surface-400">Jurisdiction</span><p>{user?.jurisdiction}</p></div>
          <div><span className="text-surface-400">KYC</span><p>{user?.kycStatus}</p></div>
          <div><span className="text-surface-400">Risk Acknowledged</span><p>{user?.riskAcknowledgedAt ? 'Yes' : 'No'}</p></div>
          <div><span className="text-surface-400">Member Since</span><p>{user?.createdAt ? new Date(user.createdAt).toLocaleDateString() : '-'}</p></div>
        </div>
      </div>

      <div className="bg-surface-800 border border-surface-700 rounded-xl p-5">
        <h3 className="font-semibold mb-3">Risk Disclaimer</h3>
        <div className="bg-red-900/20 border border-red-700/50 rounded-lg p-4 text-sm text-red-400">
          <p className="mb-2">Crypto options trading involves substantial risk. Automated trading does not guarantee profit. You may lose some or all of your deposited funds.</p>
          <p>This MVP operates in paper trading mode by default. No real funds are at risk. No private keys are stored. No real blockchain transactions are executed unless explicitly enabled.</p>
        </div>
      </div>

      <button onClick={handleLogout}
        className="flex items-center gap-2 px-4 py-2.5 bg-red-600/20 border border-red-700/50 text-red-400 rounded-lg hover:bg-red-600/30 transition-colors">
        <LogOut size={16} /> Sign Out
      </button>
    </div>
  );
}