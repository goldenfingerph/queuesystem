import { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, X, Users, ShieldCheck } from 'lucide-react';
import { api } from '@/lib/api';
import { AppLayout } from '@/components/AppLayout';
import { STAFF_ROLES, type StaffRole } from '@/types/domain';

interface CounterOption { id: number; number: number; name: string; is_active: number }
interface Assignment { id: number; user_id: number; counter_id: number; status: string; display_name: string; counter_number: number; counter_name: string }

interface StaffMember {
  id: number; username: string; display_name: string; role: StaffRole;
  is_active: number; created_at: string;
}

const ROLE_LABEL: Record<StaffRole, string> = {
  admin: 'Administrator',
  senior_clerk: 'Senior Clerk',
  service_officer: 'Service Officer',
  receptionist: 'Receptionist',
};

const ROLE_BADGE: Record<StaffRole, string> = {
  admin: 'bg-brand-50 text-brand-700',
  senior_clerk: 'bg-accent-50 text-accent-700',
  service_officer: 'bg-success-500/10 text-success-600',
  receptionist: 'bg-warning-500/10 text-warning-600',
};

export function StaffModule() {
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState({ username: '', password: '', display_name: '', role: 'receptionist' as StaffRole, is_active: true });
  const [error, setError] = useState('');
  const [counters, setCounters] = useState<CounterOption[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [assignUser, setAssignUser] = useState('');
  const [assignCounter, setAssignCounter] = useState('');
  const [assignmentError, setAssignmentError] = useState('');
  const [loadError, setLoadError] = useState('');

  const load = () => {
    setLoading(true);
    api.get<{ staff: StaffMember[] }>('/staff')
      .then((r) => { setStaff(r.staff); setLoadError(''); })
      .catch((err) => setLoadError(err instanceof Error ? err.message : 'Unable to load staff'))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const loadAssignments = async () => {
    try {
      const [counterResult, assignmentResult] = await Promise.all([
        api.get<{ counters: CounterOption[] }>('/counters'),
        api.get<{ assignments: Assignment[] }>('/staff/assignments'),
      ]);
      setCounters(counterResult.counters.filter((counter) => counter.is_active));
      setAssignments(assignmentResult.assignments);
      setAssignmentError('');
    } catch (err) {
      setAssignmentError(err instanceof Error ? err.message : 'Unable to load counter assignments');
    }
  };

  useEffect(() => { void loadAssignments(); }, []);

  const createAssignment = async () => {
    setAssignmentError('');
    try {
      await api.post('/staff/assignments', { user_id: Number(assignUser), counter_id: Number(assignCounter) });
      setAssignUser('');
      setAssignCounter('');
      await loadAssignments();
    } catch (err) {
      setAssignmentError(err instanceof Error ? err.message : 'Unable to assign staff');
    }
  };

  const changeAssignment = async (id: number, status: 'active' | 'break' | 'ended') => {
    setAssignmentError('');
    try {
      await api.put(`/staff/assignments/${id}`, { status });
      await loadAssignments();
    } catch (err) {
      setAssignmentError(err instanceof Error ? err.message : 'Unable to update assignment');
    }
  };

  const openAdd = () => {
    setEditId(null);
    setForm({ username: '', password: '', display_name: '', role: 'receptionist', is_active: true });
    setError('');
    setShowForm(true);
  };

  const openEdit = (s: StaffMember) => {
    setEditId(s.id);
    setForm({ username: s.username, password: '', display_name: s.display_name, role: s.role, is_active: !!s.is_active });
    setError('');
    setShowForm(true);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const username = form.username.trim();
    const displayName = form.display_name.trim();
    if (!displayName || displayName.length > 100) { setError('Display name is required and must be 100 characters or fewer.'); return; }
    if (!editId && !/^[a-zA-Z0-9._-]{3,64}$/.test(username)) { setError('Username must be 3–64 characters and use only letters, numbers, dots, underscores, or hyphens.'); return; }
    if (!editId && form.password.length < 8) { setError('Password must be at least 8 characters.'); return; }
    if (form.password && form.password.length < 8) { setError('Password must be at least 8 characters.'); return; }
    if (form.password.length > 128) { setError('Password must be 128 characters or fewer.'); return; }
    const body: Record<string, unknown> = { display_name: displayName, role: form.role, is_active: form.is_active };
      if (form.password) body.password = form.password;
      if (editId) {
        await api.put(`/staff/${editId}`, body);
      } else {
        await api.post('/staff', { ...form, username, display_name: displayName });
      }
      setShowForm(false);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    }
  };

  const del = async (s: StaffMember) => {
    if (!confirm(`Delete staff account "${s.display_name}"?`)) return;
    try { await api.del(`/staff/${s.id}`); load(); }
    catch (err) { alert(err instanceof Error ? err.message : 'Delete failed'); }
  };

  return (
    <AppLayout active="staff">
      <div className="p-6">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-navy-900">Staff Management</h1>
            <p className="text-sm text-navy-500">Manage accounts and role permissions</p>
          </div>
          <button onClick={openAdd} className="btn-primary focus-ring"><Plus className="h-4 w-4" /> Add Staff</button>
        </div>

        <section className="surface mb-6 p-5">
          <h2 className="mb-3 text-lg font-bold text-navy-900">Counter Assignments</h2>
          {assignmentError && <p className="mb-3 text-sm text-error-600">{assignmentError}</p>}
          <div className="mb-4 flex flex-wrap gap-2">
            <select className="input-field min-w-48 flex-1" value={assignUser} onChange={(e) => setAssignUser(e.target.value)}>
              <option value="">Choose active service officer</option>
              {staff.filter((s) => s.is_active && s.role === 'service_officer').map((s) => <option key={s.id} value={s.id}>{s.display_name}</option>)}
            </select>
            <select className="input-field min-w-48 flex-1" value={assignCounter} onChange={(e) => setAssignCounter(e.target.value)}>
              <option value="">Choose active counter</option>
              {counters.map((c) => <option key={c.id} value={c.id}>Counter {c.number} — {c.name}</option>)}
            </select>
            <button className="btn-primary" disabled={!assignUser || !assignCounter} onClick={createAssignment}>Assign</button>
          </div>
          <div className="space-y-2">
            {assignments.filter((a) => a.status !== 'ended').map((a) => <div key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-200 p-3 text-sm">
              <span>{a.display_name} → Counter {a.counter_number} ({a.counter_name})</span>
              <span className="flex items-center gap-2"><span className="badge">{a.status}</span>
                {a.status === 'active' && <button className="btn-ghost !py-1 !text-xs" onClick={() => changeAssignment(a.id, 'break')}>Break</button>}
                {a.status === 'break' && <button className="btn-ghost !py-1 !text-xs" onClick={() => changeAssignment(a.id, 'active')}>Resume</button>}
                <button className="btn-ghost !py-1 !text-xs !text-error-600" onClick={() => changeAssignment(a.id, 'ended')}>End</button>
              </span>
            </div>)}
            {!assignments.some((a) => a.status !== 'ended') && <p className="text-sm text-navy-400">No active assignments.</p>}
          </div>
        </section>

        {loadError && <div className="mb-4 text-sm text-error-600" role="alert">{loadError}<button onClick={load} className="ml-3 underline">Retry</button></div>}
        {loading ? <p className="text-navy-400">Loading...</p> : (
          <div className="surface overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-navy-500">
                  <tr>
                    <th className="px-5 py-3 text-left font-semibold">Name</th>
                    <th className="px-5 py-3 text-left font-semibold">Username</th>
                    <th className="px-5 py-3 text-left font-semibold">Role</th>
                    <th className="px-5 py-3 text-center font-semibold">Status</th>
                    <th className="px-5 py-3 text-right font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {staff.map((s) => (
                    <tr key={s.id} className="hover:bg-slate-50">
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-3">
                          <div className="grid h-9 w-9 place-items-center rounded-lg bg-navy-100 text-navy-600">
                            <Users className="h-4 w-4" />
                          </div>
                          <span className="font-medium text-navy-900">{s.display_name}</span>
                        </div>
                      </td>
                      <td className="px-5 py-3 text-navy-600">{s.username}</td>
                      <td className="px-5 py-3"><span className={`badge ${ROLE_BADGE[s.role]}`}>{ROLE_LABEL[s.role]}</span></td>
                      <td className="px-5 py-3 text-center">
                        <span className={`badge ${s.is_active ? 'bg-success-500/10 text-success-600' : 'bg-slate-100 text-navy-400'}`}>
                          {s.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex justify-end gap-1">
                          <button onClick={() => openEdit(s)} className="btn-ghost !py-1.5 !text-xs"><Pencil className="h-3.5 w-3.5" /> Edit</button>
                          <button onClick={() => del(s)} className="btn-ghost !py-1.5 !text-xs !text-error-600 hover:!bg-error-500/10"><Trash2 className="h-3.5 w-3.5" /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {showForm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <form onSubmit={save} className="surface w-full max-w-md p-6">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-lg font-bold text-navy-900"><ShieldCheck className="h-5 w-5 text-brand-600" /> {editId ? 'Edit Staff' : 'New Staff Account'}</h2>
                <button type="button" onClick={() => setShowForm(false)} className="text-navy-400 hover:text-navy-700"><X className="h-5 w-5" /></button>
              </div>
              {error && <p className="mb-3 rounded-lg bg-error-500/10 px-3 py-2 text-sm text-error-600">{error}</p>}
              <div className="space-y-3">
                <input className="input-field" placeholder="Display name" maxLength={100} value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} required />
                <input className="input-field" placeholder="Username" minLength={3} maxLength={64} pattern="[A-Za-z0-9._-]+" autoComplete="username" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} required disabled={!!editId} />
                <input className="input-field" type="password" minLength={8} maxLength={128} autoComplete={editId ? 'new-password' : 'new-password'} placeholder={editId ? 'New password (leave blank to keep)' : 'Password'} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required={!editId} />
                <select className="input-field" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as StaffRole })}>
                  {STAFF_ROLES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                </select>
                <label className="flex items-center gap-2 text-sm text-navy-700">
                  <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} /> Active
                </label>
              </div>
              <button type="submit" className="btn-primary mt-4 w-full">Save</button>
            </form>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
