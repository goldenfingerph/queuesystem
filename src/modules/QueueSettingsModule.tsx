import { useEffect, useState } from 'react';
import { Save, SlidersHorizontal, GripVertical } from 'lucide-react';
import { api } from '@/lib/api';
import { AppLayout } from '@/components/AppLayout';

interface VisitorCategory {
  id: number; code: string; label_en: string; label_ar: string;
  priority_rank: number; is_active: number; sort_order: number;
}

export function QueueSettingsModule() {
  const [categories, setCategories] = useState<VisitorCategory[]>([]);
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState('');
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    Promise.all([
      api.get<{ categories: VisitorCategory[] }>('/settings/visitor-categories'),
      api.get<{ settings: Record<string, string> }>('/settings'),
    ]).then(([c, s]) => {
      setCategories(c.categories);
      setSettings(s.settings);
    }).catch((err) => {
      setLoadError(err instanceof Error ? err.message : 'Unable to load queue settings');
    }).finally(() => setLoading(false));
  }, []);

  const updateCategory = (id: number, patch: Partial<VisitorCategory>) => {
    setCategories((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  };

  const saveCategory = async (cat: VisitorCategory) => {
    await api.put(`/settings/visitor-categories/${cat.id}`, {
      label_en: cat.label_en,
      label_ar: cat.label_ar,
      priority_rank: cat.priority_rank,
      is_active: cat.is_active,
      sort_order: cat.sort_order,
    });
  };

  const saveAll = async () => {
    setSaving(true);
    setSavedMsg('');
    try {
      const supportedSettings = Object.fromEntries(Object.entries(settings).filter(([key]) => key !== 'priority_order'));
      await api.put('/settings', { settings: supportedSettings });
      await Promise.all(categories.map((c) => saveCategory(c)));
      setSavedMsg('All settings saved successfully');
      setTimeout(() => setSavedMsg(''), 3000);
    } catch (err) {
      setSavedMsg(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <AppLayout active="queue-settings"><div className="p-8 text-navy-400">Loading...</div></AppLayout>;
  if (loadError) return <AppLayout active="queue-settings"><div className="p-6"><div className="rounded-lg bg-error-500/10 p-4 text-sm text-error-600" role="alert">{loadError}<button onClick={() => window.location.reload()} className="ml-3 underline">Retry</button></div></div></AppLayout>;

  return (
    <AppLayout active="queue-settings">
      <div className="p-6">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-navy-900">Queue Settings</h1>
            <p className="text-sm text-navy-500">Configure priority rules and ticket numbering</p>
          </div>
          <button onClick={saveAll} disabled={saving} className="btn-primary focus-ring">
            <Save className="h-4 w-4" /> Save All
          </button>
        </div>

        {savedMsg && (
          <div role="status" className={`mb-4 rounded-lg px-4 py-2 text-sm font-medium ${savedMsg.toLowerCase().includes('fail') || savedMsg.toLowerCase().includes('unable') || savedMsg.toLowerCase().includes('error') ? 'bg-error-500/10 text-error-600' : 'bg-success-500/10 text-success-600'}`}>{savedMsg}</div>
        )}

        {/* Priority Order */}
        <div className="surface mb-6 p-6">
          <div className="mb-4 flex items-center gap-2">
            <SlidersHorizontal className="h-5 w-5 text-brand-600" />
            <h2 className="text-sm font-bold uppercase tracking-wide text-navy-500">Priority Order</h2>
          </div>
          <div className="mb-4 rounded-lg border border-brand-200 bg-brand-50 p-3 text-sm text-brand-800">
            <strong>Priority Lane applies to ALL services.</strong> Senior Citizens, PWD and Pregnant Women receive priority tickets regardless of which service they select at Reception. Regular visitors remain in the standard queue. Within the same priority rank, tickets are served FIFO.
          </div>
          <p className="mb-4 text-sm text-navy-500">Lower rank number = higher priority. Set the order here; it applies globally to every service, including services added in the future.</p>
          <div className="space-y-3">
            {categories.map((cat) => (
              <div key={cat.id} className="flex items-center gap-3 rounded-lg border border-slate-200 p-3">
                <GripVertical className="h-5 w-5 text-navy-300" />
                <div className="grid flex-1 grid-cols-2 gap-3 sm:grid-cols-4">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-navy-400">Label (EN)</label>
                    <input className="input-field !py-1.5" value={cat.label_en} onChange={(e) => updateCategory(cat.id, { label_en: e.target.value })} />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-navy-400">Label (AR)</label>
                    <input className="input-field !py-1.5" dir="rtl" value={cat.label_ar} onChange={(e) => updateCategory(cat.id, { label_ar: e.target.value })} />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-navy-400">Priority Rank</label>
                    <input type="number" className="input-field !py-1.5" value={cat.priority_rank} onChange={(e) => updateCategory(cat.id, { priority_rank: Number(e.target.value) })} />
                  </div>
                  <div className="flex items-end gap-2">
                    <label className="flex items-center gap-2 text-sm text-navy-700">
                      <input type="checkbox" checked={!!cat.is_active} onChange={(e) => updateCategory(cat.id, { is_active: e.target.checked ? 1 : 0 })} /> Active
                    </label>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Ticket Numbering */}
        <div className="surface p-6">
          <h2 className="mb-4 text-sm font-bold uppercase tracking-wide text-navy-500">Ticket Numbering</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-navy-400">Ticket Number Padding</label>
              <input type="number" className="input-field" value={settings.ticket_padding ?? '3'} onChange={(e) => setSettings({ ...settings, ticket_padding: e.target.value })} />
              <p className="mt-1 text-xs text-navy-300">e.g. 3 = 001, 002</p>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-navy-400">Queue Mode</label>
              <select className="input-field" value={settings.queue_mode ?? 'priority'} onChange={(e) => setSettings({ ...settings, queue_mode: e.target.value })}>
                <option value="priority">Priority Lane + FIFO (recommended)</option>
                <option value="fifo">FIFO only (ignore priority order)</option>
              </select>
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
