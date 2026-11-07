import { useCallback, useEffect, useState } from 'react';
import { Users, Clock, CheckCircle, AlertCircle, Monitor, Activity } from 'lucide-react';
import { api } from '@/lib/api';
import { useWebSocket } from '@/lib/useWebSocket';
import { AppLayout } from '@/components/AppLayout';

interface DashboardData {
  totals: { total_today: number; waiting: number; serving: number; completed_today: number; skipped_today: number; active_counters: number };
  avgWait: number;
  byService: { name: string; prefix: string; total: number; waiting: number; serving: number; completed: number; skipped: number }[];
  date: string;
}

export function DashboardModule() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState('');
  const [retryCount, setRetryCount] = useState(0);
  const { lastMessage } = useWebSocket();

  const load = useCallback(async () => {
    try {
      const result = await api.get<DashboardData>('/reports/dashboard');
      setData(result);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load dashboard');
    }
  }, []);

  useEffect(() => { void load(); }, [load, retryCount]);

  useEffect(() => {
    if (lastMessage?.type === 'queue-updated') void load();
  }, [lastMessage, load]);

  if (!data) return <AppLayout active="dashboard"><div className="p-8">
    {error ? <div className="text-sm text-error-600" role="alert">{error}<button onClick={() => setRetryCount((count) => count + 1)} className="ml-3 underline">Retry</button></div> : <p className="text-navy-400">Loading...</p>}
  </div></AppLayout>;

  const cards = [
    { label: 'Total Visitors', value: data.totals.total_today, icon: Users, color: 'brand' },
    { label: 'Waiting', value: data.totals.waiting, icon: Clock, color: 'warning' },
    { label: 'Now Serving', value: data.totals.serving, icon: Activity, color: 'accent' },
    { label: 'Completed', value: data.totals.completed_today, icon: CheckCircle, color: 'success' },
    { label: 'Skipped', value: data.totals.skipped_today, icon: AlertCircle, color: 'error' },
    { label: 'Active Counters', value: data.totals.active_counters, icon: Monitor, color: 'navy' },
  ];

  const colorMap: Record<string, string> = {
    brand: 'bg-brand-50 text-brand-600',
    warning: 'bg-warning-500/10 text-warning-600',
    accent: 'bg-accent-50 text-accent-600',
    success: 'bg-success-500/10 text-success-600',
    error: 'bg-error-500/10 text-error-600',
    navy: 'bg-navy-100 text-navy-700',
  };

  return (
    <AppLayout active="dashboard">
      <div className="p-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-navy-900">Admin Dashboard</h1>
          <p className="text-sm text-navy-500">Live overview — {data.date}</p>
        </div>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          {cards.map((c) => (
            <div key={c.label} className="surface p-4">
              <div className={`mb-3 grid h-10 w-10 place-items-center rounded-lg ${colorMap[c.color]}`}>
                <c.icon className="h-5 w-5" strokeWidth={2} />
              </div>
              <p className="text-2xl font-bold text-navy-900">{c.value}</p>
              <p className="text-xs font-medium text-navy-500">{c.label}</p>
            </div>
          ))}
        </div>

        <div className="mt-6 surface p-6">
          <h2 className="mb-4 text-sm font-bold uppercase tracking-wide text-navy-500">Average Waiting Time</h2>
          <p className="text-3xl font-bold text-brand-600">
            {Math.floor(data.avgWait / 60)}m {Math.round(data.avgWait % 60)}s
          </p>
        </div>

        <div className="mt-6 surface overflow-hidden">
          <div className="border-b border-slate-200 bg-navy-50 px-5 py-3">
            <h2 className="text-sm font-bold text-navy-800">Service Statistics</h2>
          </div>
          {data.byService.length === 0 ? (
            <p className="p-6 text-sm text-navy-400">No tickets today.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-navy-500">
                  <tr>
                    <th className="px-5 py-3 text-left font-semibold">Service</th>
                    <th className="px-5 py-3 text-center font-semibold">Total</th>
                    <th className="px-5 py-3 text-center font-semibold">Waiting</th>
                    <th className="px-5 py-3 text-center font-semibold">Serving</th>
                    <th className="px-5 py-3 text-center font-semibold">Completed</th>
                    <th className="px-5 py-3 text-center font-semibold">Skipped</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.byService.map((s) => (
                    <tr key={s.name} className="hover:bg-slate-50">
                      <td className="px-5 py-3 font-medium text-navy-900">{s.name}</td>
                      <td className="px-5 py-3 text-center font-semibold">{s.total}</td>
                      <td className="px-5 py-3 text-center text-warning-600 font-semibold">{s.waiting}</td>
                      <td className="px-5 py-3 text-center text-accent-600 font-semibold">{s.serving}</td>
                      <td className="px-5 py-3 text-center text-success-600 font-semibold">{s.completed}</td>
                      <td className="px-5 py-3 text-center text-error-600 font-semibold">{s.skipped}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
