import { useEffect, useState } from 'react';
import { Ticket, Printer, CheckCircle, AlertCircle } from 'lucide-react';
import { api } from '@/lib/api';
import { useWebSocket } from '@/lib/useWebSocket';
import { AppLayout } from '@/components/AppLayout';

interface Service { id: number; name: string; name_ar?: string; code: string; prefix: string; is_active: number; ticket_range_start: number; ticket_range_end: number }
interface VisitorCategory { id: number; code: string; label_en: string; label_ar: string; is_active: number; priority_rank: number }

const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char] ?? char));

export function ReceptionModule() {
  const [services, setServices] = useState<Service[]>([]);
  const [categories, setCategories] = useState<VisitorCategory[]>([]);
  const [selectedService, setSelectedService] = useState<number | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<number | null>(null);
  const [lastTicket, setLastTicket] = useState<{ id: number; number: string; serviceName: string; serviceNameAr: string; categoryEn: string; categoryAr: string } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [printSize, setPrintSize] = useState<'58' | '80'>('80');
  const [orgNameEn, setOrgNameEn] = useState('INFINITY SERVICES');
  const [orgNameAr, setOrgNameAr] = useState('');
  const { lastMessage } = useWebSocket();

  useEffect(() => {
    Promise.all([
      api.get<{ services: Service[] }>('/services'),
      api.get<{ categories: VisitorCategory[] }>('/settings/visitor-categories'),
      api.get<{ settings: Record<string, string> }>('/settings'),
    ]).then(([s, c, settingsResult]) => {
      setServices(s.services.filter((svc) => svc.is_active));
      setOrgNameEn(settingsResult.settings.org_name_en?.trim() || 'INFINITY SERVICES');
      setOrgNameAr(settingsResult.settings.org_name_ar?.trim() || '');
      const activeCategories = c.categories.filter((cat) => cat.is_active);
      setCategories(activeCategories);
      const regularCategory = activeCategories.find((cat) => cat.code === 'regular');
      if (regularCategory) setSelectedCategory(regularCategory.id);
    }).catch((err) => {
      setError(err instanceof Error ? err.message : 'Unable to load services and visitor categories');
    });
  }, []);

  // Refresh services list on WS updates
  useEffect(() => {
    if (lastMessage?.type === 'services-updated') {
      api.get<{ services: Service[] }>('/services').then((s) => {
        const activeServices = s.services.filter((svc) => svc.is_active);
        setServices(activeServices);
        if (selectedService !== null && !activeServices.some((svc) => svc.id === selectedService)) setSelectedService(null);
      }).catch((err) => setError(err instanceof Error ? err.message : 'Unable to refresh services'));
    }
  }, [lastMessage, selectedService]);

  const generate = async () => {
    if (!selectedService || !services.some((service) => service.id === selectedService)) { setError('Please select an available service.'); return; }
    if (selectedCategory !== null && !categories.some((category) => category.id === selectedCategory)) { setError('Please select a valid visitor category.'); return; }
    setError('');
    setBusy(true);
    try {
      const r = await api.post<{ ticket: { id: number; number: string } }>('/tickets', {
        service_id: selectedService,
        visitor_category_id: selectedCategory,
      });
      const ticketCategory = categories.find((c) => c.id === (selectedCategory ?? categories.find((item) => item.code === 'regular')?.id));
      setLastTicket({ ...r.ticket, serviceName: services.find((s) => s.id === selectedService)?.name ?? '', serviceNameAr: services.find((s) => s.id === selectedService)?.name_ar ?? '', categoryEn: ticketCategory?.label_en ?? 'Regular', categoryAr: ticketCategory?.label_ar ?? '' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate ticket');
    } finally {
      setBusy(false);
    }
  };

  const printTicket = () => {
    if (!lastTicket) return;
    const width = printSize === '58' ? '58mm' : '80mm';
    const height = '70mm';
    const padding = printSize === '58' ? '2.5mm' : '3mm';
    const fontSize = printSize === '58' ? 12 : 14;

    const win = window.open('', '_blank', 'width=400,height=600');
    if (!win) { alert('Please allow pop-ups to print tickets'); return; }
    win.document.write(`
      <!DOCTYPE html><html><head><meta charset="utf-8"><title>Ticket ${escapeHtml(lastTicket.number)}</title>
      <style>
        @page { size: ${width} ${height}; margin: 0; }
        * { margin: 0; padding: 0; box-sizing: border-box; }
        html, body { width: ${width}; height: ${height}; margin: 0; padding: 0; }
        body { font-family: Arial, sans-serif; padding: ${padding}; text-align: center; overflow: hidden; display: flex; flex-direction: column; align-items: center; }
        @media print {
          html, body { width: ${width}; height: ${height}; max-height: ${height}; }
          body { break-after: avoid-page; page-break-after: avoid; overflow: hidden; }
        }
        .header { flex: 0 0 auto; font-size: ${fontSize + 1}px; font-weight: 800; color: #0f1a33; margin: 0 0 1mm; }
        .sub { flex: 0 0 auto; font-size: ${fontSize - 1}px; color: #555; margin: 0 0 2mm; line-height: 1.25; }
        .ticket-num { flex: 0 0 auto; font-size: ${fontSize + 20}px; line-height: 1.05; font-weight: 800; color: #9CC53B; margin: 2mm 0; letter-spacing: 1px; }
        .service { flex: 0 0 auto; font-size: ${fontSize}px; line-height: 1.2; font-weight: 700; color: #0f1a33; margin-bottom: 1mm; }
        .category { flex: 0 0 auto; font-size: ${fontSize - 1}px; color: #555; margin-bottom: 1.5mm; line-height: 1.25; }
        .footer { flex: 0 0 auto; width: 100%; font-size: ${fontSize - 2}px; color: #555; margin-top: 3mm; border-top: 1px dashed #ccc; padding-top: 1.5mm; line-height: 1.3; }
        .ar { direction: rtl; unicode-bidi: isolate; font-family: Tahoma, Arial, sans-serif; }
      </style></head><body>
        <div class="header">\${escapeHtml(orgNameEn)}</div>
        \${orgNameAr ? \`<div class="sub ar" dir="rtl" lang="ar">\${escapeHtml(orgNameAr)}</div>\` : ''}
        <div class="sub">www.infinity.ae</div>
        <div class="ticket-num">${escapeHtml(lastTicket.number)}</div>
        <div class="service">${escapeHtml(lastTicket.serviceName)}</div><div class="service ar" dir="rtl" lang="ar">${escapeHtml(lastTicket.serviceNameAr)}</div><div class="category">Service · الخدمة</div>
        ${lastTicket.categoryEn ? `<div class="category">${escapeHtml(lastTicket.categoryEn)} · <span class="ar" dir="rtl" lang="ar">${escapeHtml(lastTicket.categoryAr)}</span></div>` : ''}
        <div class="footer">
          ${new Date().toLocaleString('en-AE', { timeZone: 'Asia/Dubai', dateStyle: 'medium', timeStyle: 'short' })}<br/>
          Please wait for your number to be called<br/>
          <span class="ar" dir="rtl" lang="ar">الرجاء الانتظار حتى يُنادى رقمك</span>
        </div>
        <script>window.onload = function() { window.focus(); window.print(); }</script>
      </body></html>
    `);
    win.onafterprint = () => win.close();
    win.document.close();
  };

  return (
    <AppLayout active="reception">
      <div className="p-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-navy-900">Reception &amp; Ticket Generation <span className="text-lg" dir="rtl">الاستقبال وإصدار التذاكر</span></h1>
          <p className="text-sm text-navy-500">Select a service and visitor category to generate a ticket · اختر الخدمة وفئة الزائر لإصدار تذكرة</p>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          {/* Selection */}
          <div className="surface p-6">
            <h2 className="mb-4 text-sm font-bold uppercase tracking-wide text-navy-500">New Ticket · تذكرة جديدة</h2>
            {error && <div className="mb-3 flex items-center gap-2 rounded-lg bg-error-500/10 px-3 py-2 text-sm text-error-600"><AlertCircle className="h-4 w-4" />{error}</div>}
            <div className="space-y-4">
              <div>
                <label className="mb-2 block text-xs font-semibold uppercase text-navy-400">Service · الخدمة</label>
                <div className="grid grid-cols-2 gap-2">
                  {services.map((s) => (
                    <button key={s.id} onClick={() => setSelectedService(s.id)}
                      className={`rounded-lg border p-3 text-left transition-all ${selectedService === s.id ? 'border-brand-600 bg-brand-100 ring-2 ring-brand-300 shadow-sm' : 'border-slate-200 hover:border-brand-400 hover:bg-brand-50'}`}>
                      <p className="font-bold text-navy-900">{s.name}</p><p className="text-sm text-navy-600" dir="rtl" lang="ar">{s.name_ar}</p>
                      <p className="text-xs text-navy-400">Tickets {s.ticket_range_start}–{s.ticket_range_end}</p>
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="mb-2 block text-xs font-semibold uppercase text-navy-400">Visitor Category · فئة الزائر</label>
                <div className="grid grid-cols-2 gap-2">
                  {categories.map((c) => (
                    <button key={c.id} onClick={() => setSelectedCategory(c.id)}
                      className={`rounded-lg border p-3 text-left transition-all ${selectedCategory === c.id ? 'border-brand-500 bg-brand-50 ring-2 ring-brand-100' : 'border-slate-200 hover:border-brand-300'}`}>
                      <p className="font-medium text-navy-900">{c.label_en}</p>
                      <p className="text-xs text-navy-400" dir="rtl">{c.label_ar}</p>
                    </button>
                  ))}
                </div>
              </div>
              <button onClick={generate} disabled={busy || !selectedService} className="btn-primary w-full focus-ring">
                <Ticket className="h-4 w-4" /> {busy ? 'Generating... · جارٍ الإصدار' : 'Generate Ticket · إصدار تذكرة'}
              </button>
            </div>
          </div>

          {/* Last ticket + print */}
          <div className="surface p-6">
            <h2 className="mb-4 text-sm font-bold uppercase tracking-wide text-navy-500">Last Generated Ticket · آخر تذكرة صادرة</h2>
            {lastTicket ? (
              <div>
                <div className="rounded-2xl border-2 border-brand-400 bg-gradient-to-br from-brand-100 via-brand-50 to-white p-8 text-center shadow-sm">
                  <p className="text-xs font-bold uppercase tracking-widest text-brand-800">Your Number · رقمك</p>
                  <p className="my-3 text-5xl font-bold text-navy-950 tracking-wider">{lastTicket.number}</p>
                  <div className="flex items-center justify-center gap-2 text-brand-800">
                    <CheckCircle className="h-4 w-4" />
                    <span className="text-sm">Ticket created successfully · تم إصدار التذكرة بنجاح</span>
                  </div>
                </div>
                <div className="mt-4 space-y-3">
                  <div>
                    <label className="mb-1 block text-xs font-semibold uppercase text-navy-400">Printer Size · حجم الطابعة</label>
                    <div className="flex gap-2">
                      <button onClick={() => setPrintSize('58')} className={`btn ${printSize === '58' ? 'bg-brand-600 text-white shadow-sm' : 'bg-brand-50 text-brand-800 hover:bg-brand-100'}`}>58 × 100mm</button>
                      <button onClick={() => setPrintSize('80')} className={`btn ${printSize === '80' ? 'bg-brand-600 text-white shadow-sm' : 'bg-brand-50 text-brand-800 hover:bg-brand-100'}`}>80 × 100mm</button>
                    </div>
                  </div>
                  <button onClick={printTicket} className="btn-primary w-full">
                    <Printer className="h-4 w-4" /> Print Ticket
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-16 text-navy-300">
                <Ticket className="mb-3 h-12 w-12" />
                <p className="text-sm">No ticket generated yet · لم تصدر أي تذكرة بعد</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
