import { useEffect, useState, type FormEvent } from 'react';
import { CalendarDays, Search, RefreshCw, History, ChevronLeft, ChevronRight } from 'lucide-react';
import { api } from '@/lib/api';
import { AppLayout } from '@/components/AppLayout';
import { getBusinessDate } from '../../shared/business-date';

interface Service { id: number; name: string }
interface TicketRow {
  id: number;
  number: number | string;
  status: 'waiting' | 'called' | 'serving' | 'completed' | 'no_show' | 'transferred';
  priority: string;
  business_date: string;
  created_at: string;
  called_at?: string | null;
  completed_at?: string | null;
  service_name?: string | null;
  service_prefix?: string | null;
  counter_number?: number | null;
  category_label?: string | null;
}
interface TicketResponse {
  tickets: TicketRow[];
  pagination: { page: number; limit: number; total: number; totalPages: number; hasNextPage: boolean; hasPreviousPage: boolean };
}

const STATUS_LABEL: Record<TicketRow['status'], string> = {
  waiting: 'Waiting', called: 'Called', serving: 'Serving',
  completed: 'Completed', no_show: 'No-show', transferred: 'Transferred',
};
const STATUS_STYLE: Record<TicketRow['status'], string> = {
  waiting: 'bg-amber-50 text-amber-700', called: 'bg-blue-50 text-blue-700',
  serving: 'bg-violet-50 text-violet-700', completed: 'bg-emerald-50 text-emerald-700',
  no_show: 'bg-rose-50 text-rose-700', transferred: 'bg-slate-100 text-slate-700',
};
const dateDaysAgo = (days: number) => {
  const date = new Date();
  date.setDate(date.getDate() - days);
  const year = date.getFullYear();
  return `${year}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};
const formatDateTime = (value: string | null | undefined) => {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
};

export function TicketHistoryModule() {
  const [services, setServices] = useState<Service[]>([]);
  const [fromDate, setFromDate] = useState(dateDaysAgo(6));
  const [toDate, setToDate] = useState(getBusinessDate());
  const [status, setStatus] = useState('');
  const [serviceId, setServiceId] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [refreshKey, setRefreshKey] = useState(0);
  const [data, setData] = useState<TicketResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get<{ services: Service[] }>('/services')
      .then((result) => setServices(result.services))
      .catch(() => setServices([]));
  }, []);

  useEffect(() => {
    if (!fromDate || !toDate || fromDate > toDate) {
      setData(null);
      setLoading(false);
      setError('Choose a valid date range. The start date must not be after the end date.');
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError('');
    const params = new URLSearchParams({ fromDate, toDate, page: String(page), limit: '50' });
    if (status) params.set('status', status);
    if (serviceId) params.set('serviceId', serviceId);
    if (search) params.set('search', search);
    api.get<TicketResponse>(`/tickets?${params.toString()}`)
      .then((result) => { if (!cancelled) setData(result); })
      .catch((err: unknown) => {
        if (!cancelled) {
          setData(null);
          setError(err instanceof Error ? err.message : 'Unable to load ticket history.');
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [fromDate, toDate, status, serviceId, search, page, refreshKey]);

  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    setPage(1);
    setSearch(searchInput.trim());
  };
  const updateFilter = (setter: (value: string) => void) => (value: string) => {
    setter(value);
    setPage(1);
  };

  return (
    <AppLayout active="ticket-history">
      <div className="p-6">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <History className="h-6 w-6 text-brand-600" />
              <h1 className="text-2xl font-bold text-navy-900">Ticket History · سجل التذاكر</h1>
            </div>
            <p className="mt-1 text-sm text-navy-500">Search and review tickets across business dates.</p>
          </div>
          <button type="button" onClick={() => setRefreshKey((current) => current + 1)} className="btn bg-white text-navy-700 hover:bg-slate-50">
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>
        </div>

        <section className="surface mb-5 p-4" aria-label="Ticket history filters">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <label className="text-xs font-semibold text-navy-500">
              <span className="mb-1 flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" /> From date</span>
              <input type="date" className="input-field w-full" value={fromDate} onChange={(event) => updateFilter(setFromDate)(event.target.value)} />
            </label>
            <label className="text-xs font-semibold text-navy-500">
              <span className="mb-1 block">To date</span>
              <input type="date" className="input-field w-full" value={toDate} onChange={(event) => updateFilter(setToDate)(event.target.value)} />
            </label>
            <label className="text-xs font-semibold text-navy-500">
              <span className="mb-1 block">Status</span>
              <select className="input-field w-full" value={status} onChange={(event) => updateFilter(setStatus)(event.target.value)}>
                <option value="">All statuses</option>
                {Object.entries(STATUS_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label className="text-xs font-semibold text-navy-500">
              <span className="mb-1 block">Service</span>
              <select className="input-field w-full" value={serviceId} onChange={(event) => updateFilter(setServiceId)(event.target.value)}>
                <option value="">All services</option>
                {services.map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}
              </select>
            </label>
            <form onSubmit={submitSearch} className="text-xs font-semibold text-navy-500">
              <label htmlFor="ticket-history-search" className="mb-1 block">Ticket / service search</label>
              <div className="flex gap-2">
                <input id="ticket-history-search" className="input-field min-w-0 flex-1" value={searchInput} maxLength={80} onChange={(event) => setSearchInput(event.target.value)} placeholder="Ticket number or service" />
                <button className="btn-primary px-3" type="submit" aria-label="Search tickets"><Search className="h-4 w-4" /></button>
              </div>
            </form>
          </div>
        </section>

        <section className="surface overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-5 py-3">
            <h2 className="text-sm font-bold text-navy-800">Historical Tickets</h2>
            <p className="text-xs text-navy-500">{data ? `${data.pagination.total.toLocaleString()} matching tickets` : ' '}</p>
          </div>
          {loading ? <p className="p-6 text-sm text-navy-500">Loading ticket history…</p> : error ? (
            <div className="p-6 text-sm text-error-600" role="alert">{error}</div>
          ) : !data || data.tickets.length === 0 ? (
            <p className="p-8 text-center text-sm text-navy-400">No tickets found for the selected filters.</p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[900px] text-sm">
                  <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-navy-500">
                    <tr>
                      <th className="px-4 py-3">Ticket</th><th className="px-4 py-3">Service</th>
                      <th className="px-4 py-3">Category</th><th className="px-4 py-3">Business date</th>
                      <th className="px-4 py-3">Created</th><th className="px-4 py-3">Counter</th>
                      <th className="px-4 py-3">Priority</th><th className="px-4 py-3">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.tickets.map((ticket) => (
                      <tr key={ticket.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3 font-bold text-navy-900">{ticket.service_prefix || ''}{ticket.number}</td>
                        <td className="px-4 py-3 text-navy-700">{ticket.service_name || '—'}</td>
                        <td className="px-4 py-3 text-navy-600">{ticket.category_label || '—'}</td>
                        <td className="px-4 py-3 tabular-nums text-navy-600">{ticket.business_date}</td>
                        <td className="px-4 py-3 text-navy-600">{formatDateTime(ticket.created_at)}</td>
                        <td className="px-4 py-3 text-navy-600">{ticket.counter_number ?? '—'}</td>
                        <td className="px-4 py-3 capitalize text-navy-600">{ticket.priority || 'normal'}</td>
                        <td className="px-4 py-3"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_STYLE[ticket.status]}`}>{STATUS_LABEL[ticket.status]}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center justify-between border-t border-slate-200 px-5 py-3">
                <p className="text-xs text-navy-500">Page {data.pagination.page} of {Math.max(data.pagination.totalPages, 1)}</p>
                <div className="flex gap-2">
                  <button type="button" disabled={!data.pagination.hasPreviousPage} onClick={() => setPage((current) => Math.max(1, current - 1))} className="btn bg-slate-100 text-navy-700 disabled:opacity-40"><ChevronLeft className="h-4 w-4" /> Previous</button>
                  <button type="button" disabled={!data.pagination.hasNextPage} onClick={() => setPage((current) => current + 1)} className="btn bg-slate-100 text-navy-700 disabled:opacity-40">Next <ChevronRight className="h-4 w-4" /></button>
                </div>
              </div>
            </>
          )}
        </section>
      </div>
    </AppLayout>
  );
}
