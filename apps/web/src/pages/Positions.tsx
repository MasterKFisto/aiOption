import { useQuery } from '@tanstack/react-query';
import api from '../lib/api';

export default function Positions() {
  const { data: positions, isLoading } = useQuery({
    queryKey: ['positions-all'],
    queryFn: () => api.get('/positions').then((r) => r.data),
  });

  const openPositions = positions?.filter((p: any) => p.status === 'OPEN') ?? [];
  const closedPositions = positions?.filter((p: any) => p.status !== 'OPEN') ?? [];

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">Positions</h2>

      {/* Open */}
      <div className="bg-surface-800 border border-surface-700 rounded-xl p-5">
        <h3 className="font-semibold mb-3">Open Positions ({openPositions.length})</h3>
        {isLoading ? <p className="text-surface-400">Loading...</p> : openPositions.length === 0 ? <p className="text-surface-400 text-sm">No open positions</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-surface-400 border-b border-surface-700">
                  <th className="text-left py-2">Asset</th><th className="text-left py-2">Type</th>
                  <th className="text-right py-2">Entry</th><th className="text-right py-2">Current</th>
                  <th className="text-right py-2">Unrealized P&L</th><th className="text-right py-2">Expires</th>
                </tr>
              </thead>
              <tbody>
                {openPositions.map((p: any) => (
                  <tr key={p.id} className="border-b border-surface-700/50">
                    <td className="py-2 font-medium">{p.asset}</td><td className="py-2">{p.optionType}</td>
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
        )}
      </div>

      {/* Closed */}
      <div className="bg-surface-800 border border-surface-700 rounded-xl p-5">
        <h3 className="font-semibold mb-3">Closed / Expired Positions</h3>
        {closedPositions.length === 0 ? <p className="text-surface-400 text-sm">No closed positions</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-surface-400 border-b border-surface-700">
                  <th className="text-left py-2">Asset</th><th className="text-left py-2">Type</th>
                  <th className="text-left py-2">Status</th><th className="text-right py-2">Entry</th>
                  <th className="text-right py-2">Realized P&L</th><th className="text-right py-2">Closed</th>
                </tr>
              </thead>
              <tbody>
                {closedPositions.slice(0, 20).map((p: any) => (
                  <tr key={p.id} className="border-b border-surface-700/50">
                    <td className="py-2">{p.asset}</td><td className="py-2">{p.optionType}</td>
                    <td className="py-2"><span className="px-2 py-0.5 rounded text-xs bg-surface-700">{p.status}</span></td>
                    <td className="text-right py-2">${parseFloat(p.entryPremiumUsd).toFixed(2)}</td>
                    <td className={`text-right py-2 ${parseFloat(p.realizedPnlUsd) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      ${parseFloat(p.realizedPnlUsd).toFixed(2)}
                    </td>
                    <td className="text-right py-2 text-surface-400">{p.closedAt ? new Date(p.closedAt).toLocaleDateString() : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}