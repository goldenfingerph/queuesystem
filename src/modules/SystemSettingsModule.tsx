import { useEffect, useState } from 'react';
import { Save, HardDriveDownload, Upload, Trash2, Film, Settings as SettingsIcon } from 'lucide-react';
import { api } from '@/lib/api';
import { AppLayout } from '@/components/AppLayout';

interface Ad { id: number; filename: string; original_name: string; duration_sec: number | null; is_active: number; sort_order: number }
interface Backup { id: number; filename: string; size_bytes: number; created_at: string }

export function SystemSettingsModule() {
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [ads, setAds] = useState<Ad[]>([]);
  const [backups, setBackups] = useState<Backup[]>([]);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState('');
  const [uploading, setUploading] = useState(false);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [logoUploading, setLogoUploading] = useState(false);
  const [backupBusy, setBackupBusy] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get<{ settings: Record<string, string> }>('/settings'),
      api.get<{ ads: Ad[] }>('/ads'),
      api.get<{ backups: Backup[] }>('/backups'),
      api.get<{ logoUrl: string | null }>('/logo'),
    ]).then(([s, a, b, logo]) => {
      setSettings(s.settings);
      setAds(a.ads);
      setBackups(b.backups);
      setLogoUrl(logo.logoUrl ? `${logo.logoUrl}?v=${Date.now()}` : null);
    }).catch((err) => {
      setLoadError(err instanceof Error ? err.message : 'Unable to load system settings');
    }).finally(() => setLoading(false));
  }, []);

  const saveSettings = async () => {
    const orgNameEn = (settings.org_name_en ?? '').trim();
    const orgNameAr = (settings.org_name_ar ?? '').trim();
    const interval = Number(settings.ads_interval_sec ?? '15');
    const recentCalls = Number(settings.tv_recent_calls ?? '6');
    if (!orgNameEn || orgNameEn.length > 120 || !orgNameAr || orgNameAr.length > 120) { setSavedMsg('Organization names are required and must be 120 characters or fewer.'); return; }
    if (!Number.isInteger(interval) || interval < 5 || interval > 360) { setSavedMsg('Advertisement interval must be a whole number from 5 to 360 seconds.'); return; }
    if (!Number.isInteger(recentCalls) || recentCalls < 1 || recentCalls > 20) { setSavedMsg('TV recent calls count must be a whole number from 1 to 20.'); return; }
    setSaving(true);
    setSavedMsg('');
    try {
      await api.put('/settings', { settings });
      setSavedMsg('Settings saved');
      setTimeout(() => setSavedMsg(''), 3000);
    } catch (err) {
      setSavedMsg(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const uploadAd = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.[0]) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('video', e.target.files[0]);
      await api.upload('/ads/upload', fd);
      const r = await api.get<{ ads: Ad[] }>('/ads');
      setAds(r.ads);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const uploadLogo = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLogoUploading(true);
    try {
      const fd = new FormData();
      fd.append('logo', file);
      const result = await api.upload<{ logoUrl: string }>('/logo/upload', fd);
      setLogoUrl(`${result.logoUrl}?v=${Date.now()}`);
      setSavedMsg('Logo uploaded successfully. It is now shared across all connected screens.');
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Logo upload failed');
    } finally {
      setLogoUploading(false);
      e.target.value = '';
    }
  };

  const removeLogo = async () => {
    if (!confirm('Remove the uploaded logo and restore the default Infinity Services icon?')) return;
    try {
      await api.del('/logo');
      setLogoUrl(null);
      setSavedMsg('Default logo restored.');
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Unable to restore default logo');
    }
  };

  const toggleAd = async (ad: Ad) => {
    try {
      await api.put(`/ads/${ad.id}`, { is_active: !ad.is_active });
      const r = await api.get<{ ads: Ad[] }>('/ads');
      setAds(r.ads);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Unable to update advertisement');
    }
  };

  const delAd = async (ad: Ad) => {
    if (!confirm(`Delete "${ad.original_name}"?`)) return;
    try { await api.del(`/ads/${ad.id}`); const r = await api.get<{ ads: Ad[] }>('/ads'); setAds(r.ads); }
    catch (err) { alert(err instanceof Error ? err.message : 'Delete failed'); }
  };

  const downloadBackup = async (backup: Backup) => {
    try {
      const token = sessionStorage.getItem('infinity_token');
      const response = await fetch(`/api/backups/${backup.id}/download`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!response.ok) {
        let message = 'Unable to download backup';
        try {
          const body = await response.json();
          if (typeof body.error === 'string') message = body.error;
        } catch { /* Keep fallback message. */ }
        throw new Error(message);
      }
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = backup.filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Unable to download backup');
    }
  };

  const createBackup = async () => {
    setBackupBusy(true);
    try {
      await api.post('/backup', {});
      const r = await api.get<{ backups: Backup[] }>('/backups');
      setBackups(r.backups);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Backup failed');
    } finally {
      setBackupBusy(false);
    }
  };

  const fmtSize = (bytes: number) => bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${(bytes / 1024).toFixed(0)} KB`;

  return (
    <AppLayout active="system-settings">
      <div className="p-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-navy-900">System Settings</h1>
          <p className="text-sm text-navy-500">Configure display, advertisements, and backups</p>
        </div>

        {loadError && <div className="mb-4 rounded-lg bg-error-500/10 px-4 py-2 text-sm text-error-600">{loadError}</div>}
        {loading && <div className="mb-4 text-sm text-navy-400">Loading system settings...</div>}
        {savedMsg && <div className="mb-4 rounded-lg bg-success-500/10 px-4 py-2 text-sm font-medium text-success-600">{savedMsg}</div>}

        <div className="grid gap-6 lg:grid-cols-2">
          {/* General Settings */}
          <div className="surface p-6">
            <h2 className="mb-4 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-navy-500"><SettingsIcon className="h-4 w-4" /> General Settings</h2>
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-navy-400">Organization Name (EN)</label>
                <input className="input-field" required maxLength={120} value={settings.org_name_en ?? ''} onChange={(e) => setSettings({ ...settings, org_name_en: e.target.value })} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-navy-400">Organization Name (AR)</label>
                <input className="input-field" required maxLength={120} dir="rtl" value={settings.org_name_ar ?? ''} onChange={(e) => setSettings({ ...settings, org_name_ar: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-navy-400">Advertisement Interval (seconds)</label>
                  <input type="number" min="5" max="360" className="input-field" value={settings.ads_interval_sec ?? '15'} onChange={(e) => setSettings({ ...settings, ads_interval_sec: e.target.value })} />
                  <p className="mt-1 text-xs text-navy-300">5–360 seconds per advertisement</p>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-navy-400">TV Recent Calls Count</label>
                  <input type="number" min="1" max="20" step="1" className="input-field" value={settings.tv_recent_calls ?? '6'} onChange={(e) => setSettings({ ...settings, tv_recent_calls: e.target.value })} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-navy-400">Default Language</label>
                  <select className="input-field" value={settings.language ?? 'en'} onChange={(e) => setSettings({ ...settings, language: e.target.value })}>
                    <option value="en">English</option>
                    <option value="ar">Arabic</option>
                    <option value="both">Bilingual</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="flex items-center gap-2 text-sm text-navy-700">
                  <input type="checkbox" checked={settings.voice_enabled === '1'} onChange={(e) => setSettings({ ...settings, voice_enabled: e.target.checked ? '1' : '0' })} /> Voice Announcements
                </label>
                <label className="flex items-center gap-2 text-sm text-navy-700">
                  <input type="checkbox" checked={settings.bell_enabled === '1'} onChange={(e) => setSettings({ ...settings, bell_enabled: e.target.checked ? '1' : '0' })} /> Bell Sound
                </label>
                <label className="flex items-center gap-2 text-sm text-navy-700">
                  <input type="checkbox" checked={settings.ads_enabled === '1'} onChange={(e) => setSettings({ ...settings, ads_enabled: e.target.checked ? '1' : '0' })} /> Ads Enabled
                </label>
              </div>
              <button onClick={saveSettings} disabled={saving} className="btn-primary w-full"><Save className="h-4 w-4" /> Save Settings</button>
            </div>
          </div>

          {/* Backup */}
          <div className="surface p-6">
            <h2 className="mb-4 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-navy-500"><HardDriveDownload className="h-4 w-4" /> Database Backup</h2>
            <button onClick={createBackup} disabled={backupBusy} className="btn-primary mb-4 w-full">
              {backupBusy ? 'Creating...' : 'Create Backup Now'}
            </button>
            <div className="space-y-2">
              {backups.length === 0 ? <p className="text-sm text-navy-400">No backups yet</p> :
                backups.map((b) => (
                  <div key={b.id} className="flex items-center justify-between rounded-lg border border-slate-200 p-3">
                    <div>
                      <p className="text-sm font-medium text-navy-900">{b.filename}</p>
                      <p className="text-xs text-navy-400">{fmtSize(b.size_bytes)} · {b.created_at}</p>
                      <button type="button" onClick={() => downloadBackup(b)} className="mt-1 inline-block text-xs font-semibold text-brand-600 hover:underline">Download backup</button>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        </div>

        {/* Organization Logo */}
        <div className="surface mt-6 p-6">
          <h2 className="mb-2 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-navy-500"><Upload className="h-4 w-4" /> Organization Logo</h2>
          <p className="mb-4 text-sm text-navy-400">Upload one logo for the login screen, sidebar, and TV display. The image is automatically fitted without stretching or cropping.</p>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <div className="flex h-36 w-56 items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 p-3">
              {logoUrl ? <img src={logoUrl} alt="Organization logo preview" className="max-h-full max-w-full object-contain" /> : <div className="text-center text-sm text-navy-400"><SettingsIcon className="mx-auto mb-2 h-8 w-8" />Default Infinity Services icon</div>}
            </div>
            <div className="flex flex-wrap gap-2">
              <label className="btn-primary cursor-pointer">
                <Upload className="h-4 w-4" /> {logoUploading ? 'Uploading...' : logoUrl ? 'Change Logo' : 'Upload Logo'}
                <input type="file" accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp" className="hidden" disabled={logoUploading} onChange={uploadLogo} />
              </label>
              {logoUrl && <button type="button" onClick={removeLogo} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-error-600 hover:bg-error-50"><Trash2 className="h-4 w-4" /> Restore Default</button>}
            </div>
          </div>
          <p className="mt-3 text-xs text-navy-400">Accepted: PNG, JPG, WebP · Maximum 5 MB · Transparent PNG recommended.</p>
        </div>

        {/* Advertisements */}
        <div className="surface mt-6 p-6">
          <h2 className="mb-4 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-navy-500"><Film className="h-4 w-4" /> MP4 Advertisements</h2>
          <div className="mb-4">
            <label className="flex cursor-pointer items-center gap-2 rounded-lg border-2 border-dashed border-slate-300 p-4 text-sm text-navy-500 hover:border-brand-400">
              <Upload className="h-5 w-5" />
              {uploading ? 'Uploading...' : 'Click to upload MP4 video'}
              <input type="file" accept="video/mp4,video/webm" className="hidden" disabled={uploading} onChange={uploadAd} />
            </label>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {ads.map((ad) => (
              <div key={ad.id} className="rounded-lg border border-slate-200 p-4">
                <video src={`/api/media/ads/${ad.filename}`} className="mb-2 h-32 w-full rounded bg-black object-contain" muted />
                <p className="truncate text-sm font-medium text-navy-900">{ad.original_name}</p>
                <div className="mt-2 flex items-center justify-between">
                  <button onClick={() => toggleAd(ad)} className={`badge cursor-pointer ${ad.is_active ? 'bg-success-500/10 text-success-600' : 'bg-slate-100 text-navy-400'}`}>
                    {ad.is_active ? 'Active' : 'Inactive'}
                  </button>
                  <button onClick={() => delAd(ad)} className="text-error-600 hover:bg-error-500/10 rounded p-1"><Trash2 className="h-4 w-4" /></button>
                </div>
              </div>
            ))}
          </div>
          {ads.length === 0 && <p className="text-sm text-navy-400">No advertisements uploaded yet</p>}
        </div>
      </div>
    </AppLayout>
  );
}

