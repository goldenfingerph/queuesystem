import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import {
  LayoutDashboard, ConciergeBell, MonitorCheck, Users, SlidersHorizontal,
  Ticket, Headset, Tv, BarChart3, Settings, ShieldCheck, LogOut, KeyRound, X,
} from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { ROLE_PERMISSIONS, type ModuleId, type StaffRole } from '@/types/domain';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api';

const MODULE_ICON: Record<ModuleId, typeof LayoutDashboard> = {
  dashboard: LayoutDashboard,
  services: ConciergeBell,
  counters: MonitorCheck,
  staff: Users,
  'queue-settings': SlidersHorizontal,
  reception: Ticket,
  'counter-desk': Headset,
  'tv-display': Tv,
  reports: BarChart3,
  'system-settings': Settings,
};

const MODULE_LABEL: Record<ModuleId, string> = {
  dashboard: 'Dashboard',
  services: 'Services',
  counters: 'Counters',
  staff: 'Staff',
  'queue-settings': 'Queue Rules',
  reception: 'Reception',
  'counter-desk': 'Counter Desk',
  'tv-display': 'TV Display',
  reports: 'Reports',
  'system-settings': 'Settings',
};

export function AppLayout({ active, children }: { active: ModuleId; children: ReactNode }) {
  const { user, logout } = useAuth();
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [orgNameEn, setOrgNameEn] = useState('INFINITY SERVICES');
  useEffect(() => {
    api.get<{ logoUrl: string | null }>('/logo').then((r) => setLogoUrl(r.logoUrl ? r.logoUrl + '?v=' + Date.now() : null)).catch(() => {});
    const loadOrganizationName = () => api.get<{ settings: Record<string, string> }>('/settings').then((r) => setOrgNameEn(r.settings.org_name_en?.trim() || 'INFINITY SERVICES')).catch(() => {});
    loadOrganizationName();
    window.addEventListener('organization-settings-updated', loadOrganizationName);
    return () => window.removeEventListener('organization-settings-updated', loadOrganizationName);
  }, []);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [passwordMessage, setPasswordMessage] = useState('');
  const [passwordSaving, setPasswordSaving] = useState(false);
  const role = user?.role as StaffRole;
  const allowed = ROLE_PERMISSIONS[role] ?? [];

  const navItems = allowed.map((id) => ({
    id,
    label: MODULE_LABEL[id],
    icon: MODULE_ICON[id],
  }));

  return (
    <div className="flex h-screen bg-slate-50">
      <aside className="flex w-64 flex-col bg-navy-950 text-white">
        <div className="flex h-16 items-center gap-3 border-b border-navy-800 px-5">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-gradient-to-br from-brand-500 to-accent-500">
            {logoUrl ? <img src={logoUrl} alt="Organization logo" className="h-full w-full rounded-lg object-contain p-0.5" /> : <ShieldCheck className="h-5 w-5" strokeWidth={2.4} />}
          </div>
          <div className="leading-tight">
            <p className="max-w-40 truncate text-sm font-bold" title={orgNameEn}>{orgNameEn}</p>
            <p className="text-[10px] text-brand-200">Queue Management</p>
          </div>
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto p-3">
          {navItems.map((item) => (
            <a
              key={item.id}
              href={`#${item.id}`}
              onClick={() => { window.location.hash = `#/${item.id}`; }}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                active === item.id ? 'bg-brand-600 text-white shadow-sm' : 'text-navy-200 hover:bg-white/10',
              )}
            >
              <item.icon className="h-4.5 w-4.5" strokeWidth={2} />
              {item.label}
            </a>
          ))}
          {role !== 'receptionist' && role !== 'service_officer' && (
            <a href="#/tv-display" className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-navy-200 hover:bg-white/10 transition-colors">
              <Tv className="h-4.5 w-4.5" strokeWidth={2} />
              Open TV Display
            </a>
          )}
        </nav>
        <div className="border-t border-navy-800 p-3">
          <div className="rounded-lg bg-navy-900 px-3 py-2">
            <p className="text-xs font-semibold text-white">{user?.display_name}</p>
            <p className="text-[10px] text-brand-200">{user?.role.replace('_', ' ')}</p>
          </div>
          {role === 'admin' && (
            <button onClick={() => { setShowPasswordForm(true); setPasswordError(''); setPasswordMessage(''); }} className="mt-2 flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-navy-200 hover:bg-white/10 transition-colors">
              <KeyRound className="h-4.5 w-4.5" strokeWidth={2} />
              Change Password
            </button>
          )}
          <button onClick={logout} className="mt-1 flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-navy-200 hover:bg-white/10 transition-colors">
            <LogOut className="h-4.5 w-4.5" strokeWidth={2} />
            Sign out
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto">
        {children}
      </main>
      {role === 'admin' && showPasswordForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <form onSubmit={async (event: FormEvent) => {
            event.preventDefault();
            setPasswordError('');
            setPasswordMessage('');
            if (newPassword.length < 12) { setPasswordError('New password must be at least 12 characters.'); return; }
            if (newPassword !== confirmPassword) { setPasswordError('New password and confirmation do not match.'); return; }
            setPasswordSaving(true);
            try {
              await api.post('/auth/change-password', { currentPassword, newPassword });
              setPasswordMessage('Password changed successfully.');
              setCurrentPassword('');
              setNewPassword('');
              setConfirmPassword('');
              window.setTimeout(() => { setShowPasswordForm(false); setPasswordMessage(''); }, 1200);
            } catch (err) {
              setPasswordError(err instanceof Error ? err.message : 'Unable to change password.');
            } finally {
              setPasswordSaving(false);
            }
          }} className="surface w-full max-w-md p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-bold text-navy-900">Change Password</h2>
              <button type="button" onClick={() => setShowPasswordForm(false)} className="text-navy-400 hover:text-navy-700" aria-label="Close">
                <X className="h-5 w-5" />
              </button>
            </div>
            {passwordError && <p className="mb-3 rounded-lg bg-error-500/10 px-3 py-2 text-sm text-error-600">{passwordError}</p>}
            {passwordMessage && <p className="mb-3 rounded-lg bg-success-500/10 px-3 py-2 text-sm text-success-600">{passwordMessage}</p>}
            <div className="space-y-3">
              <input className="input-field" type="password" autoComplete="current-password" placeholder="Current password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required />
              <input className="input-field" type="password" autoComplete="new-password" placeholder="New password (at least 12 characters)" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} minLength={12} required />
              <input className="input-field" type="password" autoComplete="new-password" placeholder="Confirm new password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} minLength={12} required />
            </div>
            <button type="submit" disabled={passwordSaving} className="btn-primary mt-4 w-full">
              {passwordSaving ? 'Saving...' : 'Update Password'}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
