import { Router } from 'express';
import type { HealthService } from '../services/health.service';

export function createHealthRouter(health: HealthService): Router {
  const router = Router();

  /** Liveness: the process is up. Used by the container orchestrator. */
  router.get('/live', (_req, res) => {
    res.json({ status: 'ok' });
  });

  /** Readiness: Redis, Temporal and BOTH suppliers are probed. */
  router.get('/', async (_req, res) => {
    const report = await health.check();
    res.status(report.status === 'down' ? 503 : 200).json(report);
  });

  return router;
}
