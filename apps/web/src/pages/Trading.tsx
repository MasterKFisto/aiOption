import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../lib/api';
import toast from 'react-hot-toast';
import { Play, Square, Settings2 } from 'lucide-react';

export default function Trading() {
  const qc = useQueryClient();

  const { data: settings } = useQuery({
    queryKey: ['trading-settings'],
    queryFn: () => api.get('/trading/settings').then((r) => r.data),
  });

  const updateMut = useMutation({
    mutationFn: (data: any) => api.put('/trading/settings', data),
    onSuccess: () => { toast.success('Settings updated'); qc.invalidateQueries(); },
  });

  const toggleTrading = () => {
    if (!settings) return;
    updateMut.mutate({ autoTradingEnabled: !settings.autoTradingEnabled });
  };

  const handleChange = (field: string, value: any) => {
    updateMut.mutate({ [field]: value });
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Trading Settings</h2>
        <button
          onClick={toggleTrading}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${
            settings?.autoTradingEnabled
              ? 'bg-red-600 hover:bg-red-700 text-white'
              : 'bg-green-600 hover:bg-green-700 text-white'
          }`}
        >
          {settings?.autoTradingEnabled ? <><Square size={16} /> Stop Trading</> : <><Play size={16} /> Start Trading</>}
        </button>
      </div>

      <div className="bg-surface-800 border border-surface-700 rounded-xl p-5 space-y-4">
        <h3 className="font-semibold flex items-center gap-2"><Settings2 size={18} /> Trade Parameters</h3>

        {[
          { label: 'Max Trade Size (USD)', field: 'maxTradeSizeUsd', value: settings?.maxTradeSizeUsd, type: 'string' },
          { label: 'Daily Loss Limit (USD)', field: 'dailyLossLimitUsd', value: settings?.dailyLossLimitUsd, type: 'string' },
          { label: 'Weekly Loss Limit (USD)', field: 'weeklyLossLimitUsd', value: settings?.weeklyLossLimitUsd, type: 'string' },
          { label: 'Max Open Positions', field: 'maxOpenPositions', value: settings?.maxOpenPositions, type: 'number' },
        ].map(({ label, field, value, type }) => (
          <div key={field}>
            <label className="block text-sm text-surface-400 mb-1">{label}</label>
            <input
              type={type === 'number' ? 'number' : 'text'}
              defaultValue={value?.toString()}
              onBlur={(e) => handleChange(field, type === 'number' ? parseInt(e.target.value) : e.target.value)}
              className="w-full bg-surface-700 border border-surface-600 rounded-lg px-3 py-2 text-surface-100"
            />
          </div>
        ))}

        <div>
          <label className="block text-sm text-surface-400 mb-1">Min AI Confidence (0-1)</label>
          <input
            type="number" step="0.05" min="0" max="1"
            defaultValue={settings?.minAiConfidence?.toString()}
            onBlur={(e) => handleChange('minAiConfidence', parseFloat(e.target.value))}
            className="w-full bg-surface-700 border border-surface-600 rounded-lg px-3 py-2 text-surface-100"
          />
        </div>

        <div className="flex items-center gap-3">
          <input
            type="checkbox" id="continousTrading"
            defaultChecked={settings?.continuousTrading}
            onChange={(e) => handleChange('continuousTrading', e.target.checked)}
            className="accent-brand-500"
          />
          <label htmlFor="continousTrading" className="text-sm text-surface-300">Continuous Trading</label>
        </div>

        <div className="flex items-center gap-3">
          <input
            type="checkbox" id="reinvestProfits"
            defaultChecked={settings?.reinvestProfits}
            onChange={(e) => handleChange('reinvestProfits', e.target.checked)}
            className="accent-brand-500"
          />
          <label htmlFor="reinvestProfits" className="text-sm text-surface-300">Reinvest Profits</label>
        </div>
      </div>

      {/* Warning */}
      <div className="bg-amber-900/20 border border-amber-700/50 rounded-xl p-4 text-sm text-amber-400">
        <p className="font-semibold mb-1">⚠️ Important</p>
        <p>Changing settings while trading is active will take effect on the next trading cycle. The AI engine evaluates market conditions every 30 seconds. All trading is simulated paper trading.</p>
      </div>
    </div>
  );
}