import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../lib/api';
import toast from 'react-hot-toast';
import { Shield, CheckCircle, XCircle, AlertTriangle } from 'lucide-react';

export default function Admin() {
  const qc = useQueryClient();

  const { data: withdrawals } = useQuery({
    queryKey: ['admin-withdrawals'],
    queryFn: () => api.get('/admin/withdrawals').then((r) => r.data),
  });

  const approveMut = useMutation({
    mutationFn: (id: string) => api.post(`/admin/withdrawals/${id}/approve`),
    onSuccess: () => { toast.success('Withdrawal approved'); qc.invalidateQueries(); },
  });

  const rejectMut = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => api.post(`/admin/withdrawals/${id}/reject`, { reason }),
    onSuccess: () => { toast.success('Withdrawal rejected'); qc.invalidateQueries(); },
  });

  const killSwitchMut = useMutation({
    mutationFn: () => api.post('/admin/trading/kill-switch'),
    onSuccess: () => toast.success('Trading kill switch activated'),
  });

  const pendingWithdrawals = withdrawals?.filter((w: any) => w.status === 'REQUESTED') ?? [];

  return (
    <div className="space-y-6 max-w-3xl">
      <h2 className="text-2xl font-bold">Admin Panel</h2>

      {/* Kill Switch */}
      <div className="bg-surface-800 border border-surface-700 rounded-xl p-5">
        <h3 className="font-semibold flex items-center gap-2 mb-3"><AlertTriangle size={18} className="text-red-400" /> Trading Kill Switch</h3>
        <p className="text-sm text-surface-400 mb-3">Emergency stop for all automated trading. This halts the trading loop immediately.</p>
        <button onClick={() => killSwitchMut.mutate()} disabled={killSwitchMut.isPending}
          className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition-colors">
          {killSwitchMut.isPending ? 'Activating...' : 'Activate Kill Switch'}
        </button>
      </div>

      {/* Pending Withdrawals */}
      <div className="bg-surface-800 border border-surface-700 rounded-xl p-5">
        <h3 className="font-semibold flex items-center gap-2 mb-3"><Shield size={18} /> Pending Withdrawals ({pendingWithdrawals.length})</h3>
        {pendingWithdrawals.length === 0 ? (
          <p className="text-surface-400 text-sm">No pending withdrawals</p>
        ) : (
          <div className="space-y-3">
            {pendingWithdrawals.map((w: any) => (
              <div key={w.id} className="bg-surface-700/50 rounded-lg p-4 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">{w.user?.email ?? w.userId}</p>
                  <p className="text-xs text-surface-400">{w.asset} - ${parseFloat(w.amount).toFixed(2)}</p>
                  <p className="text-xs text-surface-400 truncate max-w-[200px]">To: {w.destinationAddress}</p>
                  <p className="text-xs text-surface-500">{new Date(w.createdAt).toLocaleString()}</p>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => approveMut.mutate(w.id)}
                    className="p-2 bg-green-600/20 text-green-400 rounded-lg hover:bg-green-600/30">
                    <CheckCircle size={18} />
                  </button>
                  <button onClick={() => rejectMut.mutate({ id: w.id, reason: 'Rejected by admin' })}
                    className="p-2 bg-red-600/20 text-red-400 rounded-lg hover:bg-red-600/30">
                    <XCircle size={18} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}