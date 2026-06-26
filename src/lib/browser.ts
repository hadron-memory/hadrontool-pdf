import puppeteer, { type Browser } from 'puppeteer';
import { logger } from '../logger.js';

/**
 * Singleton headless-browser manager. Launching Chromium costs ~200-500ms, so
 * we keep one instance warm and reuse it across renders (one fresh page per
 * request). The instance is launched lazily on first use and re-launched
 * automatically if it disconnects (crash, OOM-kill).
 */
let browserPromise: Promise<Browser> | null = null;

const LAUNCH_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--font-render-hinting=none',
];

async function launch(): Promise<Browser> {
  logger.info('launching headless browser');
  const browser = await puppeteer.launch({
    headless: true,
    args: LAUNCH_ARGS,
  });
  browser.on('disconnected', () => {
    logger.warn('headless browser disconnected; will relaunch on next use');
    browserPromise = null;
  });
  return browser;
}

export async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = launch().catch((err) => {
      browserPromise = null;
      throw err;
    });
  }
  return browserPromise;
}

/** True once a browser has been launched and is still connected. */
export async function browserHealthy(): Promise<boolean> {
  if (!browserPromise) return false;
  try {
    const browser = await browserPromise;
    return browser.connected;
  } catch {
    return false;
  }
}

export async function closeBrowser(): Promise<void> {
  if (!browserPromise) return;
  const current = browserPromise;
  browserPromise = null;
  try {
    const browser = await current;
    await browser.close();
  } catch (err) {
    logger.warn('error closing browser', { err: String(err) });
  }
}
