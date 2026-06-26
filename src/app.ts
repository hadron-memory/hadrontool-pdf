import express, { type Express } from 'express';
import cors from 'cors';
import { config } from './config.js';
import { healthRouter } from './routes/health.js';
import { convertRouter } from './routes/convert.js';
import { errorHandler, notFound } from './middleware/error.js';

/**
 * Build the Express app. Exported separately from the server bootstrap so tests
 * can exercise it with supertest without binding a port.
 */
export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');
  app.use(cors());

  // pdf-to-markdown accepts a raw application/pdf body; everything else is JSON.
  app.use(express.raw({ type: 'application/pdf', limit: config.maxBodySize }));
  app.use(express.json({ limit: config.maxBodySize }));

  app.use(healthRouter);
  app.use('/convert', convertRouter);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
