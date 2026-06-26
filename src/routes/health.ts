import { Router } from 'express';
import { browserHealthy } from '../lib/browser.js';

export const healthRouter = Router();

/** Liveness — the process is up and the event loop is responsive. */
healthRouter.get('/healthz', (_req, res) => {
  res.json({ status: 'ok' });
});

/** Readiness — also reports whether the headless browser is currently warm. */
healthRouter.get('/readyz', async (_req, res) => {
  const browser = await browserHealthy();
  res.json({ status: 'ok', browserWarm: browser });
});
