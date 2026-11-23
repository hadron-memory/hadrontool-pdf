import { describe, expect, it } from 'vitest';
import { REQUIRED_FAMILIES, createFontReportCache, parseFcFamilies, readFontReport } from './fonts.js';

describe('parseFcFamilies', () => {
  it('splits comma-joined aliases, trims, dedupes and sorts', () => {
    const out = parseFcFamilies('Liberation Sans,Liberation Sans Narrow\nNoto Sans Hebrew\nLiberation Sans\n\n  DejaVu Sans  \n');
    expect(out).toEqual(['DejaVu Sans', 'Liberation Sans', 'Liberation Sans Narrow', 'Noto Sans Hebrew']);
  });

  it('is empty for empty output', () => {
    expect(parseFcFamilies('')).toEqual([]);
  });
});

describe('readFontReport', () => {
  it('lists families and marks the declared set present', async () => {
    const out = ['Liberation Sans', 'Liberation Serif', 'Liberation Mono', 'Noto Sans Hebrew', 'Noto Sans Devanagari'].join('\n');
    const r = await readFontReport(async () => out);
    expect(r.source).toBe('fc-list');
    expect(r.families).toContain('Liberation Sans');
    expect(r.missingDeclared).toEqual([]);
  });

  it('names every declared family that is absent, so a drifted image is visible', async () => {
    const r = await readFontReport(async () => 'DejaVu Sans\n');
    expect(r.families).toEqual(['DejaVu Sans']);
    expect(r.missingDeclared).toEqual([...REQUIRED_FAMILIES]);
  });

  it('reports unavailable with an empty list and a reason when fc-list cannot run (never a fabricated list)', async () => {
    const r = await readFontReport(async () => {
      throw new Error('spawn fc-list ENOENT');
    });
    expect(r.source).toBe('unavailable');
    expect(r.families).toEqual([]);
    // fixed reason, never the raw exec text
    expect(r.error).toBe('fc-list could not be run');
    expect(r.error).not.toMatch(/ENOENT|spawn/);
    expect(r.missingDeclared).toEqual([...REQUIRED_FAMILIES]);
  });
});

describe('createFontReportCache', () => {
  it('keeps one successful read', async () => {
    let calls = 0;
    const get = createFontReportCache(async () => {
      calls++;
      return 'Liberation Sans\n';
    });
    await get();
    await get();
    expect(calls).toBe(1);
  });

  it('retries after a failed read instead of caching the failure', async () => {
    let calls = 0;
    const get = createFontReportCache(async () => {
      calls++;
      if (calls === 1) throw new Error('boom');
      return 'Liberation Sans\n';
    });
    expect((await get()).source).toBe('unavailable');
    expect((await get()).source).toBe('fc-list');
    expect(calls).toBe(2);
  });
});
