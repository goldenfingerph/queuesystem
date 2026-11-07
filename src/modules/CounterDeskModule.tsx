import { useEffect, useState, useCallback } from 'react';
import { Headset, Phone, PhoneCall, CheckCircle, XCircle, ArrowRightLeft, Volume2, ListChecks } from 'lucide-react';
import { api } from '@/lib/api';
import { useWebSocket } from '@/lib/useWebSocket';
import { AppLayout } from '@/components/AppLayout';
import { useAuth } from '@/lib/auth-context';

interface Counter { id: number; number: number; name: string; is_active: number; service_ids: number[]; active_user_id?: number | null }
interface Service { id: number; name: string; name_ar?: string; code: string; prefix: string }
interface Ticket {
  id: number; number: string; status: string; priority_rank: number; created_at: string; service_id: number;
  service_name?: string; service_name_ar?: string; service_prefix?: string; category_label?: string; category_label_ar?: string;
  called_at?: string; served_at?: string;
}
interface WaitingTicket { id: number; number: string; priority_rank: number; transfer_priority?: number; created_at: string; service_id: number; service_name: string; service_name_ar?: string; service_prefix: string; category_label?: string; category_label_ar?: string }

export function CounterDeskModule() {
  const { user } = useAuth();
  const [counters, setCounters] = useState<Counter[]>([]);
  const [transferCounters, setTransferCounters] = useState<Counter[]>([]);
  const [transferCounterId, setTransferCounterId] = useState<number | ''>('');
  const [transferServiceId, setTransferServiceId] = useState<number | ''>('');
  const [services, setServices] = useState<Service[]>([]);
  const [selectedCounter, setSelectedCounter] = useState<number | null>(null);
  const [active, setActive] = useState<Ticket | null>(null);
  const [waiting, setWaiting] = useState<WaitingTicket[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const { lastMessage } = useWebSocket();

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.get<{ counters: Counter[] }>('/counters'),
      api.get<{ services: Service[] }>('/services'),
    ]).then(([counterResult, serviceResult]) => {
      if (cancelled) return;
      const allActiveCounters = counterResult.counters.filter((c) => Boolean(c.is_active));
      const activeCounters = allActiveCounters.filter((c) => user?.role !== 'service_officer' || Number(c.active_user_id) === user.id);
      setTransferCounters(allActiveCounters);
      setCounters(activeCounters);
      setServices(serviceResult.services);
      if (activeCounters.length === 1) setSelectedCounter(activeCounters[0].id);
      if (user?.role === 'service_officer' && activeCounters.length === 0) {
        setError('You do not have an active counter assignment. Please ask an administrator to assign your counter.');
      }
    }).catch((err) => {
      if (!cancelled) setError(err instanceof Error ? err.message : 'Unable to load counters');
    });
    return () => { cancelled = true; };
  }, [user?.id, user?.role]);

  const loadState = useCallback(async () => {
    if (!selectedCounter) {
      setActive(null);
      setWaiting([]);
      return;
    }
    try {
      const r = await api.get<{ active: Ticket | null; waiting: WaitingTicket[] }>(`/tickets/counter/${selectedCounter}/active`);
      setActive(r.active ?? null);
      setWaiting(r.waiting ?? []);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load counter queue');
    }
  }, [selectedCounter]);

  useEffect(() => { void loadState(); }, [loadState]);

  useEffect(() => {
    if (lastMessage && (
      lastMessage.type === 'queue-updated' ||
      lastMessage.type.startsWith('ticket') ||
      lastMessage.type === 'counters-updated' ||
      lastMessage.type === 'staff-updated'
    )) {
      void loadState();
    }
  }, [lastMessage, loadState]);

  const action = async (name: string, path: string, body: Record<string, unknown> = {}): Promise<boolean> => {
    setError('');
    setBusy(name);
    try {
      await api.post(path, body);
      await loadState();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : `${name} failed`);
      return false;
    } finally {
      setBusy('');
    }
  };

  const callNext = () => action('call-next', '/tickets/call-next', { counter_id: selectedCounter });
  const recall = () => active && action('recall', '/tickets/recall', { ticket_id: active.id });
  const startServing = () => active && action('start', '/tickets/start-serving', { ticket_id: active.id });
  const complete = () => active && action('complete', '/tickets/complete', { ticket_id: active.id });
  const skip = () => {
    if (!active || !window.confirm(`Mark ticket ${active.number} as no-show and release this counter?`)) return;
    void action('skip', '/tickets/skip', { ticket_id: active.id });
  };

  const destinationCounter = transferCounters.find((c) => c.id === Number(transferCounterId));
  const destinationServices = services.filter((svc) => destinationCounter?.service_ids.includes(svc.id) && svc.id !== active?.service_id);
  const transferTicket = async () => {
    if (!active || !transferCounterId || !transferServiceId) return;
    if (!window.confirm('Transfer ' + active.number + ' to Counter ' + destinationCounter?.number + '? The ticket number will stay the same. This customer will receive transfer priority at the destination counter.')) return;
    const succeeded = await action('transfer', '/tickets/transfer', { ticket_id: active.id, to_service_id: transferServiceId, to_counter_id: transferCounterId });
    if (succeeded) { setTransferCounterId(''); setTransferServiceId(''); }
  };

  const canCallNext = !active || (active.status !== 'called' && active.status !== 'serving');

  return (
    <AppLayout active="counter-desk">
      <div className="p-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-navy-900">Counter Desk <span className="text-lg" dir="rtl">مكتب الكاونتر</span></h1>
          <p className="text-sm text-navy-500">Call and serve tickets from your assigned counter · نادِ التذاكر وخدم الزوار من الكاونتر المخصص لك</p>
        </div>

        {/* Counter selector */}
        {counters.length > 0 && (
          <div className="surface mb-6 p-4">
            <label className="mb-2 block text-xs font-semibold uppercase text-navy-400">Select Your Counter · اختر الكاونتر</label>
            <div className="flex flex-wrap gap-2">
              {counters.map((c) => (
                <button key={c.id} onClick={() => setSelectedCounter(c.id)}
                  className={`rounded-lg border px-4 py-2.5 text-sm font-semibold transition-all ${selectedCounter === c.id ? 'border-brand-500 bg-brand-600 text-white' : 'border-slate-200 text-navy-700 hover:border-brand-300'}`}>
                  <span className="flex items-center gap-2"><Headset className="h-4 w-4" /> Counter {c.number}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {selectedCounter && (() => {
          const myCounter = counters.find((counter) => counter.id === selectedCounter);
          const assignedServices = services.filter((service) => myCounter?.service_ids?.includes(service.id));
          return (
            <section className="surface mb-6 p-5">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="flex items-center gap-2 text-base font-bold text-navy-900">
                    <Headset className="h-5 w-5 text-brand-600" /> My Counter
                  </h2>
                  <p className="mt-1 text-sm text-navy-500">
                    {myCounter ? `Counter ${myCounter.number} · ${myCounter.name}` : 'Your assigned counter · الكاونتر المخصص لك'}
                  </p>
                </div>
                <span className="rounded-full bg-brand-50 px-3 py-1 text-sm font-semibold text-brand-700">
                  {assignedServices.length} assigned services · {assignedServices.length === 1 ? 'خدمة مخصصة' : 'خدمات مخصصة'}
                </span>
              </div>
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-navy-400">My Assigned Services · الخدمات المخصصة لي</div>
              {assignedServices.length === 0 ? (
                <p className="rounded-lg border border-dashed border-slate-200 px-4 py-3 text-sm text-navy-400">
                  No services assigned to this counter · لا توجد خدمات مخصصة لهذا الكاونتر. Please ask an administrator to update the counter assignment · يرجى مراجعة المسؤول لتحديث التخصيص.
                </p>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {assignedServices.map((service) => {
                    const waitingCount = waiting.filter((ticket) => ticket.service_id === service.id).length;
                    return (
                      <div key={service.id} className="flex items-center justify-between gap-3 rounded-xl border border-brand-200 bg-brand-50/60 p-4">
                        <div className="min-w-0">
                          <p className="font-semibold text-navy-900">{service.name}</p><p className="text-sm text-navy-600" dir="rtl" lang="ar">{service.name_ar}</p>
                          <p className="mt-1 text-xs text-navy-500">{service.code} · Queue waiting / انتظار في الطابور</p>
                        </div>
                        <span className="flex h-10 min-w-10 items-center justify-center rounded-lg bg-brand-600 px-2 text-lg font-bold text-white">
                          {waitingCount}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })()}

        {error && <div className="mb-4 rounded-lg bg-error-500/10 px-4 py-2 text-sm text-error-600">{error}</div>}

        {!selectedCounter ? (
          <div className="surface flex flex-col items-center justify-center py-20 text-navy-300">
            <Headset className="mb-3 h-12 w-12" />
            <p className="text-sm">{user?.role === 'service_officer' ? 'No active counter assigned to your account' : 'Select a counter to begin'}</p>
          </div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-3">
            {/* Active Ticket */}
            <div className="lg:col-span-2">
              <div className="surface p-6">
                <h2 className="mb-4 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-navy-500">
                  <PhoneCall className="h-4 w-4" /> Now Serving
                </h2>
                {active ? (
                  <div>
                    <div className="rounded-2xl bg-gradient-to-br from-navy-900 to-navy-950 p-8 text-center">
                      <p className="text-xs font-semibold uppercase tracking-widest text-brand-200">
                        {active.status === 'serving' ? 'In Progress · قيد الخدمة' : 'Called · تم النداء'}
                      </p>
                      <p className="my-3 text-6xl font-bold text-white tracking-wider">{active.number}</p>
                      <p className="text-sm text-brand-200">{active.service_name}</p><p className="text-sm text-brand-100" dir="rtl" lang="ar">{active.service_name_ar}</p>
                      {active.category_label && <p className="mt-1 text-xs text-navy-300">{active.category_label} · <span dir="rtl">{active.category_label_ar}</span></p>}
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {active.status === 'called' && <button onClick={recall} disabled={!!busy} className="btn bg-accent-50 text-accent-700 hover:bg-accent-100 focus-ring">
                        <Volume2 className="h-4 w-4" /> Recall
                      </button>}
                      {active.status === 'called' && (
                        <button onClick={startServing} disabled={!!busy} className="btn bg-brand-50 text-brand-700 hover:bg-brand-100 focus-ring">
                          <ListChecks className="h-4 w-4" /> Start Serving
                        </button>
                      )}
                      <button onClick={complete} disabled={!!busy} className="btn bg-success-500/10 text-success-600 hover:bg-success-500/20 focus-ring">
                        <CheckCircle className="h-4 w-4" /> Complete
                      </button>
                      <button onClick={skip} disabled={!!busy} className="btn bg-error-500/10 text-error-600 hover:bg-error-500/20 focus-ring">
                        <XCircle className="h-4 w-4" /> Skip
                      </button>
                      <div className="mt-3 flex w-full flex-wrap items-end gap-2 rounded-lg border border-slate-200 p-3">
                        <div className="min-w-[150px] flex-1"><label className="mb-1 block text-xs font-semibold text-navy-500">Transfer to counter · تحويل إلى كاونتر</label><select className="input w-full" value={transferCounterId} onChange={(e) => { setTransferCounterId(e.target.value ? Number(e.target.value) : ''); setTransferServiceId(''); }}><option value="">Select counter · اختر الكاونتر</option>{transferCounters.filter((c) => c.id !== selectedCounter && c.service_ids.some((id) => id !== active.service_id)).map((c) => <option key={c.id} value={c.id}>Counter {c.number} — {c.name}</option>)}</select></div>
                        <div className="min-w-[150px] flex-1"><label className="mb-1 block text-xs font-semibold text-navy-500">Destination service · الخدمة الوجهة</label><select className="input w-full" value={transferServiceId} onChange={(e) => setTransferServiceId(e.target.value ? Number(e.target.value) : '')} disabled={!transferCounterId}><option value="">Select service · اختر الخدمة</option>{destinationServices.map((svc) => <option key={svc.id} value={svc.id}>{svc.name} · {svc.name_ar}</option>)}</select></div>
                        <button onClick={transferTicket} disabled={!!busy || !transferCounterId || !transferServiceId} className="btn bg-brand-50 text-brand-700 hover:bg-brand-100 focus-ring"><ArrowRightLeft className="h-4 w-4" /> Transfer</button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-16 text-navy-300">
                    <PhoneCall className="mb-3 h-12 w-12" />
                    <p className="text-sm">No active ticket · لا توجد تذكرة نشطة</p>
                    <button onClick={callNext} disabled={!!busy} className="btn-primary mt-4 focus-ring">
                      <Phone className="h-4 w-4" /> {busy === 'call-next' ? 'Calling... · جارٍ النداء' : 'Call Next · نادِ التالي'}
                    </button>
                  </div>
                )}
                {active && canCallNext && (
                  <button onClick={callNext} disabled={!!busy} className="btn-primary mt-4 w-full focus-ring">
                    <Phone className="h-4 w-4" /> {busy === 'call-next' ? 'Calling...' : 'Call Next'}
                  </button>
                )}
              </div>
            </div>

            {/* Waiting Queue */}
            <div className="surface p-6">
              <h2 className="mb-4 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-navy-500">
                <ListChecks className="h-4 w-4" /> Waiting Queue ({waiting.length})
              </h2>
              {waiting.length === 0 ? (
                <p className="py-8 text-center text-sm text-navy-300">No tickets waiting · لا توجد تذاكر في الانتظار</p>
              ) : (
                <div className="space-y-2 overflow-y-auto" style={{ maxHeight: '500px' }}>
                  {waiting.map((t, i) => (
                    <div key={t.id} className={`flex items-center gap-3 rounded-lg border p-3 ${i === 0 ? 'border-brand-300 bg-brand-50' : 'border-slate-200'}`}>
                      <span className="font-mono text-sm font-bold text-navy-900">{t.number}</span>
                      <div className="flex-1">
                        <p className="text-xs text-navy-500">{t.service_name}</p><p className="text-xs text-navy-600" dir="rtl" lang="ar">{t.service_name_ar}</p>
                        {t.category_label && <span className="badge bg-warning-500/10 text-warning-600">{t.category_label} · {t.category_label_ar}</span>}
                      </div>
                      {t.transfer_priority === 1 && <span className="badge bg-brand-50 text-brand-700">Transfer Priority · أولوية التحويل</span>}{t.priority_rank <= 3 && <span className="badge bg-warning-500/10 text-warning-600">Priority · أولوية</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
