import { useState, type FormEvent } from 'react';
import { Building2, ShieldCheck, Loader2, Languages, AlertCircle } from 'lucide-react';
import { api, setToken } from '@/lib/api';

export function SetupWizard() {
  const [organizationNameEn, setOrganizationNameEn] = useState('');
  const [organizationNameAr, setOrganizationNameAr] = useState('');
  const [language, setLanguage] = useState('en');
  const [businessTimezone, setBusinessTimezone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Dubai');
  const [businessDayStart, setBusinessDayStart] = useState('06:00');
  const [username, setUsername] = useState('admin');
  const [displayName, setDisplayName] = useState('System Administrator');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    if (password.length < 12) { setError('Use a password with at least 12 characters.'); return; }
    if (password !== confirmPassword) { setError('The passwords do not match.'); return; }
    setBusy(true);
    try {
      const result = await api.post<{ token: string }>('/setup/complete', {
        organizationNameEn, organizationNameAr, language, businessTimezone, businessDayStart, username, displayName, password,
      });
      setToken(result.token);
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to complete setup. Please try again.');
      setBusy(false);
    }
  };

  const field = 'w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-navy-900 outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100';

  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-navy-900 via-navy-950 to-slate-950 px-4 py-8">
      <div className="w-full max-w-2xl overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="bg-navy-900 px-7 py-7 text-white sm:px-9">
          <div className="mb-4 grid h-12 w-12 place-items-center rounded-xl bg-brand-500"><Building2 className="h-6 w-6" /></div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-200">Welcome to QueueSystem</p>
          <h1 className="mt-2 text-2xl font-bold">Let’s set up your system</h1>
          <p className="mt-2 max-w-xl text-sm text-slate-300">Complete this one-time setup for your organization. Your administrator account will be secured before the system opens.</p>
          <div className="mt-5 flex gap-2"><span className="h-1.5 flex-1 rounded-full bg-brand-400" /><span className="h-1.5 flex-1 rounded-full bg-brand-400" /><span className="h-1.5 flex-1 rounded-full bg-brand-400" /></div>
        </div>

        <form onSubmit={submit} className="space-y-6 px-7 py-7 sm:px-9">
          {error && <div role="alert" className="flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2.5 text-sm text-red-700"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{error}</div>}

          <section>
            <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-navy-900"><Building2 className="h-4 w-4 text-brand-600" /> Organization details</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-xs font-semibold text-navy-600">Company name (English)
                <input required maxLength={100} className={field + ' mt-1.5'} value={organizationNameEn} onChange={(e) => setOrganizationNameEn(e.target.value)} placeholder="Your company name" />
              </label>
              <label className="block text-xs font-semibold text-navy-600">Company name (Arabic)
                <input required maxLength={100} dir="rtl" className={field + ' mt-1.5'} value={organizationNameAr} onChange={(e) => setOrganizationNameAr(e.target.value)} placeholder="اسم الشركة" />
              </label>
            </div>
            <label className="mt-4 block text-xs font-semibold text-navy-600"><span className="flex items-center gap-2"><Languages className="h-4 w-4 text-brand-600" /> Default language</span>
              <select className={field + ' mt-1.5'} value={language} onChange={(e) => setLanguage(e.target.value)}>
                <option value="en">English</option><option value="ar">Arabic</option><option value="both">Bilingual (English and Arabic)</option>
              </select>
            </label>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <label className="block text-xs font-semibold text-navy-600">Company timezone (IANA)
                <input required maxLength={80} className={field + ' mt-1.5'} value={businessTimezone} onChange={(e) => setBusinessTimezone(e.target.value)} placeholder="Asia/Dubai" />
                <span className="mt-1 block font-normal text-navy-400">Example: Asia/Dubai, Europe/London, America/New_York</span>
              </label>
              <label className="block text-xs font-semibold text-navy-600">Business day starts at
                <input required type="time" className={field + ' mt-1.5'} value={businessDayStart} onChange={(e) => setBusinessDayStart(e.target.value)} />
                <span className="mt-1 block font-normal text-navy-400">Tickets reset according to this local time</span>
              </label>
            </div>
          </section>

          <div className="border-t border-slate-100" />
          <section>
            <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-navy-900"><ShieldCheck className="h-4 w-4 text-brand-600" /> Administrator account</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-xs font-semibold text-navy-600">Admin username
                <input required minLength={3} maxLength={32} pattern="[A-Za-z0-9._-]+" autoComplete="username" className={field + ' mt-1.5'} value={username} onChange={(e) => setUsername(e.target.value)} />
                <span className="mt-1 block font-normal text-navy-400">3–32 characters: letters, numbers, dot, dash, underscore</span>
              </label>
              <label className="block text-xs font-semibold text-navy-600">Administrator display name
                <input required maxLength={80} className={field + ' mt-1.5'} value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
              </label>
              <label className="block text-xs font-semibold text-navy-600">New password
                <input required minLength={12} maxLength={200} type="password" autoComplete="new-password" className={field + ' mt-1.5'} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 12 characters" />
              </label>
              <label className="block text-xs font-semibold text-navy-600">Confirm password
                <input required minLength={12} maxLength={200} type="password" autoComplete="new-password" className={field + ' mt-1.5'} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Re-enter your password" />
              </label>
            </div>
          </section>

          <button type="submit" disabled={busy} className="btn-primary w-full justify-center py-3">
            {busy ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving secure setup...</> : 'Complete Setup & Open QueueSystem'}
          </button>
          <p className="text-center text-xs text-navy-400">This setup can only be completed once. Existing installations are not reset or changed.</p>
        </form>
      </div>
    </main>
  );
}
