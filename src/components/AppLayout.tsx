import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import {
  LayoutDashboard, ConciergeBell, MonitorCheck, Users, SlidersHorizontal,
  Ticket, Headset, Tv, BarChart3, Settings, ShieldCheck, LogOut, KeyRound, X, Palette,
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
  const [showColorPalette, setShowColorPalette] = useState(false);
  const [themeColor, setThemeColor] = useState('green');
  const colorThemes = [
    { id: 'blue', label: 'Blue', shades: ['#eff6ff','#dbeafe','#bfdbfe','#93c5fd','#60a5fa','#3b82f6','#2563eb','#1d4ed8','#1e40af','#1e3a8a'] },
    { id: 'green', label: 'Green', shades: ['#f7faed','#edf4d7','#dce9b2','#c5dc7e','#afd052','#9cc53b','#7f9f2e','#637d25','#46591b','#344315'] },
    { id: 'purple', label: 'Purple', shades: ['#faf5ff','#f3e8ff','#e9d5ff','#d8b4fe','#c084fc','#a855f7','#9333ea','#7e22ce','#6b21a8','#581c87'] },
    { id: 'red', label: 'Red', shades: ['#fef2f2','#fee2e2','#fecaca','#fca5a5','#f87171','#ef4444','#dc2626','#b91c1c','#991b1b','#7f1d1d'] },
    { id: 'teal', label: 'Teal', shades: ['#f0fdfa','#ccfbf1','#99f6e4','#5eead4','#2dd4bf','#14b8a6','#0d9488','#0f766e','#115e59','#134e4a'] },
    { id: 'orange', label: 'Orange', shades: ['#fff7ed','#ffedd5','#fed7aa','#fdba74','#fb923c','#f97316','#ea580c','#c2410c','#9a3412','#7c2d12'] },
  ];
  const applyTheme = (id: string) => {
    const selected = colorThemes.find((item) => item.id === id) ?? colorThemes[1];
    selected.shades.forEach((hex, index) => document.documentElement.style.setProperty('--brand-' + (index === 0 ? 50 : index * 100), hex));
    document.documentElement.style.setProperty('--accent-500', selected.shades[5]);
    document.documentElement.style.setProperty('--accent-600', selected.shades[6]);
    localStorage.setItem('queuesystem-theme', selected.id);
    setThemeColor(selected.id);
  };
  useEffect(() => { applyTheme(localStorage.getItem('queuesystem-theme') || 'green'); }, []);
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
    <div className={`flex h-screen bg-slate-50 ${role === "receptionist" ? "reception-kiosk" : ""}`}>
      {role !== "receptionist" && <aside className="flex w-64 flex-col bg-navy-950 text-white">
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
          {role !== 'service_officer' && (
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
      </aside>}
      <main className="min-w-0 flex-1 overflow-y-auto">
        {children}
      </main>
      {role === 'receptionist' && (
        <div className="fixed right-5 top-4 z-40 flex items-center gap-3 rounded-xl border border-slate-200 bg-white/95 px-4 py-2 shadow-md backdrop-blur">
          <span className="max-w-48 truncate text-sm font-semibold text-navy-900" title={user?.display_name}>{user?.display_name}</span>
          <span className="h-5 w-px bg-slate-200" />
          <button type="button" onClick={logout} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm font-medium text-navy-700 transition-colors hover:bg-slate-100 hover:text-error-600" aria-label="Log out">
            <LogOut className="h-4 w-4" />
            <span>Logout</span>
          </button>
        </div>
      )}
      {role === 'admin' && (
        <div className="fixed right-5 top-5 z-40">
          <button type="button" onClick={() => setShowColorPalette((open) => !open)} className="flex h-11 w-11 items-center justify-center rounded-full border border-slate-200 bg-white text-navy-700 shadow-lg hover:bg-slate-50" title="Change system colors" aria-label="Change system colors"><Palette className="h-5 w-5" /></button>
          {showColorPalette && <div className="mt-2 w-64 rounded-xl border border-slate-200 bg-white p-4 shadow-xl">
            <div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-bold text-navy-900">System Color Theme</h2><button onClick={() => setShowColorPalette(false)} aria-label="Close"><X className="h-4 w-4" /></button></div>
            <div className="grid grid-cols-2 gap-2">
              {colorThemes.map((theme) => <button key={theme.id} type="button" onClick={() => applyTheme(theme.id)} className={`flex items-center gap-2 rounded-lg border p-2 text-sm ${themeColor === theme.id ? 'border-brand-600 bg-brand-50 font-semibold' : 'border-slate-200 hover:bg-slate-50'}`}><span className="h-5 w-5 rounded-full border border-black/10" style={{ backgroundColor: theme.shades[5] }} />{theme.label}{themeColor === theme.id && <span className="ml-auto text-brand-700">✓</span>}</button>)}
            </div><p className="mt-3 text-xs text-slate-400">Saved on this computer.</p>
          </div>}
        </div>
      )}
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
