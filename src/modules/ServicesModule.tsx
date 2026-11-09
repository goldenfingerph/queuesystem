import { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, X, Loader2, ConciergeBell } from 'lucide-react';
import { api } from '@/lib/api';
import { AppLayout } from '@/components/AppLayout';

interface Service {
  id: number; name: string; name_ar: string; code: string; description: string; prefix: string;
  avg_duration_sec: number; is_active: number; assigned_counters: number; ticket_range_start: number; ticket_range_end: number;
}

export function ServicesModule() {
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState({ name: '', name_ar: '', code: '', description: '', prefix: '', avg_duration_sec: 300, is_active: true, ticket_range_start: 4500, ticket_range_end: 4999 });
  const [error, setError] = useState('');

  const load = () => {
    setLoading(true);
    api.get<{ services: Service[] }>('/services')
      .then((r) => { setServices(r.services); setError(''); })
      .catch((err) => setError(err instanceof Error ? err.message : 'Unable to load services'))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const openAdd = () => {
    setEditId(null);
    setForm({ name: '', name_ar: '', code: '', description: '', prefix: '', avg_duration_sec: 300, is_active: true, ticket_range_start: 4500, ticket_range_end: 4999 });
    setError('');
    setShowForm(true);
  };

  const openEdit = (s: Service) => {
    setEditId(s.id);
    setForm({ name: s.name, name_ar: s.name_ar ?? '', code: s.code, description: s.description, prefix: s.prefix, avg_duration_sec: s.avg_duration_sec, is_active: !!s.is_active, ticket_range_start: s.ticket_range_start, ticket_range_end: s.ticket_range_end });
    setError('');
    setShowForm(true);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const name = form.name.trim();
    const nameAr = form.name_ar.trim();
    const code = form.code.trim();
    const prefix = form.prefix.trim();
    if (!name || !nameAr || !code || !prefix) { setError('Complete all required service fields.'); return; }
    if (name.length > 100 || nameAr.length > 100 || code.length > 12 || prefix.length > 12) { setError('Names must be 100 characters or fewer; code and prefix must be 12 characters or fewer.'); return; }
    if (!Number.isInteger(form.ticket_range_start) || !Number.isInteger(form.ticket_range_end) || form.ticket_range_start < 1000 || form.ticket_range_end > 9999 || form.ticket_range_start > form.ticket_range_end) { setError('Enter a valid 4-digit ticket range with start less than or equal to end.'); return; }
    if (!Number.isInteger(form.avg_duration_sec) || form.avg_duration_sec < 1 || form.avg_duration_sec > 86400) { setError('Average duration must be between 1 and 86,400 seconds.'); return; }
    const payload = { ...form, name, name_ar: nameAr, code, prefix, description: form.description.trim() };
    try {
      if (editId) {
        await api.put(`/services/${editId}`, payload);
      } else {
        await api.post('/services', payload);
      }
      setShowForm(false);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    }
  };

  const toggle = async (s: Service) => {
    await api.put(`/services/${s.id}`, { is_active: !s.is_active });
    load();
  };

  const del = async (s: Service) => {
    if (!confirm(`Delete service "${s.name}"? This cannot be undone if it has no tickets.`)) return;
    try {
      await api.del(`/services/${s.id}`);
      load();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  return (
    <AppLayout active="services">
      <div className="p-6">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-navy-900">Services Management</h1>
            <p className="text-sm text-navy-500">Create and manage service categories</p>
          </div>
          <button onClick={openAdd} className="btn-primary focus-ring">
            <Plus className="h-4 w-4" /> Add Service
          </button>
        </div>

        {error && <div className="mb-4 rounded-lg bg-error-500/10 px-4 py-2 text-sm text-error-600" role="alert">{error}<button onClick={load} className="ml-3 underline">Retry</button></div>}
        {loading ? <p className="text-navy-400">Loading...</p> : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {services.map((s) => (
              <div key={s.id} className="surface p-5">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="grid h-11 w-11 place-items-center rounded-lg bg-brand-50 text-brand-600">
                      <ConciergeBell className="h-5 w-5" />
                    </div>
                    <div>
                      <h3 className="font-bold text-navy-900">{s.name}</h3>
                      <p className="text-sm text-navy-500" dir="rtl">{s.name_ar}</p>
                      <p className="text-xs text-navy-400">{s.code} · Ticket range: {s.ticket_range_start}–{s.ticket_range_end}</p>
                    </div>
                  </div>
                  <span className={`badge ${s.is_active ? 'bg-success-500/10 text-success-600' : 'bg-slate-100 text-navy-400'}`}>
                    {s.is_active ? 'Active' : 'Inactive'}
                  </span>
                </div>
                {s.description && <p className="mt-3 text-sm text-navy-600">{s.description}</p>}
                <p className="mt-2 text-xs text-navy-400">Avg duration: {Math.round(s.avg_duration_sec / 60)} min · Assigned to {s.assigned_counters} counter(s)</p>
                <div className="mt-4 flex gap-2 border-t border-slate-100 pt-3">
                  <button onClick={() => openEdit(s)} className="btn-ghost !py-1.5 !text-xs"><Pencil className="h-3.5 w-3.5" /> Edit</button>
                  <button onClick={() => toggle(s)} className="btn-ghost !py-1.5 !text-xs">{s.is_active ? 'Disable' : 'Enable'}</button>
                  <button onClick={() => del(s)} className="btn-ghost !py-1.5 !text-xs !text-error-600 hover:!bg-error-500/10"><Trash2 className="h-3.5 w-3.5" /> Delete</button>
                </div>
              </div>
            ))}
          </div>
        )}

        {showForm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <form onSubmit={save} className="surface w-full max-w-md p-6">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-bold text-navy-900">{editId ? 'Edit Service' : 'New Service'}</h2>
                <button type="button" onClick={() => setShowForm(false)} className="text-navy-400 hover:text-navy-700"><X className="h-5 w-5" /></button>
              </div>
              {error && <p className="mb-3 rounded-lg bg-error-500/10 px-3 py-2 text-sm text-error-600">{error}</p>}
              <div className="space-y-3">
                <input className="input-field" placeholder="Service name (English)" maxLength={100} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
                <input className="input-field text-right" dir="rtl" placeholder="اسم الخدمة باللغة العربية (Arabic service name)" maxLength={100} value={form.name_ar} onChange={(e) => setForm({ ...form, name_ar: e.target.value })} required />
                <div className="grid grid-cols-2 gap-3">
                  <input className="input-field" placeholder="Code (e.g. NA)" maxLength={12} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} required />
                  <input className="input-field" placeholder="Prefix (e.g. NA)" maxLength={12} value={form.prefix} onChange={(e) => setForm({ ...form, prefix: e.target.value })} required />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <label className="text-xs text-navy-500">Ticket range start<input className="input-field mt-1" type="number" min="1000" max="9999" value={form.ticket_range_start} onChange={(e) => setForm({ ...form, ticket_range_start: Number(e.target.value) })} required /></label>
                  <label className="text-xs text-navy-500">Ticket range end<input className="input-field mt-1" type="number" min="1000" max="9999" value={form.ticket_range_end} onChange={(e) => setForm({ ...form, ticket_range_end: Number(e.target.value) })} required /></label>
                </div>
                <p className="text-xs text-navy-400">Each service must have a unique, non-overlapping 4-digit range. Numbering resets daily at 6:00 AM Abu Dhabi time.</p>
                <textarea className="input-field" maxLength={500} placeholder="Description (optional)" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} />
                <label className="flex items-center gap-2 text-sm text-navy-700">
                  <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} /> Active
                </label>
              </div>
              <button type="submit" className="btn-primary mt-4 w-full"><Loader2 className="hidden h-4 w-4" /> Save</button>
            </form>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
