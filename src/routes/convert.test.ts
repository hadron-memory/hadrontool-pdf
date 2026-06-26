import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { getBrowser, closeBrowser } from '../lib/browser.js';

const app = createApp();

// Browser-dependent tests are skipped (not failed) when Chromium can't launch
// in the environment, so the pure-HTTP suite still runs everywhere.
let browserOk = false;
beforeAll(async () => {
  try {
    await getBrowser();
    browserOk = true;
  } catch {
    browserOk = false;
  }
});
afterAll(async () => {
  await closeBrowser();
});

describe('health + routing', () => {
  it('GET /healthz returns ok', async () => {
    const res = await request(app).get('/healthz');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('GET /convert/info describes the service', async () => {
    const res = await request(app).get('/convert/info');
    expect(res.status).toBe(200);
    expect(res.body.directions).toContain('markdown-to-pdf');
    expect(res.body.directions).toContain('pdf-to-markdown');
  });

  it('unknown route 404s', async () => {
    const res = await request(app).get('/nope');
    expect(res.status).toBe(404);
  });
});

describe('POST /convert/markdown-to-pdf validation', () => {
  it('rejects an empty markdown body', async () => {
    const res = await request(app).post('/convert/markdown-to-pdf').send({ markdown: '' });
    expect(res.status).toBe(400);
  });

  it('rejects a missing markdown field', async () => {
    const res = await request(app).post('/convert/markdown-to-pdf').send({});
    expect(res.status).toBe(400);
  });
});

describe('POST /convert/pdf-to-markdown validation', () => {
  it('rejects a non-PDF raw body', async () => {
    const res = await request(app)
      .post('/convert/pdf-to-markdown')
      .set('content-type', 'application/pdf')
      .send(Buffer.from('not a pdf'));
    expect(res.status).toBe(400);
  });
});

describe('round-trip (requires Chromium)', () => {
  it('markdown -> pdf returns PDF bytes, then pdf -> markdown recovers the text', async (ctx) => {
    if (!browserOk) ctx.skip();

    const markdown = '# Quarterly Report\n\nRevenue grew by twelve percent this quarter.';
    const pdfRes = await request(app)
      .post('/convert/markdown-to-pdf')
      .send({ markdown, options: { title: 'Q3' } })
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });

    expect(pdfRes.status).toBe(200);
    expect(pdfRes.headers['content-type']).toContain('application/pdf');
    const pdf = pdfRes.body as Buffer;
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');

    const mdRes = await request(app)
      .post('/convert/pdf-to-markdown')
      .set('content-type', 'application/pdf')
      .send(pdf);

    expect(mdRes.status).toBe(200);
    expect(mdRes.body.pageCount).toBeGreaterThanOrEqual(1);
    expect(mdRes.body.markdown.toLowerCase()).toContain('quarterly report');
    expect(mdRes.body.markdown.toLowerCase()).toContain('revenue grew');
  });

  it('base64 output mode returns pdfBase64', async (ctx) => {
    if (!browserOk) ctx.skip();
    const res = await request(app)
      .post('/convert/markdown-to-pdf?format=base64')
      .send({ markdown: '# Hi' });
    expect(res.status).toBe(200);
    expect(typeof res.body.pdfBase64).toBe('string');
    expect(Buffer.from(res.body.pdfBase64, 'base64').subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });
});
