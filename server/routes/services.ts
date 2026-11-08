import { Router } from 'express';
import { getDb } from '../db/index.js';
import { broadcast } from '../ws/index.js';
import { createService, deleteService, listServices, updateService } from '../services/service-service.js';

export function servicesRouter(): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    res.json({ services: listServices(getDb()) });
  });

  router.post('/', (req, res) => {
    const { name, name_ar, code, description, prefix, avg_duration_sec, ticket_range_start, ticket_range_end } = req.body ?? {};
    const rangeStart = Number(ticket_range_start), rangeEnd = Number(ticket_range_end);
    const duration = avg_duration_sec === undefined ? 300 : Number(avg_duration_sec);

    if (typeof name !== 'string' || !name.trim() || name.trim().length > 100) {
      res.status(400).json({ error: 'Service name must be 1–100 characters' }); return;
    }
    if (typeof name_ar !== 'string' || !name_ar.trim() || name_ar.trim().length > 150) {
      res.status(400).json({ error: 'Arabic service name is required and must be 150 characters or fewer' }); return;
    }
    if (typeof code !== 'string' || !/^[A-Za-z0-9_-]{2,12}$/.test(code)) {
      res.status(400).json({ error: 'Service code must be 2–12 letters, numbers, hyphens, or underscores' }); return;
    }
    if (typeof prefix !== 'string' || !prefix.trim() || prefix.trim().length > 12) {
      res.status(400).json({ error: 'Prefix is required and must be 12 characters or fewer' }); return;
    }
    if (description !== undefined && (typeof description !== 'string' || description.length > 500)) {
      res.status(400).json({ error: 'Description must be 500 characters or fewer' }); return;
    }
    if (!Number.isInteger(duration) || duration < 1 || duration > 86400) {
      res.status(400).json({ error: 'Average duration must be between 1 and 86400 seconds' }); return;
    }
    if (!Number.isInteger(rangeStart) || !Number.isInteger(rangeEnd) || rangeStart < 1000 || rangeEnd > 9999 || rangeStart > rangeEnd) {
      res.status(400).json({ error: 'Ticket range must be valid 4-digit numbers, with start not greater than end.' }); return;
    }

    try {
      const id = createService(getDb(), {
        name, name_ar, code, description, prefix,
        avg_duration_sec: duration,
        ticket_range_start: rangeStart,
        ticket_range_end: rangeEnd,
      });
      broadcast('services-updated', {});
      res.json({ status: 'ok', id });
    } catch (err) {
      const message = (err as Error).message;
      if (message === 'TICKET_RANGE_CONFLICT') {
        res.status(409).json({ error: 'This ticket number range overlaps another service. Choose a different range.' });
      } else if (message.includes('UNIQUE')) {
        res.status(409).json({ error: 'Service code already exists' });
      } else {
        console.error('[services] create failed:', err);
        res.status(500).json({ error: 'Unable to create service due to a server error.' });
      }
    }
  });

  router.put('/:id', (req, res) => {
    const { id } = req.params;
    const { name, name_ar, code, description, prefix, avg_duration_sec, is_active, ticket_range_start, ticket_range_end } = req.body ?? {};

    if (name !== undefined && (typeof name !== 'string' || !name.trim() || name.trim().length > 100)) {
      res.status(400).json({ error: 'Service name must be 1–100 characters' }); return;
    }
    if (name_ar !== undefined && (typeof name_ar !== 'string' || !name_ar.trim() || name_ar.trim().length > 150)) {
      res.status(400).json({ error: 'Arabic service name is required and must be 150 characters or fewer' }); return;
    }
    if (code !== undefined && (typeof code !== 'string' || !/^[A-Za-z0-9_-]{2,12}$/.test(code))) {
      res.status(400).json({ error: 'Service code must be 2–12 letters, numbers, hyphens, or underscores' }); return;
    }
    if (description !== undefined && (typeof description !== 'string' || description.length > 500)) {
      res.status(400).json({ error: 'Description must be 500 characters or fewer' }); return;
    }
    if (prefix !== undefined && (typeof prefix !== 'string' || !prefix.trim() || prefix.length > 12)) {
      res.status(400).json({ error: 'Prefix is required and must be 12 characters or fewer' }); return;
    }
    if (avg_duration_sec !== undefined && (!Number.isInteger(Number(avg_duration_sec)) || Number(avg_duration_sec) < 1 || Number(avg_duration_sec) > 86400)) {
      res.status(400).json({ error: 'Average duration must be between 1 and 86400 seconds' }); return;
    }
    if (is_active !== undefined && ![0, 1, true, false].includes(is_active)) {
      res.status(400).json({ error: 'Invalid active flag' }); return;
    }

    const patch: Parameters<typeof updateService>[2] = {};
    if (name !== undefined) patch.name = name;
    if (name_ar !== undefined) patch.name_ar = name_ar;
    if (code !== undefined) patch.code = code;
    if (description !== undefined) patch.description = description;
    if (prefix !== undefined) patch.prefix = prefix;
    if (avg_duration_sec !== undefined) patch.avg_duration_sec = Number(avg_duration_sec);
    if (is_active !== undefined) patch.is_active = is_active as boolean | 0 | 1;
    if (ticket_range_start !== undefined) patch.ticket_range_start = Number(ticket_range_start);
    if (ticket_range_end !== undefined) patch.ticket_range_end = Number(ticket_range_end);

    try {
      updateService(getDb(), id, patch);
      broadcast('services-updated', {});
      res.json({ status: 'ok' });
    } catch (err) {
      const message = (err as Error).message;
      if (message === 'TICKET_RANGE_CONFLICT') {
        res.status(409).json({ error: 'This ticket number range overlaps another service. Choose a different range.' });
      } else if (message === 'INVALID_TICKET_RANGE') {
        res.status(400).json({ error: 'Ticket range must be valid 4-digit numbers, with start not greater than end.' });
      } else if (message === 'SERVICE_NOT_FOUND') {
        res.status(404).json({ error: 'Service not found' });
      } else if (message === 'NO_FIELDS_TO_UPDATE') {
        res.status(400).json({ error: 'No fields to update' });
      } else if (message.includes('UNIQUE')) {
        res.status(409).json({ error: 'Service code already exists' });
      } else {
        console.error('[services] update failed:', err);
        res.status(500).json({ error: 'Unable to update service due to a server error.' });
      }
    }
  });

  router.delete('/:id', (req, res) => {
    try {
      deleteService(getDb(), req.params.id);
      broadcast('services-updated', {});
      res.json({ status: 'ok' });
    } catch (err) {
      if ((err as Error).message === 'SERVICE_HAS_TICKETS') {
        res.status(409).json({ error: 'Cannot delete a service that has tickets. Disable it instead.' });
      } else {
        console.error('[services] delete failed:', err);
        res.status(500).json({ error: 'Unable to delete service due to a server error.' });
      }
    }
  });

  return router;
}
