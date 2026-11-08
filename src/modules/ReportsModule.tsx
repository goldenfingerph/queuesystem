import { useEffect, useState } from 'react';
import { BarChart3, Download, Calendar, Filter } from 'lucide-react';
import { api } from '@/lib/api';
import { AppLayout } from '@/components/AppLayout';
import { getBusinessDate } from '../../shared/business-date';

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

interface AnalyticsData {
  from: string;
  to: string;
  totals: { total: number; completed: number; skipped: number; avgWaitSeconds: number | null; avgServiceSeconds: number | null };
  daily: { date: string; total: number; completed: number; skipped: number }[];
  byService: { serviceId: number; service: string; total: number; waiting: number; serving: number; completed: number; skipped: number; avgWaitSeconds: number | null; avgServiceSeconds: number | null }[];
  hourly: { hour: number; total: number }[];
}

export function ReportsModule() {
  const [services, setServices] = useState<Service[]>([]);
  const [date, setDate] = useState(getBusinessDate);
  const [serviceId, setServiceId] = useState('');
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retryCount, setRetryCount] = useState(0);
  const [fromDate, setFromDate] = useState(getBusinessDate);
  const [toDate, setToDate] = useState(getBusinessDate);
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [analyticsError, setAnalyticsError] = useState('');

  useEffect(() => {
    api.get<{ services: Service[] }>('/services')
      .then((r) => setServices(r.services))
      .catch(() => setServices([]));
  }, []);

  useEffect(() => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00`))) { setError('Choose a valid report date.'); setLoading(false); return; }
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

  useEffect(() => {
    if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(fromDate) || !/^\\d{4}-\\d{2}-\\d{2}$/.test(toDate)) {
      setAnalyticsError('Choose valid start and end dates.');
      setAnalytics(null);
      return;
    }
    let cancelled = false;
    setAnalyticsLoading(true);
    setAnalyticsError('');
    const params = new URLSearchParams({ from: fromDate, to: toDate });
    if (serviceId) params.set('serviceId', serviceId);
    api.get<AnalyticsData>(`/reports/analytics?${params.toString()}`)
      .then((result) => { if (!cancelled) setAnalytics(result); })
      .catch((err: unknown) => {
        if (!cancelled) {
          setAnalytics(null);
          setAnalyticsError(err instanceof Error ? err.message : 'Unable to load analytics.');
        }
      })
      .finally(() => { if (!cancelled) setAnalyticsLoading(false); });
    return () => { cancelled = true; };
  }, [fromDate, toDate, serviceId]);

  const exportCsv = async () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00`))) { setError('Choose a valid report date before exporting.'); return; }
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
            <label className="mb-1 block text-xs font-semibold uppercase text-navy-400">Trend From · من تاريخ</label>
            <input type="date" className="input-field" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase text-navy-400">Trend To · إلى تاريخ</label>
            <input type="date" className="input-field" value={toDate} onChange={(e) => setToDate(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase text-navy-400"><Filter className="inline h-3 w-3" /> Service · الخدمة</label>
            <select className="input-field" value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
              <option value="">All Services · جميع الخدمات</option>
              {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        </div>

        <section className="surface mb-6 p-5" aria-labelledby="advanced-analytics-title">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 id="advanced-analytics-title" className="text-base font-bold text-navy-900">Advanced Analytics · التحليلات المتقدمة</h2>
              <p className="text-xs text-navy-500">Daily volume, service comparison and arrival patterns · حجم التذاكر ومقارنة الخدمات وأوقات الوصول</p>
            </div>
            <span className="text-xs text-navy-400">Maximum range: 90 days</span>
          </div>
          {analyticsLoading ? <p className="text-sm text-navy-400">Loading analytics... · جارٍ تحميل التحليلات...</p> : analyticsError ? (
            <p className="text-sm text-error-600" role="alert">{analyticsError}</p>
          ) : analytics ? (
            <>
              <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <StatCard label="Range Tickets · إجمالي التذاكر" value={analytics.totals.total} color="brand" />
                <StatCard label="Completed · مكتمل" value={analytics.totals.completed} color="success" />
                <StatCard label="No-show · لم يحضر" value={analytics.totals.skipped} color="error" />
                <StatCard label="Avg Wait · متوسط الانتظار" value={fmtTime(analytics.totals.avgWaitSeconds)} color="navy" small />
              </div>
              <div className="grid gap-5 lg:grid-cols-2">
                <div>
                  <h3 className="mb-3 text-sm font-semibold text-navy-800">Daily Ticket Volume · حجم التذاكر اليومي</h3>
                  {analytics.daily.length === 0 ? <p className="text-sm text-navy-400">No ticket data in this range.</p> : (
                    <div className="space-y-2">
                      {analytics.daily.map((day) => {
                        const width = analytics.totals.total > 0 ? Math.max(2, day.total / Math.max(...analytics.daily.map((item) => item.total), 1) * 100) : 0;
                        return <div key={day.date} className="grid grid-cols-[5.5rem_1fr_2rem] items-center gap-2 text-xs">
                          <span className="text-navy-500">{day.date.slice(5)}</span>
                          <div className="h-3 overflow-hidden rounded bg-slate-100"><div className="h-full rounded bg-brand-500" style={{ width: `${width}%` }} /></div>
                          <span className="text-right font-semibold text-navy-700">{day.total}</span>
                        </div>;
                      })}
                    </div>
                  )}
                </div>
                <div>
                  <h3 className="mb-3 text-sm font-semibold text-navy-800">Hourly Arrivals · الوصول حسب الساعة</h3>
                  {analytics.hourly.length === 0 ? <p className="text-sm text-navy-400">No arrival data in this range.</p> : (
                    <div className="space-y-2">
                      {analytics.hourly.map((bucket) => {
                        const maxHour = Math.max(...analytics.hourly.map((item) => item.total), 1);
                        const width = Math.max(2, bucket.total / maxHour * 100);
                        return <div key={bucket.hour} className="grid grid-cols-[3rem_1fr_2rem] items-center gap-2 text-xs">
                          <span className="text-navy-500">{String(bucket.hour).padStart(2, '0')}:00</span>
                          <div className="h-3 overflow-hidden rounded bg-slate-100"><div className="h-full rounded bg-accent-500" style={{ width: `${width}%` }} /></div>
                          <span className="text-right font-semibold text-navy-700">{bucket.total}</span>
                        </div>;
                      })}
                    </div>
                  )}
                </div>
              </div>
              <div className="mt-6 overflow-x-auto">
                <h3 className="mb-3 text-sm font-semibold text-navy-800">Service Comparison · مقارنة الخدمات</h3>
                {analytics.byService.length === 0 ? <p className="text-sm text-navy-400">No service data in this range.</p> : (
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-xs uppercase text-navy-500">
                      <tr><th className="px-3 py-2 text-left">Service</th><th className="px-3 py-2 text-center">Total</th><th className="px-3 py-2 text-center">Completed</th><th className="px-3 py-2 text-center">No-show</th><th className="px-3 py-2 text-center">Avg Wait</th><th className="px-3 py-2 text-center">Avg Service</th></tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {analytics.byService.map((service) => <tr key={service.serviceId}>
                        <td className="px-3 py-2 font-medium text-navy-900">{service.service}</td>
                        <td className="px-3 py-2 text-center">{service.total}</td>
                        <td className="px-3 py-2 text-center text-success-600">{service.completed}</td>
                        <td className="px-3 py-2 text-center text-error-600">{service.skipped}</td>
                        <td className="px-3 py-2 text-center">{fmtTime(service.avgWaitSeconds)}</td>
                        <td className="px-3 py-2 text-center">{fmtTime(service.avgServiceSeconds)}</td>
                      </tr>)}
                    </tbody>
                  </table>
                )}
              </div>
            </>
          ) : null}
        </section>

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
