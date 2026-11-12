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
        <div class="header">${escapeHtml(orgNameEn)}</div>
        ${orgNameAr ? `<div class="sub ar" dir="rtl" lang="ar">${escapeHtml(orgNameAr)}</div>` : ''}
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
      <div className="reception-page">
        <div className="reception-shell">
          <header className="reception-hero">
            <div className="reception-hero-glow" />
            <div className="reception-hero-content">
              <div className="reception-eyebrow"><span className="reception-live-dot" /> RECEPTION DESK <span className="reception-eyebrow-divider">/</span> الاستقبال</div>
              <h1>Welcome <span>to Reception</span></h1>
              <p>Fast, simple ticketing for every visitor. <span dir="rtl" lang="ar">خدمة سريعة وسهلة لجميع الزوار</span></p>
            </div>
            <div className="reception-hero-mark"><Ticket className="h-10 w-10" strokeWidth={1.5} /><span>QUEUE<br />MANAGEMENT</span></div>
            <div className="reception-hero-bottom"><span>{orgNameEn}</span><span>VISITOR SERVICES · خدمات الزوار</span></div>
          </header>

          <div className="reception-workspace">
            <section className="reception-panel reception-selection">
              <div className="reception-section-heading">
                <div className="reception-heading-icon"><Ticket className="h-5 w-5" /></div>
                <div><h2>Generate a ticket</h2><p>Choose a service and visitor type · اختر الخدمة ونوع الزائر</p></div>
                <span className="reception-step">01</span>
              </div>
              {error && <div className="mb-5 flex items-center gap-2 rounded-xl bg-error-500/10 px-4 py-3 text-sm text-error-600"><AlertCircle className="h-4 w-4 shrink-0" />{error}</div>}

              <div className="reception-field">
                <div className="reception-field-label"><span>SELECT A SERVICE</span><span dir="rtl">اختر الخدمة</span></div>
                <div className="reception-service-grid">
                  {services.map((s) => (
                    <button key={s.id} onClick={() => setSelectedService(s.id)} className={selectedService === s.id ? "reception-choice is-selected" : "reception-choice"}>
                      <span className="reception-choice-check">{selectedService === s.id ? "✓" : ""}</span>
                      <span className="reception-choice-name">{s.name}</span>
                      <span className="reception-choice-ar" dir="rtl" lang="ar">{s.name_ar}</span>
                      <span className="reception-choice-range">TICKETS {s.ticket_range_start}–{s.ticket_range_end}</span>
                    </button>
                  ))}
                  {services.length === 0 && <div className="reception-empty-services">No active services available · لا توجد خدمات متاحة حالياً</div>}
                </div>
              </div>

              <div className="reception-field">
                <div className="reception-field-label"><span>VISITOR CATEGORY</span><span dir="rtl">فئة الزائر</span></div>
                <div className="reception-category-grid">
                  {categories.map((c) => (
                    <button key={c.id} onClick={() => setSelectedCategory(c.id)} className={selectedCategory === c.id ? "reception-category is-selected" : "reception-category"}>
                      <span className="reception-category-indicator" />
                      <span><strong>{c.label_en}</strong><small dir="rtl" lang="ar">{c.label_ar}</small></span>
                    </button>
                  ))}
                </div>
              </div>

              <button onClick={generate} disabled={busy || !selectedService} className="reception-generate">
                <Ticket className="h-5 w-5" />
                <span>{busy ? 'Generating ticket… · جارٍ إصدار التذكرة' : 'Generate Ticket · إصدار تذكرة'}</span>
                <span className="reception-generate-arrow">→</span>
              </button>
              <p className="reception-secure-note">Please verify the selected service before issuing a ticket.</p>
            </section>

            <section className="reception-panel reception-ticket-panel">
              <div className="reception-section-heading">
                <div className="reception-heading-icon reception-heading-icon-soft"><Printer className="h-5 w-5" /></div>
                <div><h2>Ticket preview</h2><p>Your latest issued ticket · آخر تذكرة صادرة</p></div>
                <span className="reception-step">02</span>
              </div>
              {lastTicket ? (
                <div className="reception-ticket-result">
                  <div className="reception-ticket-topline"><span>YOUR QUEUE NUMBER</span><CheckCircle className="h-5 w-5" /></div>
                  <div className="reception-ticket-number">{lastTicket.number}</div>
                  <div className="reception-ticket-success">Ticket issued successfully <span dir="rtl">· تم إصدار التذكرة بنجاح</span></div>
                  <div className="reception-ticket-service"><span>SERVICE</span><strong>{lastTicket.serviceName}</strong><small dir="rtl" lang="ar">{lastTicket.serviceNameAr}</small></div>
                  <div className="reception-ticket-category"><span>{lastTicket.categoryEn}</span><span dir="rtl" lang="ar">{lastTicket.categoryAr}</span></div>
                  <div className="reception-print-options">
                    <label>PRINTER PAPER SIZE</label>
                    <div className="flex gap-2">
                      <button onClick={() => setPrintSize('58')} className={printSize === '58' ? "reception-size is-selected" : "reception-size"}>58 mm</button>
                      <button onClick={() => setPrintSize('80')} className={printSize === '80' ? "reception-size is-selected" : "reception-size"}>80 mm</button>
                    </div>
                    <button onClick={printTicket} className="reception-print-button"><Printer className="h-4 w-4" /> Print Ticket · طباعة التذكرة</button>
                  </div>
                </div>
              ) : (
                <div className="reception-ticket-empty">
                  <div className="reception-ticket-empty-icon"><Ticket className="h-9 w-9" /></div>
                  <strong>Your ticket will appear here</strong>
                  <span>سيظهر رقم تذكرتك هنا</span>
                  <p>Select a service, choose a visitor category, then generate a ticket.</p>
                  <div className="reception-ticket-empty-line"><i /><i /><i /></div>
                </div>
              )}
              <div className="reception-help-strip"><span className="reception-help-dot" /><span>Need assistance? Please contact your system administrator.</span></div>
            </section>
          </div>
          <footer className="reception-footer"><span>POWERED BY INFINITY SERVICES</span><span>QUEUE MANAGEMENT SYSTEM</span></footer>
        </div>
      </div>
    </AppLayout>
  );
}
