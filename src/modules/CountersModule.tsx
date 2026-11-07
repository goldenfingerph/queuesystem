import { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, X, MonitorCheck } from 'lucide-react';
import { api } from '@/lib/api';
import { AppLayout } from '@/components/AppLayout';

interface Counter {
  id: number; number: number; name: string; is_active: number;
  service_ids: number[]; active_user_id: number | null;
}
interface Service { id: number; name: string; code: string }

export function CountersModule() {
  const [counters, setCounters] = useState<Counter[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editCounter, setEditCounter] = useState<Counter | null>(null);
  const [form, setForm] = useState({ number: 1, name: '' });
  const [selectedServices, setSelectedServices] = useState<number[]>([]);
  const [error, setError] = useState('');
  const [servicesError, setServicesError] = useState('');
  const [saving, setSaving] = useState(false);
  const [busyCounterId, setBusyCounterId] = useState<number | null>(null);

  const load = () => {
    setLoading(true);
    setError('');
    Promise.all([
      api.get<{ counters: Counter[] }>('/counters'),
      api.get<{ services: Service[] }>('/services'),
    ]).then(([counterResult, serviceResult]) => {
      setCounters(counterResult.counters);
      setServices(serviceResult.services);
      setServicesError('');
    }).catch((err) => {
      setError(err instanceof Error ? err.message : 'Unable to load counters and services');
    }).finally(() => setLoading(false));
  };

  useEffect(load, []);

  const openAdd = () => {
    const maxNum = counters.reduce((mx, c) => Math.max(mx, c.number), 0);
    setEditCounter(null);
    setForm({ number: maxNum + 1, name: '' });
    setSelectedServices([]);
    setError('');
    setShowForm(true);
  };

  const openEdit = (c: Counter) => {
    setEditCounter(c);
    setForm({ number: c.number, name: c.name });
    setSelectedServices(c.service_ids);
    setError('');
    setShowForm(true);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    let counterSaved = false;
    try {
      if (editCounter) {
        await api.put(`/counters/${editCounter.id}`, { number: form.number, name: form.name, is_active: editCounter.is_active });
        counterSaved = true;
        await api.put(`/counters/${editCounter.id}/services`, { serviceIds: selectedServices });
      } else {
        const r = await api.post<{ id: number }>('/counters', form);
        counterSaved = true;
        await api.put(`/counters/${r.id}/services`, { serviceIds: selectedServices });
      }
      setShowForm(false);
      load();
    } catch (err) {
      const detail = err instanceof Error ? err.message : 'Save failed';
      setError(counterSaved ? `Counter saved, but service assignments failed. Please retry. Details: ${detail}` : detail);
      if (counterSaved) load();
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (c: Counter) => {
    setBusyCounterId(c.id);
    setError('');
    try {
      await api.put(`/counters/${c.id}`, { is_active: !c.is_active });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update counter status');
    } finally {
      setBusyCounterId(null);
    }
  };

  const del = async (c: Counter) => {
    if (!confirm(`Delete counter ${c.number}?`)) return;
    try { await api.del(`/counters/${c.id}`); load(); }
    catch (err) { alert(err instanceof Error ? err.message : 'Delete failed'); }
  };

  return (
    <AppLayout active="counters">
      <div className="p-6">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-navy-900">Counters Management</h1>
            <p className="text-sm text-navy-500">Configure service counters — supports 20+</p>
          </div>
          <button onClick={openAdd} className="btn-primary focus-ring"><Plus className="h-4 w-4" /> Add Counter</button>
        </div>

        {error && <div className="mb-4 rounded-lg bg-error-500/10 px-4 py-2 text-sm text-error-600" role="alert">{error}<button onClick={load} className="ml-3 underline">Retry</button></div>}
        {servicesError && <p className="mb-3 text-sm text-error-600" role="alert">{servicesError}</p>}
        {loading ? <p className="text-navy-400">Loading...</p> : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {counters.map((c) => (
              <div key={c.id} className="surface p-5">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`grid h-11 w-11 place-items-center rounded-lg ${c.is_active ? 'bg-brand-50 text-brand-600' : 'bg-slate-100 text-navy-400'}`}>
                      <MonitorCheck className="h-5 w-5" />
                    </div>
                    <div>
                      <h3 className="font-bold text-navy-900">Counter {c.number}</h3>
                      <p className="text-xs text-navy-400">{c.name}</p>
                    </div>
                  </div>
                  <span className={`badge ${c.is_active ? 'bg-success-500/10 text-success-600' : 'bg-slate-100 text-navy-400'}`}>
                    {c.active_user_id ? 'In Use' : c.is_active ? 'Open' : 'Closed'}
                  </span>
                </div>
                <div className="mt-3">
                  <p className="text-[11px] font-semibold uppercase text-navy-400">Services</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {c.service_ids.length === 0 ? <span className="text-xs text-navy-300">None assigned</span> :
                      c.service_ids.map((sid) => {
                        const svc = services.find((s) => s.id === sid);
                        return <span key={sid} className="badge bg-brand-50 text-brand-600">{svc?.code ?? sid}</span>;
                      })}
                  </div>
                </div>
                <div className="mt-4 flex gap-2 border-t border-slate-100 pt-3">
                  <button onClick={() => openEdit(c)} className="btn-ghost !py-1.5 !text-xs"><Pencil className="h-3.5 w-3.5" /> Edit</button>
                  <button onClick={() => toggle(c)} disabled={busyCounterId === c.id} className="btn-ghost !py-1.5 !text-xs disabled:opacity-50">{busyCounterId === c.id ? "Saving..." : c.is_active ? 'Close' : 'Open'}</button>
                  <button onClick={() => del(c)} className="btn-ghost !py-1.5 !text-xs !text-error-600 hover:!bg-error-500/10"><Trash2 className="h-3.5 w-3.5" /></button>
                </div>
              </div>
            ))}
          </div>
        )}

        {showForm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <form onSubmit={save} className="surface w-full max-w-md p-6">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-bold text-navy-900">{editCounter ? 'Edit Counter' : 'New Counter'}</h2>
                <button type="button" onClick={() => setShowForm(false)} className="text-navy-400 hover:text-navy-700"><X className="h-5 w-5" /></button>
              </div>
              {error && <p className="mb-3 rounded-lg bg-error-500/10 px-3 py-2 text-sm text-error-600">{error}</p>}
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <input type="number" min={1} step={1} className="input-field" placeholder="Number" value={form.number} onChange={(e) => setForm({ ...form, number: Number(e.target.value) })} required />
                  <input className="input-field" placeholder="Name (e.g. Front Desk)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
                </div>
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase text-navy-500">Assigned Services</p>
                  <div className="max-h-48 space-y-1.5 overflow-y-auto rounded-lg border border-slate-200 p-2">
                    {services.map((s) => (
                      <label key={s.id} className="flex items-center gap-2 text-sm text-navy-700">
                        <input type="checkbox" checked={selectedServices.includes(s.id)} onChange={(e) => {
                          if (e.target.checked) setSelectedServices([...selectedServices, s.id]);
                          else setSelectedServices(selectedServices.filter((id) => id !== s.id));
                        }} />
                        {s.name} ({s.code})
                      </label>
                    ))}
                    {services.length === 0 && <p className="text-xs text-navy-300">No services created yet.</p>}
                  </div>
                </div>
              </div>
              <button type="submit" disabled={saving} className="btn-primary mt-4 w-full disabled:opacity-50">{saving ? "Saving..." : "Save"}</button>
            </form>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
