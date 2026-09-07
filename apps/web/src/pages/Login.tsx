import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuthStore } from '../stores/auth';
import api from '../lib/api';
import toast from 'react-hot-toast';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const { setAuth } = useAuthStore();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { data } = await api.post('/auth/login', { email, password });
      setAuth(data.token, data.user);
      toast.success('Logged in');
      navigate('/');
    } catch (err: any) {
      toast.error(err.response?.data?.message ?? 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-950 p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-brand-400">AI Options MVP</h1>
          <p className="text-surface-400 mt-2">Sign in to your account</p>
        </div>
        <div className="bg-amber-900/30 border border-amber-700/50 rounded-lg p-4 mb-6 text-xs text-amber-400">
          ⚠️ Crypto options trading involves substantial risk. This MVP uses paper trading by default. No real funds are used. Automated trading does not guarantee profit.
        </div>
        <form onSubmit={handleSubmit} className="bg-surface-800 rounded-xl p-6 space-y-4 border border-surface-700">
          <div>
            <label className="block text-sm text-surface-300 mb-1">Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-surface-700 border border-surface-600 rounded-lg px-3 py-2 text-surface-100 focus:outline-none focus:border-brand-500" required />
          </div>
          <div>
            <label className="block text-sm text-surface-300 mb-1">Password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-surface-700 border border-surface-600 rounded-lg px-3 py-2 text-surface-100 focus:outline-none focus:border-brand-500" required />
          </div>
          <button type="submit" disabled={loading}
            className="w-full bg-brand-600 hover:bg-brand-700 disabled:bg-brand-800 text-white rounded-lg py-2.5 font-medium transition-colors">
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
          <p className="text-center text-sm text-surface-400">
            Don't have an account?{' '}
            <Link to="/register" className="text-brand-400 hover:text-brand-300">Register</Link>
          </p>
        </form>
      </div>
    </div>
  );
}