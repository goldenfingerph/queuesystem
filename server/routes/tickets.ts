import { Router } from 'express';
import { getDb } from '../db/index.js';
import { broadcast } from '../ws/index.js';
import { requireRole } from '../lib/middleware.js';

export function ticketsRouter(): Router {
  const router = Router();

  // Business day starts at 06:00 in Abu Dhabi, independent of server timezone.
  const businessDate = (): string => {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Dubai', year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(new Date(Date.now() - 6 * 60 * 60 * 1000));
    const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
    return `${get('year')}-${get('month')}-${get('day')}`;
  };

  const allocateNumber = (serviceId: number, start: number, end: number, day: string): string | null => {
    const db = getDb();
    const row = db.prepare('SELECT next_number, last_reset_date FROM ticket_sequences WHERE service_id = ?')
      .get(serviceId) as { next_number: number; last_reset_date: string | null } | undefined;
    const next = !row || row.last_reset_date !== day ? start : Math.max(start, row.next_number);
    if (next > end) return null;
    if (row) {
      db.prepare('UPDATE ticket_sequences SET next_number = ?, last_reset_date = ? WHERE service_id = ?')
        .run(next + 1, day, serviceId);
    } else {
      db.prepare('INSERT INTO ticket_sequences (service_id, next_number, last_reset_date) VALUES (?, ?, ?)')
        .run(next + 1, day, serviceId);
    }
    return String(next);
  };

  const canOperateCounter = (userId: number | undefined, role: string | undefined, counterId: number | null): boolean => {
    if (role !== 'service_officer') return true;
    if (!userId || !counterId) return false;
    return Boolean(getDb().prepare(
      "SELECT id FROM staff_assignments WHERE user_id = ? AND counter_id = ? AND status = 'active'",
    ).get(userId, counterId));
  };

  // List tickets with filters and offset-based pagination.
  router.get('/', (req, res) => {
    const db = getDb();
    const status = req.query.status as string | undefined;
    const serviceId = req.query.serviceId as string | undefined;
    const rawPage = req.query.page === undefined ? 1 : Number(req.query.page);
    const rawPageSize = req.query.pageSize === undefined
      ? (req.query.limit === undefined ? 100 : Number(req.query.limit))
      : Number(req.query.pageSize);
    const allowedStatuses = new Set(['waiting', 'called', 'serving', 'completed', 'no_show', 'transferred']);

    if (!Number.isSafeInteger(rawPage) || rawPage < 1) {
      res.status(400).json({ error: 'Invalid page number' }); return;
    }
    if (!Number.isSafeInteger(rawPageSize) || rawPageSize < 1 || rawPageSize > 500) {
      res.status(400).json({ error: 'Invalid page size (must be between 1 and 500)' }); return;
    }
    if (status && !allowedStatuses.has(status)) {
      res.status(400).json({ error: 'Invalid ticket status filter' }); return;
    }
    if (serviceId && (!Number.isInteger(Number(serviceId)) || Number(serviceId) < 1)) {
      res.status(400).json({ error: 'Invalid service ID filter' }); return;
    }

    const where: string[] = [];
    const params: unknown[] = [];
    if (status) { where.push('t.status = ?'); params.push(status); }
    if (serviceId) { where.push('t.service_id = ?'); params.push(Number(serviceId)); }
    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const totalRow = db.prepare(`SELECT COUNT(*) AS total FROM tickets t ${whereSql}`)
      .get(...params) as { total: number };
    const total = totalRow.total;
    const offset = (rawPage - 1) * rawPageSize;
    if (!Number.isSafeInteger(offset)) {
      res.status(400).json({ error: 'Page number is too large' }); return;
    }

    const sql = `SELECT t.*, s.name AS service_name, s.prefix AS service_prefix,
       c.number AS counter_number, vc.label_en AS category_label, vc.label_ar AS category_label_ar
       FROM tickets t
       LEFT JOIN services s ON s.id = t.service_id
       LEFT JOIN counters c ON c.id = t.counter_id
       LEFT JOIN visitor_categories vc ON vc.id = t.visitor_category_id
       ${whereSql}
       ORDER BY t.created_at DESC, t.id DESC LIMIT ? OFFSET ?`;
    const rows = db.prepare(sql).all(...params, rawPageSize, offset);
    const totalPages = Math.ceil(total / rawPageSize);
    res.json({
      tickets: rows,
      pagination: {
        page: rawPage,
        pageSize: rawPageSize,
        total,
        totalPages,
        hasNext: rawPage < totalPages,
        hasPrevious: rawPage > 1 && total > 0,
      },
    });
  });

  // Generate a new ticket (reception)
  router.post('/', requireRole('admin', 'senior_clerk', 'receptionist'), (req, res) => {
    const { service_id, visitor_category_id } = req.body ?? {};
    if (!Number.isInteger(Number(service_id)) || Number(service_id) < 1) {
      res.status(400).json({ error: 'A valid service ID is required' });
      return;
    }
    if (visitor_category_id !== undefined && visitor_category_id !== null &&
        (!Number.isInteger(Number(visitor_category_id)) || Number(visitor_category_id) < 1)) {
      res.status(400).json({ error: 'A valid visitor category ID is required' });
      return;
    }
    const db = getDb();

    // Validate service is active
    const svc = db.prepare('SELECT * FROM services WHERE id = ? AND is_active = 1').get(service_id) as
      | { id: number; prefix: string; name: string; ticket_range_start: number; ticket_range_end: number } | undefined;
    if (!svc) { res.status(404).json({ error: 'Service not found or inactive' }); return; }

    // Resolve visitor category. If reception does not explicitly choose one,
    // classify the visitor as Regular so the standard queue rank is consistent.
    let resolvedCategoryId: number | null = visitor_category_id ?? null;
    let priorityRank = 99;
    if (resolvedCategoryId === null) {
      const regular = db.prepare("SELECT id, priority_rank FROM visitor_categories WHERE code = 'regular' AND is_active = 1").get() as { id: number; priority_rank: number } | undefined;
      if (!regular) { res.status(409).json({ error: 'Regular visitor category is unavailable. Ask an administrator to activate it.' }); return; }
      resolvedCategoryId = regular.id;
      priorityRank = regular.priority_rank;
    } else {
      const vc = db.prepare('SELECT priority_rank FROM visitor_categories WHERE id = ? AND is_active = 1').get(resolvedCategoryId) as { priority_rank: number } | undefined;
      if (!vc) { res.status(400).json({ error: 'Visitor category is invalid or inactive' }); return; }
      priorityRank = vc.priority_rank;
    }

    const day = businessDate();
    const ticket = db.transaction(() => {
      const ticketNumber = allocateNumber(Number(service_id), svc.ticket_range_start, svc.ticket_range_end, day);
      if (!ticketNumber) return null;
      const info = db.prepare(
        'INSERT INTO tickets (number, service_id, status, priority, priority_rank, visitor_category_id, business_date) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run(ticketNumber, service_id, 'waiting', priorityRank <= 3 ? 'priority' : 'normal', priorityRank, resolvedCategoryId, day);
      db.prepare(
        "INSERT INTO queue_events (ticket_id, event_type, from_status, to_status) VALUES (?, 'created', NULL, 'waiting')",
      ).run(info.lastInsertRowid);
      return { id: info.lastInsertRowid, number: ticketNumber };
    }).immediate();

    if (!ticket) {
      res.status(409).json({ error: `Ticket range exhausted (${svc.ticket_range_start}–${svc.ticket_range_end}). Ask an administrator to extend this service's range.` });
      return;
    }
    broadcast('ticket-created', { ticketId: ticket.id });
    broadcast('queue-updated', {});
    res.json({ status: 'ok', ticket });
  });

  // Call next ticket for a counter
  router.post('/call-next', requireRole('admin', 'senior_clerk', 'service_officer'), (req, res) => {
    const { counter_id, service_id } = req.body ?? {};
    const user_id = req.user?.id;
    if (!counter_id || !Number.isInteger(Number(counter_id)) || !user_id) { res.status(400).json({ error: 'A valid counter ID is required' }); return; }
    const db = getDb();

    // Service officers may call tickets only from their own active counter assignment.
    // Admins and senior clerks retain cross-counter supervision access.
    if (req.user?.role === 'service_officer') {
      const assignment = db.prepare(
        "SELECT id FROM staff_assignments WHERE user_id = ? AND counter_id = ? AND status = 'active'",
      ).get(user_id, counter_id);
      if (!assignment) { res.status(403).json({ error: 'You are not actively assigned to this counter' }); return; }
    }
    const counter = db.prepare('SELECT id FROM counters WHERE id = ? AND is_active = 1').get(counter_id);
    if (!counter) { res.status(404).json({ error: 'Counter not found or inactive' }); return; }
    const assignedServices = db.prepare('SELECT service_id FROM counter_services WHERE counter_id = ?').all(counter_id) as { service_id: number }[];
    if (assignedServices.length === 0) { res.status(409).json({ error: 'Assign at least one service to this counter before calling tickets' }); return; }
    if (service_id && !assignedServices.some((s) => s.service_id === Number(service_id))) { res.status(400).json({ error: 'Selected service is not assigned to this counter' }); return; }

    // Restrict calls to services explicitly assigned to this active counter.
    let serviceFilter = '';
    const params: unknown[] = [counter_id];
    if (service_id) {
      serviceFilter = ' AND t.service_id = ?';
      params.push(service_id);
    } else {
      const svcIds = db.prepare('SELECT service_id FROM counter_services WHERE counter_id = ?').all(counter_id) as { service_id: number }[];
      const ids = svcIds.map((s) => s.service_id);
      serviceFilter = ` AND t.service_id IN (${ids.map(() => '?').join(',')})`;
      params.push(...ids);
    }

    // Use the CURRENT category rank, so changes in Queue Settings affect
    // tickets already waiting as well as newly created tickets.
    const sql = `SELECT t.* FROM tickets t
      LEFT JOIN visitor_categories vc ON vc.id = t.visitor_category_id
      WHERE t.status = 'waiting' AND (t.queued_for_counter_id IS NULL OR t.queued_for_counter_id = ?)${serviceFilter}
      ORDER BY
        -- Special-priority visitors (default ranks 1-3) always remain ahead.
        CASE WHEN COALESCE(vc.priority_rank, t.priority_rank, 99) <= 3 THEN 0 ELSE 1 END ASC,
        CASE WHEN COALESCE(vc.priority_rank, t.priority_rank, 99) <= 3
          THEN COALESCE(vc.priority_rank, t.priority_rank, 99) ELSE 0 END ASC,
        -- Among regular visitors, transferred tickets are called before the normal queue.
        t.transfer_priority DESC,
        CASE WHEN COALESCE((SELECT value FROM system_settings WHERE key = 'queue_mode'), 'priority') = 'fifo'
          THEN 0 ELSE COALESCE(vc.priority_rank, t.priority_rank, 99) END ASC,
        t.created_at ASC, t.id ASC
      LIMIT 1`;

    // Acquire SQLite's write reservation before checking the counter and selecting
    // a ticket. This serializes simultaneous call-next requests for this counter.
    const callNext = db.transaction(() => {
      const serving = db.prepare(
        "SELECT id FROM tickets WHERE counter_id = ? AND status IN ('called','serving')",
      ).get(counter_id);
      if (serving) return { conflict: true as const };

      const nextTicket = db.prepare(sql).get(...params) as { id: number; number: string; service_id: number; priority_rank: number } | undefined;
      if (!nextTicket) return null;

      const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
      const changed = db.prepare(
        "UPDATE tickets SET status = 'called', counter_id = ?, called_at = ? WHERE id = ? AND status = 'waiting'",
      ).run(counter_id, now, nextTicket.id);
      if (changed.changes !== 1) throw new Error('Ticket was already taken by another counter. Please try again.');
      db.prepare(
        "INSERT INTO queue_events (ticket_id, event_type, counter_id, user_id, from_status, to_status) VALUES (?, 'called', ?, ?, 'waiting', 'called')",
      ).run(nextTicket.id, counter_id, user_id);
      return { conflict: false as const, ticket: nextTicket };
    });
    const result = callNext.immediate();

    if (result && 'conflict' in result && result.conflict) {
      res.status(409).json({ error: 'Counter already has an active ticket. Complete or skip it first.' }); return;
    }

    if (!result) { res.status(404).json({ error: 'No waiting tickets' }); return; }
    const calledTicket = 'ticket' in result ? result.ticket : result;
    broadcast('ticket-called', { ticketId: calledTicket.id, counterId: counter_id });
    broadcast('queue-updated', {});
    res.json({ status: 'ok', ticket: calledTicket });
  });

  // Recall current ticket
  router.post('/recall', requireRole('admin', 'senior_clerk', 'service_officer'), (req, res) => {
    const { ticket_id } = req.body ?? {};
    const user_id = req.user?.id;
    if (!ticket_id) { res.status(400).json({ error: 'Ticket ID required' }); return; }
    const db = getDb();
    const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticket_id) as { id: number; counter_id: number; status: string } | undefined;
    if (!ticket) { res.status(404).json({ error: 'Ticket not found' }); return; }
    if (!canOperateCounter(user_id, req.user?.role, ticket.counter_id)) { res.status(403).json({ error: 'You are not assigned to the ticket counter' }); return; }
    if (ticket.status !== 'called') { res.status(409).json({ error: 'Can only recall a called ticket' }); return; }
    db.prepare(
      "INSERT INTO queue_events (ticket_id, event_type, counter_id, user_id, from_status, to_status) VALUES (?, 'recalled', ?, ?, 'called', 'called')",
    ).run(ticket_id, ticket.counter_id, user_id ?? null);
    broadcast('ticket-recalled', { ticketId: ticket_id, counterId: ticket.counter_id });
    broadcast('queue-updated', {});
    res.json({ status: 'ok' });
  });

  // Start serving (mark as serving)
  router.post('/start-serving', requireRole('admin', 'senior_clerk', 'service_officer'), (req, res) => {
    const { ticket_id } = req.body ?? {};
    const user_id = req.user?.id;
    if (!ticket_id) { res.status(400).json({ error: 'Ticket ID required' }); return; }
    const db = getDb();
    const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticket_id) as { id: number; status: string; counter_id: number } | undefined;
    if (!ticket) { res.status(404).json({ error: 'Ticket not found' }); return; }
    if (!canOperateCounter(user_id, req.user?.role, ticket.counter_id)) { res.status(403).json({ error: 'You are not assigned to the ticket counter' }); return; }
    if (ticket.status !== 'called') { res.status(409).json({ error: 'Ticket must be in called state' }); return; }
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const changed = db.transaction(() => {
      const update = db.prepare("UPDATE tickets SET status = 'serving', served_at = ? WHERE id = ? AND status = 'called'").run(now, ticket_id);
      if (update.changes !== 1) return false;
      db.prepare(
        "INSERT INTO queue_events (ticket_id, event_type, counter_id, user_id, from_status, to_status) VALUES (?, 'started', ?, ?, 'called', 'serving')",
      ).run(ticket_id, ticket.counter_id, user_id ?? null);
      return true;
    })();
    if (!changed) { res.status(409).json({ error: 'Ticket state changed; refresh and try again' }); return; }
    broadcast('queue-updated', {});
    res.json({ status: 'ok' });
  });

  // Complete ticket
  router.post('/complete', requireRole('admin', 'senior_clerk', 'service_officer'), (req, res) => {
    const { ticket_id } = req.body ?? {};
    const user_id = req.user?.id;
    if (!ticket_id) { res.status(400).json({ error: 'Ticket ID required' }); return; }
    const db = getDb();
    const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticket_id) as { id: number; status: string; counter_id: number } | undefined;
    if (!ticket) { res.status(404).json({ error: 'Ticket not found' }); return; }
    if (!canOperateCounter(user_id, req.user?.role, ticket.counter_id)) { res.status(403).json({ error: 'You are not assigned to the ticket counter' }); return; }
    if (!['called', 'serving'].includes(ticket.status)) { res.status(409).json({ error: 'Ticket is not being served' }); return; }
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const changed = db.transaction(() => {
      const update = db.prepare("UPDATE tickets SET status = 'completed', completed_at = ? WHERE id = ? AND status IN ('called','serving')").run(now, ticket_id);
      if (update.changes !== 1) return false;
      db.prepare(
        "INSERT INTO queue_events (ticket_id, event_type, counter_id, user_id, from_status, to_status) VALUES (?, 'completed', ?, ?, ?, 'completed')",
      ).run(ticket_id, ticket.counter_id, user_id ?? null, ticket.status);
      return true;
    })();
    if (!changed) { res.status(409).json({ error: 'Ticket state changed; refresh and try again' }); return; }
    broadcast('ticket-completed', { ticketId: ticket_id, counterId: ticket.counter_id });
    broadcast('queue-updated', {});
    res.json({ status: 'ok' });
  });

  // Skip / no-show
  router.post('/skip', requireRole('admin', 'senior_clerk', 'service_officer'), (req, res) => {
    const { ticket_id } = req.body ?? {};
    const user_id = req.user?.id;
    if (!ticket_id) { res.status(400).json({ error: 'Ticket ID required' }); return; }
    const db = getDb();
    const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticket_id) as { id: number; status: string; counter_id: number; priority_rank: number; service_id: number; number: string } | undefined;
    if (!ticket) { res.status(404).json({ error: 'Ticket not found' }); return; }
    if (!canOperateCounter(user_id, req.user?.role, ticket.counter_id)) { res.status(403).json({ error: 'You are not assigned to the ticket counter' }); return; }
    if (!['called', 'serving'].includes(ticket.status)) { res.status(409).json({ error: 'Can only skip a called/serving ticket' }); return; }
    const changed = db.transaction(() => {
      const update = db.prepare("UPDATE tickets SET status = 'no_show' WHERE id = ? AND status IN ('called','serving')").run(ticket_id);
      if (update.changes !== 1) return false;
      db.prepare(
        "INSERT INTO queue_events (ticket_id, event_type, counter_id, user_id, from_status, to_status) VALUES (?, 'no_show', ?, ?, ?, 'no_show')",
      ).run(ticket_id, ticket.counter_id, user_id ?? null, ticket.status);
      return true;
    })();
    if (!changed) { res.status(409).json({ error: 'Ticket state changed; refresh and try again' }); return; }
    broadcast('queue-updated', {});
    res.json({ status: 'ok' });
  });

  // Transfer ticket to another service
  router.post('/transfer', requireRole('admin', 'senior_clerk', 'service_officer'), (req, res) => {
    const { ticket_id, to_service_id, to_counter_id } = req.body ?? {};
    const user_id = req.user?.id;
    if (![ticket_id, to_service_id, to_counter_id].every((value) => Number.isInteger(Number(value)) && Number(value) > 0)) {
      res.status(400).json({ error: 'Valid ticket, target service, and target counter IDs are required' }); return;
    }
    const db = getDb();
    const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticket_id) as { id: number; status: string; counter_id: number | null; queued_for_counter_id: number | null; service_id: number; visitor_category_id: number | null; priority: string; priority_rank: number } | undefined;
    if (!ticket) { res.status(404).json({ error: 'Ticket not found' }); return; }

    // Reject transfers back to the same counter. Waiting tickets have no
    // counter_id, so queued_for_counter_id is also checked.
    const currentCounterId = ticket.counter_id ?? ticket.queued_for_counter_id;
    if (currentCounterId !== null && Number(currentCounterId) === Number(to_counter_id)) {
      res.status(400).json({ error: 'Ticket is already assigned to the selected counter' }); return;
    }

    if (!canOperateCounter(user_id, req.user?.role, ticket.counter_id)) { res.status(403).json({ error: 'You are not assigned to the ticket counter' }); return; }
    const targetSvc = db.prepare('SELECT * FROM services WHERE id = ? AND is_active = 1').get(to_service_id) as { id: number; prefix: string; ticket_range_start: number; ticket_range_end: number } | undefined;
    if (!targetSvc) { res.status(404).json({ error: 'Target service not found or inactive' }); return; }
    const targetCounter = db.prepare('SELECT id FROM counters WHERE id = ? AND is_active = 1').get(to_counter_id);
    if (!targetCounter) { res.status(404).json({ error: 'Target counter not found or inactive' }); return; }
    const targetAssignment = db.prepare('SELECT 1 FROM counter_services WHERE counter_id = ? AND service_id = ?').get(to_counter_id, to_service_id);
    if (!targetAssignment) { res.status(400).json({ error: 'Selected service is not assigned to the target counter' }); return; }

    if (!['waiting','called','serving'].includes(ticket.status)) { res.status(409).json({ error: 'Only waiting or active tickets can be transferred' }); return; }

    const result = db.transaction(() => {
      // Keep the same ticket record, number, and original created_at so the
      // visitor does not lose the time already spent waiting at the source counter.
      const changed = db.prepare(
        "UPDATE tickets SET service_id = ?, status = 'waiting', counter_id = NULL, queued_for_counter_id = ?, transferred_to_service_id = NULL, transfer_priority = 1 WHERE id = ? AND status = ?",
      ).run(to_service_id, to_counter_id, ticket_id, ticket.status);
      if (changed.changes !== 1) throw new Error('Ticket state changed; refresh and try again');

      db.prepare(
        "INSERT INTO queue_events (ticket_id, event_type, counter_id, user_id, from_status, to_status, meta) VALUES (?, 'transferred', ?, ?, ?, 'waiting', ?)",
      ).run(ticket_id, ticket.counter_id, user_id ?? null, ticket.status, JSON.stringify({
        from_service_id: ticket.service_id,
        to_service_id,
        to_counter_id,
        same_ticket_number: true,
        transfer_priority: true,
      }));
      return { ticketId: ticket.id, number: String((db.prepare('SELECT number FROM tickets WHERE id = ?').get(ticket_id) as { number: string }).number) };
    }).immediate();

    broadcast('ticket-transferred', { ticketId: ticket_id, newTicketId: ticket_id, counterId: to_counter_id });
    broadcast('queue-updated', {});
    res.json({ status: 'ok', ...result });
  });

  // Get current state for a counter
  router.get('/counter/:counterId/active', requireRole('admin', 'senior_clerk', 'service_officer'), (req, res) => {
    const counterId = Number(req.params.counterId);
    if (!Number.isInteger(counterId) || counterId < 1) {
      res.status(400).json({ error: 'A valid counter ID is required' });
      return;
    }
    const db = getDb();
    const counter = db.prepare('SELECT id FROM counters WHERE id = ? AND is_active = 1').get(counterId);
    if (!counter) {
      res.status(404).json({ error: 'Counter not found or inactive' });
      return;
    }
    if (!canOperateCounter(req.user?.id, req.user?.role, counterId)) {
      res.status(403).json({ error: 'You are not assigned to this counter' });
      return;
    }
    const active = db.prepare(
      `SELECT t.*, s.name AS service_name, s.name_ar AS service_name_ar, s.prefix AS service_prefix,
       vc.label_en AS category_label, vc.label_ar AS category_label_ar
       FROM tickets t
       LEFT JOIN services s ON s.id = t.service_id
       LEFT JOIN visitor_categories vc ON vc.id = t.visitor_category_id
       WHERE t.counter_id = ? AND t.status IN ('called','serving')`,
    ).get(counterId) as Record<string, unknown> | undefined;

    const waiting = db.prepare(
      `SELECT t.id, t.number, t.priority_rank, t.transfer_priority, t.created_at, s.name AS service_name, s.name_ar AS service_name_ar, s.prefix AS service_prefix,
       vc.label_en AS category_label, vc.label_ar AS category_label_ar
       FROM tickets t
       JOIN services s ON s.id = t.service_id
       LEFT JOIN visitor_categories vc ON vc.id = t.visitor_category_id
       LEFT JOIN counter_services cs ON cs.service_id = t.service_id AND cs.counter_id = ?
       WHERE t.status = 'waiting' AND cs.counter_id IS NOT NULL AND (t.queued_for_counter_id IS NULL OR t.queued_for_counter_id = ?)
       ORDER BY
         CASE WHEN COALESCE(vc.priority_rank, t.priority_rank, 99) <= 3 THEN 0 ELSE 1 END ASC,
         CASE WHEN COALESCE(vc.priority_rank, t.priority_rank, 99) <= 3
           THEN COALESCE(vc.priority_rank, t.priority_rank, 99) ELSE 0 END ASC,
         t.transfer_priority DESC,
         CASE WHEN COALESCE((SELECT value FROM system_settings WHERE key = 'queue_mode'), 'priority') = 'fifo'
           THEN 0 ELSE COALESCE(vc.priority_rank, t.priority_rank, 99) END ASC,
         t.created_at ASC, t.id ASC LIMIT 20`,
    ).all(counterId, counterId);

    res.json({ active, waiting });
  });

  return router;
}
