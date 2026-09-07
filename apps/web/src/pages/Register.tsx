import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuthStore } from '../stores/auth';
import api from '../lib/api';
import toast from 'react-hot-toast';

export default function Register() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [loading, setLoading] = useState(false);
  const { setAuth } = useAuthStore();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!acknowledged) { toast.error('You must acknowledge the risks'); return; }
    setLoading(true);
    try {
      const { data } = await api.post('/auth/register', { email, password, jurisdiction: 'US', riskAcknowledged: acknowledged });
      setAuth(data.token, data.user);
      toast.success('Account created');
      navigate('/');
    } catch (err: any) {
      toast.error(err.response?.data?.message ?? 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-950 p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-brand-400">AI Options MVP</h1>
          <p className="text-surface-400 mt-2">Create your account</p>
        </div>
        <form onSubmit={handleSubmit} className="bg-surface-800 rounded-xl p-6 space-y-4 border border-surface-700">
          <div>
            <label className="block text-sm text-surface-300 mb-1">Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-surface-700 border border-surface-600 rounded-lg px-3 py-2 text-surface-100 focus:outline-none focus:border-brand-500" required />
          </div>
          <div>
            <label className="block text-sm text-surface-300 mb-1">Password (min 8 chars)</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-surface-700 border border-surface-600 rounded-lg px-3 py-2 text-surface-100 focus:outline-none focus:border-brand-500" required minLength={8} />
          </div>
          <div className="bg-red-900/20 border border-red-700/50 rounded-lg p-3 text-xs text-red-400">
            <p className="mb-2">⚠️ RISK DISCLAIMER</p>
            <p>Crypto options trading involves substantial risk. Automated trading does not guarantee profit. You may lose some or all of your deposited funds. This MVP uses paper trading by default.</p>
          </div>
          <label className="flex items-start gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} className="mt-0.5 accent-brand-500" />
            <span className="text-surface-300">I acknowledge the risks and understand this is a paper trading MVP</span>
          </label>
          <button type="submit" disabled={loading || !acknowledged}
            className="w-full bg-brand-600 hover:bg-brand-700 disabled:bg-surface-700 text-white rounded-lg py-2.5 font-medium transition-colors">
            {loading ? 'Creating...' : 'Create Account'}
          </button>
          <p className="text-center text-sm text-surface-400">
            Already have an account? <Link to="/login" className="text-brand-400 hover:text-brand-300">Sign In</Link>
          </p>
        </form>
      </div>
    </div>
  );
}