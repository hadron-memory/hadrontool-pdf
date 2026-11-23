import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';

let report: unknown = {
  source: 'fc-list',
  families: ['Liberation Sans', 'Noto Sans Devanagari', 'Noto Sans Hebrew'],
  missingDeclared: ['Liberation Serif'],
};
vi.mock('../lib/fonts.js', () => ({ getFontReport: async () => report }));

import { createApp } from '../app.js';

describe('GET /convert/info fonts (hadrontool-pdf#6)', () => {
  it('reports the installed families and any declared family the image lacks', async () => {
    const res = await request(createApp()).get('/convert/info');
    expect(res.status).toBe(200);
    expect(res.body.fonts.source).toBe('fc-list');
    expect(res.body.fonts.families).toEqual(['Liberation Sans', 'Noto Sans Devanagari', 'Noto Sans Hebrew']);
    expect(res.body.fonts.missingDeclared).toEqual(['Liberation Serif']);
    // the existing surface is unchanged
    expect(res.body.directions).toContain('html-to-pdf');
    expect(res.body.allowRemote).toBe(false);
  });

  it('answers 200 with the fail-closed report when fc-list is unavailable', async () => {
    report = {
      source: 'unavailable',
      families: [],
      missingDeclared: ['Liberation Sans'],
      error: 'fc-list could not be run',
    };
    const res = await request(createApp()).get('/convert/info');
    expect(res.status).toBe(200);
    expect(res.body.fonts.source).toBe('unavailable');
    expect(res.body.fonts.families).toEqual([]);
    expect(res.body.fonts.missingDeclared).toEqual(['Liberation Sans']);
    expect(res.body.fonts.error).toBe('fc-list could not be run');
  });
});
