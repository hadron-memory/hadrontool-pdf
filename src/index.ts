import { createApp } from './app.js';
import { config } from './config.js';
import { logger } from './logger.js';
import { closeBrowser, getBrowser } from './lib/browser.js';

const app = createApp();

const server = app.listen(config.port, () => {
  logger.info('hadrontool-pdf listening', {
    port: config.port,
    env: config.nodeEnv,
    authRequired: Boolean(config.serviceToken),
    allowRemote: config.allowRemote,
  });
});

// Warm the headless browser at boot so the first request isn't slow. Failure
// here is non-fatal — the first render will retry the launch and surface the
// real error to the caller.
void getBrowser().catch((err) => {
  logger.warn('browser warm-up failed (will retry on first request)', { err: String(err) });
});

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('shutting down', { signal });

  server.close(() => logger.info('http server closed'));
  await closeBrowser();

  // Give in-flight responses a moment, then exit.
  setTimeout(() => process.exit(0), 1_000).unref();
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
