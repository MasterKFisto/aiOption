import { useQuery } from '@tanstack/react-query';
import api from '../lib/api';
import { useAuthStore } from '../stores/auth';
import { TrendingUp, Wallet as WalletIcon, Activity, DollarSign } from 'lucide-react';

export default function Dashboard() {
  const user = useAuthStore((s) => s.user);

  const { data: wallets } = useQuery({
    queryKey: ['wallets'],
    queryFn: () => api.get('/wallets').then((r) => r.data),
  });

  const { data: positions } = useQuery({
    queryKey: ['positions-open'],
    queryFn: () => api.get('/positions/open').then((r) => r.data),
  });

  const { data: tradingSettings } = useQuery({
    queryKey: ['trading-settings'],
    queryFn: () => api.get('/trading/settings').then((r) => r.data),
  });

  const wallet = wallets?.[0];
  const balances = wallet?.balances ?? {};
  const usdcBalance = balances['USDC'] ?? { available: '0', locked: '0', total: '0' };

  const cards = [
    { label: 'Available Balance', value: `$${parseFloat(usdcBalance.available).toFixed(2)}`, icon: WalletIcon, color: 'text-green-400' },
    { label: 'Locked Balance', value: `$${parseFloat(usdcBalance.locked).toFixed(2)}`, icon: Activity, color: 'text-yellow-400' },
    { label: 'Total Balance', value: `$${parseFloat(usdcBalance.total).toFixed(2)}`, icon: DollarSign, color: 'text-brand-400' },
    { label: 'Open Positions', value: positions?.length ?? 0, icon: TrendingUp, color: 'text-purple-400' },
    { label: 'AI Trading', value: tradingSettings?.autoTradingEnabled ? 'Active' : 'Paused', icon: Activity, color: tradingSettings?.autoTradingEnabled ? 'text-green-400' : 'text-red-400' },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Dashboard</h2>
        <p className="text-surface-400 text-sm">Welcome back, {user?.email}</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        {cards.map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="bg-surface-800 border border-surface-700 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <Icon size={16} className={color} />
              <span className="text-xs text-surface-400">{label}</span>
            </div>
            <p className="text-lg font-semibold">{value}</p>
          </div>
        ))}
      </div>

      {/* Recent Activity / Positions */}
      <div className="bg-surface-800 border border-surface-700 rounded-xl p-4">
        <h3 className="text-lg font-semibold mb-3">Open Positions</h3>
        {positions?.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-surface-400 border-b border-surface-700">
                  <th className="text-left py-2">Asset</th>
                  <th className="text-left py-2">Type</th>
                  <th className="text-right py-2">Entry Premium</th>
                  <th className="text-right py-2">Current Value</th>
                  <th className="text-right py-2">P&L</th>
                  <th className="text-right py-2">Expires</th>
                </tr>
              </thead>
              <tbody>
                {positions.map((p: any) => (
                  <tr key={p.id} className="border-b border-surface-700/50">
                    <td className="py-2">{p.asset}</td>
                    <td className="py-2">{p.optionType}</td>
                    <td className="text-right py-2">${parseFloat(p.entryPremiumUsd).toFixed(2)}</td>
                    <td className="text-right py-2">${parseFloat(p.currentValueUsd).toFixed(2)}</td>
                    <td className={`text-right py-2 ${parseFloat(p.unrealizedPnlUsd) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      ${parseFloat(p.unrealizedPnlUsd).toFixed(2)}
                    </td>
                    <td className="text-right py-2 text-surface-400">{new Date(p.expiresAt).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-surface-400 text-sm">No open positions</p>
        )}
      </div>
    </div>
  );
}