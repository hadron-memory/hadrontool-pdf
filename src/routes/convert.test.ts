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
    expect(res.body.directions).toContain('markdown-to-html');
    expect(res.body.directions).toContain('pdf-to-markdown');
    expect(res.body.directions).toContain('html-to-markdown');
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

describe('POST /convert/markdown-to-html', () => {
  it('rejects an empty markdown body', async () => {
    const res = await request(app).post('/convert/markdown-to-html').send({ markdown: '' });
    expect(res.status).toBe(400);
  });

  it('renders a self-contained HTML document by default', async () => {
    const res = await request(app)
      .post('/convert/markdown-to-html')
      .send({ markdown: '# Title\n\nHello **world**.', options: { title: 'Doc' } });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.text).toContain('<!DOCTYPE html>');
    expect(res.text).toContain('<title>Doc</title>');
    expect(res.text).toContain('<h1>Title</h1>');
    expect(res.text).toContain('<strong>world</strong>');
  });

  it('returns { html, bytes } as JSON when requested', async () => {
    const res = await request(app)
      .post('/convert/markdown-to-html?format=json')
      .send({ markdown: '# Hi' });
    expect(res.status).toBe(200);
    expect(typeof res.body.html).toBe('string');
    expect(res.body.html).toContain('<h1>Hi</h1>');
    expect(res.body.bytes).toBe(Buffer.byteLength(res.body.html));
  });

  it('neutralizes a </style> breakout in the css option', async () => {
    const res = await request(app)
      .post('/convert/markdown-to-html')
      .send({ markdown: '# Hi', options: { css: '</style><script>alert(1)</script>' } });
    expect(res.status).toBe(200);
    // The injected close tag must not close the real <style> element.
    expect(res.text).not.toContain('</style><script>');
  });
});

describe('POST /convert/html-to-markdown', () => {
  it('rejects an empty html body', async () => {
    const res = await request(app).post('/convert/html-to-markdown').send({ html: '' });
    expect(res.status).toBe(400);
  });

  it('converts HTML to Markdown (headings, emphasis, links, lists)', async () => {
    const html =
      '<h1>Title</h1><p>Hello <strong>world</strong> and a <a href="https://example.com">link</a>.</p><ul><li>one</li><li>two</li></ul>';
    const res = await request(app).post('/convert/html-to-markdown').send({ html });
    expect(res.status).toBe(200);
    expect(res.body.markdown).toContain('# Title');
    expect(res.body.markdown).toContain('**world**');
    expect(res.body.markdown).toContain('[link](https://example.com)');
    expect(res.body.markdown).toMatch(/-\s+one/);
  });

  it('strips scripts, styles, and event handlers', async () => {
    const html =
      '<p>safe text</p><script>alert(1)</script><style>.x{color:red}</style><img src="x" onerror="alert(1)">';
    const res = await request(app).post('/convert/html-to-markdown').send({ html });
    expect(res.status).toBe(200);
    expect(res.body.markdown).toContain('safe text');
    expect(res.body.markdown).not.toContain('alert');
    expect(res.body.markdown).not.toContain('onerror');
    expect(res.body.markdown).not.toContain('color:red');
  });

  it('drops javascript: link targets', async () => {
    const html = '<p><a href="javascript:alert(1)">click</a></p>';
    const res = await request(app).post('/convert/html-to-markdown').send({ html });
    expect(res.status).toBe(200);
    expect(res.body.markdown).not.toContain('javascript:');
  });

  it('sniffs the title from <title> and accepts a raw text/html body', async () => {
    const html = '<html><head><title>My Page</title></head><body><h1>Body</h1></body></html>';
    const res = await request(app)
      .post('/convert/html-to-markdown')
      .set('content-type', 'text/html')
      .send(html);
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('My Page');
    expect(res.body.markdown).toContain('# Body');
    // The <title> text must not leak into the converted body.
    expect(res.body.markdown).not.toContain('My Page');
  });

  it('strips nested tags and decodes entities in the sniffed title', async () => {
    const html = '<title>Foo &amp; <b>Bar</b> &quot;baz&quot;</title><p>body</p>';
    const res = await request(app).post('/convert/html-to-markdown').send({ html });
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Foo & Bar "baz"');
  });

  it('drops mailto: link targets, keeping only http(s)', async () => {
    const html = '<p><a href="mailto:x@example.com">mail</a> <a href="https://ok.example">ok</a></p>';
    const res = await request(app).post('/convert/html-to-markdown').send({ html });
    expect(res.status).toBe(200);
    expect(res.body.markdown).not.toContain('mailto:');
    expect(res.body.markdown).toContain('[ok](https://ok.example)');
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
