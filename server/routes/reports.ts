import { Router } from 'express';
import { getDb } from '../db/index.js';
import { getBusinessDate } from '../../shared/business-date.js';

export function reportsRouter(): Router {
  const router = Router();

  router.get('/dashboard', (_req, res) => {
    const db = getDb();
    const today = getBusinessDate();

    const totals = db.prepare(
      `SELECT
        (SELECT COUNT(*) FROM tickets WHERE business_date = ?) AS total_today,
        (SELECT COUNT(*) FROM tickets WHERE status = 'waiting' AND business_date = ?) AS waiting,
        (SELECT COUNT(*) FROM tickets WHERE status IN ('called','serving') AND business_date = ?) AS serving,
        (SELECT COUNT(*) FROM tickets WHERE status = 'completed' AND business_date = ?) AS completed_today,
        (SELECT COUNT(*) FROM tickets WHERE status = 'no_show' AND business_date = ?) AS skipped_today,
        (SELECT COUNT(*) FROM counters WHERE is_active = 1) AS active_counters`,
    ).get(today, today, today, today, today) as Record<string, number>;

    const avgWait = db.prepare(
      `SELECT AVG((julianday(called_at) - julianday(created_at)) * 86400) AS avg_wait
       FROM tickets WHERE business_date = ? AND called_at IS NOT NULL`,
    ).get(today) as { avg_wait: number | null };

    const byService = db.prepare(
      `SELECT s.name, s.prefix,
        COUNT(t.id) AS total,
        SUM(CASE WHEN t.status = 'waiting' THEN 1 ELSE 0 END) AS waiting,
        SUM(CASE WHEN t.status IN ('called','serving') THEN 1 ELSE 0 END) AS serving,
        SUM(CASE WHEN t.status = 'completed' THEN 1 ELSE 0 END) AS completed,
        SUM(CASE WHEN t.status = 'no_show' THEN 1 ELSE 0 END) AS skipped
       FROM services s LEFT JOIN tickets t ON t.service_id = s.id AND t.business_date = ?
       GROUP BY s.id ORDER BY s.name`,
    ).all(today);

    res.json({
      totals,
      avgWait: avgWait?.avg_wait ? Math.round(avgWait.avg_wait) : 0,
      byService,
      date: today,
    });
  });

  router.get('/analytics', (req, res) => {
    const parseDate = (value: unknown): string | null => {
      if (typeof value !== 'string' || !/^\\d{4}-\\d{2}-\\d{2}$/.test(value)) return null;
      const parsed = new Date(`${value}T00:00:00.000Z`);
      return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : null;
    };
    const from = parseDate(req.query.from);
    const to = parseDate(req.query.to);
    if (!from || !to) return res.status(400).json({ error: 'A valid from and to date are required.' });
    const rangeDays = (Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / 86400000;
    if (rangeDays < 0) return res.status(400).json({ error: 'The start date must be on or before the end date.' });
    if (rangeDays > 89) return res.status(400).json({ error: 'Report date ranges cannot exceed 90 days.' });

    let serviceFilter = '';
    const params: unknown[] = [from, to];
    if (req.query.serviceId !== undefined && req.query.serviceId !== '') {
      const serviceId = Number(req.query.serviceId);
      if (!Number.isSafeInteger(serviceId) || serviceId < 1) return res.status(400).json({ error: 'Service ID must be a positive whole number.' });
      serviceFilter = ' AND t.service_id = ?';
      params.push(serviceId);
    }

    const db = getDb();
    const daily = db.prepare(
      `SELECT t.business_date AS date, COUNT(*) AS total,
        SUM(CASE WHEN t.status = 'completed' THEN 1 ELSE 0 END) AS completed,
        SUM(CASE WHEN t.status = 'no_show' THEN 1 ELSE 0 END) AS skipped
       FROM tickets t
       WHERE t.business_date BETWEEN ? AND ?${serviceFilter}
       GROUP BY t.business_date ORDER BY t.business_date`,
    ).all(...params);

    const byService = db.prepare(
      `SELECT s.id AS serviceId, s.name AS service, COUNT(t.id) AS total,
        SUM(CASE WHEN t.status = 'waiting' THEN 1 ELSE 0 END) AS waiting,
        SUM(CASE WHEN t.status IN ('called','serving') THEN 1 ELSE 0 END) AS serving,
        SUM(CASE WHEN t.status = 'completed' THEN 1 ELSE 0 END) AS completed,
        SUM(CASE WHEN t.status = 'no_show' THEN 1 ELSE 0 END) AS skipped,
        ROUND(AVG((julianday(t.called_at) - julianday(t.created_at)) * 86400)) AS avgWaitSeconds,
        ROUND(AVG((julianday(t.completed_at) - julianday(t.served_at)) * 86400)) AS avgServiceSeconds
       FROM services s
       LEFT JOIN tickets t ON t.service_id = s.id AND t.business_date BETWEEN ? AND ?${serviceFilter}
       GROUP BY s.id HAVING COUNT(t.id) > 0 ORDER BY total DESC, s.name`,
    ).all(...params);

    const hourly = db.prepare(
      `SELECT CAST(strftime('%H', t.created_at) AS INTEGER) AS hour, COUNT(*) AS total
       FROM tickets t
       WHERE t.business_date BETWEEN ? AND ?${serviceFilter}
       GROUP BY strftime('%H', t.created_at) ORDER BY hour`,
    ).all(...params);

    const totals = db.prepare(
      `SELECT COUNT(*) AS total,
        SUM(CASE WHEN t.status = 'completed' THEN 1 ELSE 0 END) AS completed,
        SUM(CASE WHEN t.status = 'no_show' THEN 1 ELSE 0 END) AS skipped,
        ROUND(AVG((julianday(t.called_at) - julianday(t.created_at)) * 86400)) AS avgWaitSeconds,
        ROUND(AVG((julianday(t.completed_at) - julianday(t.served_at)) * 86400)) AS avgServiceSeconds
       FROM tickets t WHERE t.business_date BETWEEN ? AND ?${serviceFilter}`,
    ).get(...params);

    res.json({ from, to, totals, daily, byService, hourly });
  });

  router.get('/', (req, res) => {
    const db = getDb();
    const date = typeof req.query.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)
      ? req.query.date : getBusinessDate();
    const serviceId = req.query.serviceId as string | undefined;

    let where = 't.business_date = ?';
    const params: unknown[] = [date];
    if (serviceId) { where += ' AND t.service_id = ?'; params.push(serviceId); }

    const summary = db.prepare(
      `SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN t.status = 'waiting' THEN 1 ELSE 0 END) AS waiting,
        SUM(CASE WHEN t.status IN ('called','serving') THEN 1 ELSE 0 END) AS serving,
        SUM(CASE WHEN t.status = 'completed' THEN 1 ELSE 0 END) AS completed,
        SUM(CASE WHEN t.status = 'no_show' THEN 1 ELSE 0 END) AS skipped,
        AVG((julianday(t.called_at) - julianday(t.created_at)) * 86400) AS avg_wait,
        AVG((julianday(t.completed_at) - julianday(t.served_at)) * 86400) AS avg_service
       FROM tickets t WHERE ${where}`,
    ).get(...params) as Record<string, number | null>;

    const counterPerf = db.prepare(
      `SELECT c.number, c.name,
        COUNT(t.id) AS total,
        SUM(CASE WHEN t.status = 'completed' THEN 1 ELSE 0 END) AS completed,
        SUM(CASE WHEN t.status = 'no_show' THEN 1 ELSE 0 END) AS skipped,
        AVG((julianday(t.completed_at) - julianday(t.served_at)) * 86400) AS avg_service
       FROM counters c
       LEFT JOIN tickets t ON t.counter_id = c.id AND t.business_date = ?
       ${serviceId ? 'AND t.service_id = ?' : ''}
       GROUP BY c.id ORDER BY c.number`,
    ).all(date, ...(serviceId ? [serviceId] : []));

    res.json({ date, summary, counterPerf });
  });

  router.get('/export', (req, res) => {
    const db = getDb();
    const date = typeof req.query.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)
      ? req.query.date : getBusinessDate();
    const serviceId = req.query.serviceId as string | undefined;

    let where = 't.business_date = ?';
    const params: unknown[] = [date];
    if (serviceId) { where += ' AND t.service_id = ?'; params.push(serviceId); }

    const rows = db.prepare(
      `SELECT t.number, t.status, t.priority, t.created_at, t.called_at, t.served_at, t.completed_at,
       s.name AS service, s.name_ar AS service_ar, c.number AS counter, vc.label_en AS category_en, vc.label_ar AS category_ar
       FROM tickets t
       LEFT JOIN services s ON s.id = t.service_id
       LEFT JOIN counters c ON c.id = t.counter_id
       LEFT JOIN visitor_categories vc ON vc.id = t.visitor_category_id
       WHERE ${where} ORDER BY t.created_at`,
    ).all(...params) as Record<string, unknown>[];

    const headers = ['Ticket / رقم التذكرة', 'Service / الخدمة', 'Status / الحالة', 'Priority / الأولوية', 'Category / الفئة', 'Counter / الشباك', 'Created / وقت الإنشاء', 'Called / وقت النداء', 'Served / وقت بدء الخدمة', 'Completed / وقت الإكمال'];
    const lines = [headers.join(',')];
    // Quote every cell and neutralize spreadsheet formulas in text fields.
    // CSV quoting alone does not prevent Excel/LibreOffice formula execution.
    const csvCell = (value: unknown): string => {
      let text = String(value ?? '');
      let firstSignificant = 0;
      while (firstSignificant < text.length && text.charCodeAt(firstSignificant) <= 0x20) firstSignificant += 1;
      if ('=+-@'.includes(text[firstSignificant] ?? '\\0')) text = `'${text}`;
      return `"${text.replace(/"/g, '""')}"`;
    };
    const priorityArabic: Record<string, string> = {
      normal: 'عادي',
      priority: 'أولوية',
    };
    for (const r of rows) {
      const serviceName = String(r.service ?? '');
      const serviceAr = String(r.service_ar ?? '');
      const priority = String(r.priority ?? '');
      const priorityAr = priorityArabic[priority.trim().toLowerCase()];
      lines.push([
        r.number, serviceAr ? `${serviceName} / ${serviceAr}` : serviceName, `${r.status} / ${{ waiting: 'انتظار', called: 'تم النداء', serving: 'قيد الخدمة', completed: 'مكتمل', no_show: 'لم يحضر', cancelled: 'ملغي' }[String(r.status)] ?? String(r.status)}`, priorityAr ? `${priority} / ${priorityAr}` : priority, [r.category_en, r.category_ar].filter(Boolean).join(' / '),
        r.counter ?? '', r.created_at, r.called_at ?? '', r.served_at ?? '', r.completed_at ?? '',
      ].map(csvCell).join(','));
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="report-${date}.csv"`);
    res.send('\uFEFF' + lines.join('\n'));
  });

  return router;
}
