import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { ShieldCheck, Loader2, AlertCircle } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';

export function LoginPage() {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [orgNameEn, setOrgNameEn] = useState('INFINITY SERVICES');

  useEffect(() => {
    api.get<{ logoUrl: string | null }>('/logo').then((r) => setLogoUrl(r.logoUrl ? r.logoUrl + '?v=' + Date.now() : null)).catch(() => {});
    api.get<{ settings: Record<string, string> }>('/settings').then((r) => setOrgNameEn(r.settings.org_name_en?.trim() || 'INFINITY SERVICES')).catch(() => {});
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await login(username.trim(), password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-navy-900 to-navy-950 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-2xl bg-gradient-to-br from-brand-500 to-accent-500 shadow-xl">
            {logoUrl ? <img src={logoUrl} alt="Organization logo" className="h-full w-full rounded-2xl object-contain p-1" /> : <ShieldCheck className="h-9 w-9 text-white" strokeWidth={2.2} />}
          </div>
          <h1 className="text-xl font-bold text-white">{orgNameEn}</h1>
          <p className="text-sm text-brand-200">Queue Management System</p>
        </div>
        <form onSubmit={handleSubmit} className="surface p-6 space-y-4">
          {error && (
            <div className="flex items-center gap-2 rounded-lg bg-error-500/10 px-3 py-2 text-sm text-error-600">
              <AlertCircle className="h-4 w-4" />
              {error}
            </div>
          )}
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-navy-500">Username</label>
            <input
              type="text"
              name="username"
              autoComplete="username"
              required
              maxLength={64}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus
              className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none transition-all focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
              placeholder="Enter username"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-navy-500">Password</label>
            <input
              type="password"
              name="password"
              autoComplete="current-password"
              required
              maxLength={128}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none transition-all focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
              placeholder="Enter password"
            />
          </div>
          <button type="submit" disabled={busy} className="btn-primary w-full focus-ring">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
