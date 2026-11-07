import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { api, setToken } from '@/lib/api';

interface AuthUser {
  id: number;
  username: string;
  display_name: string;
  role: string;
}

interface AuthCtx {
  user: AuthUser | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = sessionStorage.getItem('infinity_token');
    if (!token) { setLoading(false); return; }
    api.get<{ user: AuthUser }>('/auth/me')
      .then((r) => setUser(r.user))
      .catch(() => { setToken(null); })
      .finally(() => setLoading(false));
  }, []);

  const login = async (username: string, password: string) => {
    const r = await api.post<{ token: string; user: AuthUser }>('/auth/login', { username, password });
    setToken(r.token);
    setUser(r.user);
  };

  const logout = async () => {
    try { await api.post('/auth/logout'); } catch { /* ignore */ }
    setToken(null);
    setUser(null);
  };

  return <Ctx.Provider value={{ user, loading, login, logout }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
