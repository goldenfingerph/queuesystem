import { useEffect, useState } from 'react';
import { BarChart3, Download, Calendar, Filter } from 'lucide-react';
import { api } from '@/lib/api';
import { AppLayout } from '@/components/AppLayout';
import { getAbuDhabiBusinessDate } from '../../shared/business-date.js';

interface Service { id: number; name: string }

interface ReportData {
  date: string;
  summary: {
    total: number; waiting: number; serving: number; completed: number; skipped: number;
    avg_wait: number | null; avg_service: number | null;
  };
  counterPerf: {
    number: number; name: string; total: number; completed: number; skipped: number; avg_service: number | null;
  }[];
}

export function ReportsModule() {
  const [services, setServices] = useState<Service[]>([]);
  const [date, setDate] = useState(getAbuDhabiBusinessDate);
  const [serviceId, setServiceId] = useState('');
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    api.get<{ services: Service[] }>('/services')
      .then((r) => setServices(r.services))
      .catch(() => setServices([]));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    const params = new URLSearchParams({ date });
    if (serviceId) params.set('serviceId', serviceId);
    api.get<ReportData>(`/reports?${params.toString()}`)
      .then((r) => { if (!cancelled) setData(r); })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Unable to load report. Please try again.');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [date, serviceId, retryCount]);

  const exportCsv = async () => {
    const params = new URLSearchParams({ date });
    if (serviceId) params.set('serviceId', serviceId);
    const token = sessionStorage.getItem('infinity_token');
    try {
      const response = await fetch(`/api/reports/export?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        let message = 'Unable to export report. Please try again.';
        try {
          const body = await response.json();
          if (typeof body.error === 'string') message = body.error;
        } catch { /* Keep the fallback message for non-JSON errors. */ }
        throw new Error(message);
      }
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = `report-${date}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Unable to export report. Please try again.');
    }
  };

  const fmtTime = (sec: number | null) => {
    if (!sec) return '--';
    return `${Math.floor(sec / 60)}m ${Math.round(sec % 60)}s`;
  };

  return (
    <AppLayout active="reports">
      <div className="p-6">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-navy-900">Reports &amp; Analytics <span className="ml-2 text-brand-700" dir="rtl">التقارير والتحليلات</span></h1>
            <p className="text-sm text-navy-500">Daily totals, timing, and counter performance · إجمالي اليوم وأوقات الانتظار وأداء الشبابيك</p>
          </div>
          <button onClick={exportCsv} className="btn bg-success-500/10 text-success-600 hover:bg-success-500/20 focus-ring">
            <Download className="h-4 w-4" /> Export CSV · تصدير CSV
          </button>
        </div>

        <div className="surface mb-6 flex flex-wrap items-end gap-4 p-4">
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase text-navy-400"><Calendar className="inline h-3 w-3" /> Date · التاريخ</label>
            <input type="date" className="input-field" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase text-navy-400"><Filter className="inline h-3 w-3" /> Service · الخدمة</label>
            <select className="input-field" value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
              <option value="">All Services · جميع الخدمات</option>
              {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        </div>

        {loading ? <p className="text-navy-400">Loading... · جارٍ التحميل...</p> : error ? (
          <div className="surface p-5 text-sm text-error-600" role="alert">
            {error}
            <button onClick={() => setRetryCount((count) => count + 1)} className="ml-3 underline">Retry · إعادة المحاولة</button>
          </div>
        ) : data ? (
          <>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-7">
              <StatCard label="Total · الإجمالي" value={data.summary.total} color="brand" />
              <StatCard label="Waiting · انتظار" value={data.summary.waiting} color="warning" />
              <StatCard label="Serving · قيد الخدمة" value={data.summary.serving} color="accent" />
              <StatCard label="Completed · مكتمل" value={data.summary.completed} color="success" />
              <StatCard label="Skipped · لم يحضر" value={data.summary.skipped} color="error" />
              <StatCard label="Avg Wait · متوسط الانتظار" value={fmtTime(data.summary.avg_wait)} color="navy" small />
              <StatCard label="Avg Service · متوسط الخدمة" value={fmtTime(data.summary.avg_service)} color="navy" small />
            </div>

            <div className="mt-6 surface overflow-hidden">
              <div className="border-b border-slate-200 bg-navy-50 px-5 py-3">
                <h2 className="flex items-center gap-2 text-sm font-bold text-navy-800"><BarChart3 className="h-4 w-4" /> Counter Performance · أداء الشبابيك</h2>
              </div>
              {data.counterPerf.length === 0 ? <p className="p-6 text-sm text-navy-400">No data for this date. · لا توجد بيانات لهذا التاريخ.</p> : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-xs uppercase tracking-wide text-navy-500">
                      <tr>
                        <th className="px-5 py-3 text-left font-semibold">Counter · الشباك</th>
                        <th className="px-5 py-3 text-center font-semibold">Total · الإجمالي</th>
                        <th className="px-5 py-3 text-center font-semibold">Completed · مكتمل</th>
                        <th className="px-5 py-3 text-center font-semibold">Skipped · لم يحضر</th>
                        <th className="px-5 py-3 text-center font-semibold">Avg Service Time · متوسط وقت الخدمة</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {data.counterPerf.map((c) => (
                        <tr key={c.number} className="hover:bg-slate-50">
                          <td className="px-5 py-3 font-medium text-navy-900">Counter / الشباك {c.number} — {c.name}</td>
                          <td className="px-5 py-3 text-center font-semibold">{c.total}</td>
                          <td className="px-5 py-3 text-center text-success-600 font-semibold">{c.completed}</td>
                          <td className="px-5 py-3 text-center text-error-600 font-semibold">{c.skipped}</td>
                          <td className="px-5 py-3 text-center text-navy-600">{fmtTime(c.avg_service)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        ) : null}
      </div>
    </AppLayout>
  );
}

const colorMap: Record<string, string> = {
  brand: 'bg-brand-50 text-brand-600', warning: 'bg-warning-500/10 text-warning-600',
  accent: 'bg-accent-50 text-accent-600', success: 'bg-success-500/10 text-success-600',
  error: 'bg-error-500/10 text-error-600', navy: 'bg-navy-100 text-navy-700',
};

function StatCard({ label, value, color, small }: { label: string; value: number | string; color: string; small?: boolean }) {
  return (
    <div className="surface p-4">
      <div className={`mb-2 grid h-9 w-9 place-items-center rounded-lg ${colorMap[color]}`}>
        <BarChart3 className="h-4 w-4" />
      </div>
      <p className={`${small ? 'text-base' : 'text-2xl'} font-bold text-navy-900`}>{value}</p>
      <p className="text-xs font-medium text-navy-500">{label}</p>
    </div>
  );
}
