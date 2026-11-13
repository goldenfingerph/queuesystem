import { Router } from 'express';
import { broadcast } from '../ws/index.js';
import { writeAuditLog } from '../lib/audit-log.js';
import { getDb } from '../db/index.js';
import {
  createService,
  deleteService,
  listServices,
  ServiceManagementError,
  updateService,
} from '../services/service-management.js';

function handleServiceError(error: unknown, res: import('express').Response): void {
  if (error instanceof ServiceManagementError) {
    const status = error.code === 'VALIDATION' ? 400
      : error.code === 'NOT_FOUND' ? 404
        : 409;
    res.status(status).json({ error: error.message });
    return;
  }
  console.error('[services] operation failed:', error);
  res.status(500).json({ error: 'Unable to complete service operation due to a server error.' });
}

export function servicesRouter(): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    res.json({ services: listServices() });
  });

  router.post('/', (req, res) => {
    try {
      const id = createService(req.body ?? {});
      writeAuditLog(getDb(), {
        actorUserId: req.user!.id, actorUsername: req.user!.username, ipAddress: req.socket.remoteAddress,
        action: 'service.created', targetType: 'service', targetId: id,
        details: { code: String(req.body?.code ?? '').toUpperCase(), name: String(req.body?.name ?? '') },
      });
      broadcast('services-updated', {});
      res.json({ status: 'ok', id });
    } catch (error) {
      handleServiceError(error, res);
    }
  });

  router.put('/:id', (req, res) => {
    const id = Number(req.params.id);
    try {
      updateService(id, req.body ?? {});
      writeAuditLog((await import('../db/index.js')).getDb(), {
        actorUserId: req.user!.id, actorUsername: req.user!.username, ipAddress: req.socket.remoteAddress,
        action: 'service.updated', targetType: 'service', targetId: id,
        details: { changedFields: Object.keys(req.body ?? {}).sort().join(',') },
      });
      broadcast('services-updated', {});
      res.json({ status: 'ok' });
    } catch (error) {
      handleServiceError(error, res);
    }
  });

  router.delete('/:id', (req, res) => {
    const id = Number(req.params.id);
    try {
      deleteService(id);
      writeAuditLog((await import('../db/index.js')).getDb(), {
        actorUserId: req.user!.id, actorUsername: req.user!.username, ipAddress: req.socket.remoteAddress,
        action: 'service.deleted', targetType: 'service', targetId: id,
      });
      broadcast('services-updated', {});
      res.json({ status: 'ok' });
    } catch (error) {
      handleServiceError(error, res);
    }
  });

  return router;
}
