import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { logger } from '../logger.js';

const execFileAsync = promisify(execFile);

/**
 * Families the Dockerfile declares on purpose (hadrontool-pdf#6): the Latin design-font substitutes
 * (`fonts-liberation`, metric-compatible with Arial/Times/Courier) and the scripts the base image lacks
 * (`fonts-noto-core`: Hebrew, Devanagari), and GNU FreeFont (`fonts-freefont-ttf`: Latin/Cyrillic/Greek). KEEP IN SYNC with the Dockerfile's package list and its build-time check.
 */
export const REQUIRED_FAMILIES = [
  'Liberation Sans',
  'Liberation Serif',
  'Liberation Mono',
  'Noto Sans Hebrew',
  'Noto Sans Devanagari',
  'FreeSans',
  'FreeSerif',
  'FreeMono',
] as const;

export interface FontReport {
  /** Where the list came from: the container's fontconfig, or nothing (the list is then empty, never guessed). */
  source: 'fc-list' | 'unavailable';
  families: string[];
  /** Declared families the image does not actually provide; empty on a healthy image. */
  missingDeclared: string[];
  error?: string;
}

/** `fc-list : family` prints one line per face, each possibly a comma-joined alias list. */
export function parseFcFamilies(output: string): string[] {
  const set = new Set<string>();
  for (const line of output.split('\n')) {
    for (const name of line.split(',')) {
      const n = name.trim();
      if (n) set.add(n);
    }
  }
  return [...set].sort((a, b) => a.localeCompare(b, 'en'));
}

async function runFcList(): Promise<string> {
  const { stdout } = await execFileAsync('fc-list', [':', 'family'], { timeout: 5000, maxBuffer: 4 * 1024 * 1024 });
  return stdout;
}

export async function readFontReport(run: () => Promise<string> = runFcList): Promise<FontReport> {
  try {
    const families = parseFcFamilies(await run());
    return {
      source: 'fc-list',
      families,
      missingDeclared: REQUIRED_FAMILIES.filter((f) => !families.includes(f)),
    };
  } catch (err) {
    logger.warn('fc-list failed', { error: err instanceof Error ? err.message : String(err) });
    return {
      source: 'unavailable',
      families: [],
      missingDeclared: [...REQUIRED_FAMILIES],
      // A fixed reason: the raw spawn/exec text can carry paths and environment detail; the cause goes to the log.
      error: 'fc-list could not be run',
    };
  }
}

/** Fonts do not change while the container runs, so one successful read is kept; a failed read is retried. */
export function createFontReportCache(run: () => Promise<string> = runFcList): () => Promise<FontReport> {
  let cached: Promise<FontReport> | undefined;
  return () => {
    if (!cached) {
      cached = readFontReport(run).then((r) => {
        if (r.source === 'unavailable') cached = undefined;
        return r;
      });
      // readFontReport cannot reject (total try/catch); if that ever changed, do not cache the rejection forever.
      cached.catch(() => {
        cached = undefined;
      });
    }
    return cached;
  };
}

export const getFontReport = createFontReportCache();
