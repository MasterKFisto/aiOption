import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface User {
  id: string; email: string; status: string; jurisdiction: string;
  kycStatus: string; riskAcknowledgedAt: string | null; createdAt: string;
}

interface AuthState {
  token: string | null;
  user: User | null;
  setAuth: (_token: string, _user: User) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      setAuth: (token, user) => set({ token, user }),
      logout: () => set({ token: null, user: null }),
    }),
    { name: 'ai-options-auth' },
  ),
);