import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../lib/api';
import toast from 'react-hot-toast';
import { PlusCircle, ArrowUpCircle, Clock } from 'lucide-react';

export default function Wallet() {
  const [depositAsset, setDepositAsset] = useState('USDC');
  const [depositAmount, setDepositAmount] = useState('100');
  const [withdrawAsset, setWithdrawAsset] = useState('USDC');
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [withdrawAddress, setWithdrawAddress] = useState('0xPaperWithdrawal');
  const qc = useQueryClient();

  const { data: wallets } = useQuery({ queryKey: ['wallets'], queryFn: () => api.get('/wallets').then((r) => r.data) });
  const { data: entries } = useQuery({ queryKey: ['ledger'], queryFn: async () => {
    const w = (await api.get('/wallets')).data[0];
    if (!w) return [];
    return (await api.get(`/wallets/${w.id}/ledger`)).data;
  }});

  const wallet = wallets?.[0];
  const balances = wallet?.balances ?? {};

  const depositMut = useMutation({
    mutationFn: (data: { asset: string; amount: string }) => api.post('/deposits/simulate', data),
    onSuccess: () => { toast.success('Deposit simulated'); qc.invalidateQueries(); },
    onError: (err: any) => toast.error(err.response?.data?.message ?? 'Deposit failed'),
  });

  const withdrawMut = useMutation({
    mutationFn: (data: { asset: string; amount: string; destinationAddress: string }) => api.post('/withdrawals', data),
    onSuccess: () => { toast.success('Withdrawal requested'); qc.invalidateQueries(); },
    onError: (err: any) => toast.error(err.response?.data?.message ?? 'Withdrawal failed'),
  });

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">Wallet</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {Object.entries(balances).map(([asset, b]: [string, any]) => (
          <div key={asset} className="bg-surface-800 border border-surface-700 rounded-xl p-4">
            <p className="text-sm text-surface-400 mb-1">{asset}</p>
            <p className="text-2xl font-bold">${parseFloat(b.total).toFixed(2)}</p>
            <div className="flex gap-4 mt-2 text-xs text-surface-400">
              <span>Available: ${parseFloat(b.available).toFixed(2)}</span>
              <span>Locked: ${parseFloat(b.locked).toFixed(2)}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-surface-800 border border-surface-700 rounded-xl p-5">
          <h3 className="font-semibold flex items-center gap-2 mb-4"><PlusCircle size={18} /> Simulate Deposit</h3>
          <form onSubmit={(e) => { e.preventDefault(); depositMut.mutate({ asset: depositAsset, amount: depositAmount }); }} className="space-y-3">
            <select value={depositAsset} onChange={(e) => setDepositAsset(e.target.value)} className="w-full bg-surface-700 border border-surface-600 rounded-lg px-3 py-2 text-surface-100">
              <option value="USDC">USDC</option><option value="ETH">ETH</option><option value="BTC">BTC</option>
            </select>
            <input type="number" step="0.01" value={depositAmount} onChange={(e) => setDepositAmount(e.target.value)} className="w-full bg-surface-700 border border-surface-600 rounded-lg px-3 py-2 text-surface-100" placeholder="Amount" />
            <button type="submit" disabled={depositMut.isPending} className="w-full bg-green-600 hover:bg-green-700 text-white rounded-lg py-2 font-medium transition-colors">
              {depositMut.isPending ? 'Simulating...' : 'Simulate Deposit'}
            </button>
          </form>
        </div>

        <div className="bg-surface-800 border border-surface-700 rounded-xl p-5">
          <h3 className="font-semibold flex items-center gap-2 mb-4"><ArrowUpCircle size={18} /> Request Withdrawal</h3>
          <form onSubmit={(e) => { e.preventDefault(); withdrawMut.mutate({ asset: withdrawAsset, amount: withdrawAmount, destinationAddress: withdrawAddress }); }} className="space-y-3">
            <select value={withdrawAsset} onChange={(e) => setWithdrawAsset(e.target.value)} className="w-full bg-surface-700 border border-surface-600 rounded-lg px-3 py-2 text-surface-100">
              <option value="USDC">USDC</option><option value="ETH">ETH</option><option value="BTC">BTC</option>
            </select>
            <input type="number" step="0.01" value={withdrawAmount} onChange={(e) => setWithdrawAmount(e.target.value)} className="w-full bg-surface-700 border border-surface-600 rounded-lg px-3 py-2 text-surface-100" placeholder="Amount" />
            <input type="text" value={withdrawAddress} onChange={(e) => setWithdrawAddress(e.target.value)} className="w-full bg-surface-700 border border-surface-600 rounded-lg px-3 py-2 text-surface-100" placeholder="Destination Address" />
            <button type="submit" disabled={withdrawMut.isPending} className="w-full bg-brand-600 hover:bg-brand-700 text-white rounded-lg py-2 font-medium transition-colors">
              {withdrawMut.isPending ? 'Requesting...' : 'Request Withdrawal'}
            </button>
            <p className="text-xs text-amber-400">Withdrawals require admin approval</p>
          </form>
        </div>
      </div>

      {/* Ledger History */}
      <div className="bg-surface-800 border border-surface-700 rounded-xl p-5">
        <h3 className="font-semibold flex items-center gap-2 mb-4"><Clock size={18} /> Transaction History</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-surface-400 border-b border-surface-700">
                <th className="text-left py-2">Type</th><th className="text-left py-2">Asset</th>
                <th className="text-right py-2">Debit</th><th className="text-right py-2">Credit</th>
                <th className="text-right py-2">Date</th>
              </tr>
            </thead>
            <tbody>
              {entries?.length ? entries.slice(0, 20).map((e: any) => (
                <tr key={e.id} className="border-b border-surface-700/50">
                  <td className="py-2">{e.eventType}</td><td className="py-2">{e.asset}</td>
                  <td className="text-right py-2 text-red-400">{parseFloat(e.debit) > 0 ? `$${parseFloat(e.debit).toFixed(2)}` : '-'}</td>
                  <td className="text-right py-2 text-green-400">{parseFloat(e.credit) > 0 ? `$${parseFloat(e.credit).toFixed(2)}` : '-'}</td>
                  <td className="text-right py-2 text-surface-400">{new Date(e.createdAt).toLocaleDateString()}</td>
                </tr>
              )) : (
                <tr><td colSpan={5} className="py-4 text-center text-surface-400">No transactions</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}