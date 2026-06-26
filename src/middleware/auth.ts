import type { NextFunction, Request, Response } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Bearer-token gate for the /convert/* routes. When PDF_SERVICE_TOKEN is unset
 * (development only — production boot refuses this), the gate is a pass-through.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!config.serviceToken) {
    next();
    return;
  }

  const header = req.get('authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match || !safeEqual(match[1], config.serviceToken)) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  next();
}
