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
    expect(res.body.directions).toContain('html-to-pdf');
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

describe('POST /convert/html-to-pdf validation', () => {
  it('rejects an empty html body', async () => {
    const res = await request(app).post('/convert/html-to-pdf').send({ html: '' });
    expect(res.status).toBe(400);
  });

  it('rejects a missing html field', async () => {
    const res = await request(app).post('/convert/html-to-pdf').send({});
    expect(res.status).toBe(400);
  });

  it('rejects an empty raw text/html body', async () => {
    const res = await request(app)
      .post('/convert/html-to-pdf')
      .set('content-type', 'text/html')
      .send('');
    expect(res.status).toBe(400);
  });

  it('rejects an unknown paper format', async () => {
    const res = await request(app)
      .post('/convert/html-to-pdf')
      .send({ html: '<p>hi</p>', options: { format: 'Poster' } });
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

  it('html -> pdf renders the caller document verbatim, then round-trips back', async (ctx) => {
    if (!browserOk) ctx.skip();

    const html =
      '<!DOCTYPE html><html><head><title>Ignored</title></head>' +
      '<body><h1>Certificate of Completion</h1><p>Awarded to Amara Okonkwo.</p></body></html>';

    const pdfRes = await request(app)
      .post('/convert/html-to-pdf')
      .send({ html, options: { title: 'Cert', landscape: true } })
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });

    expect(pdfRes.status).toBe(200);
    expect(pdfRes.headers['content-type']).toContain('application/pdf');
    expect(pdfRes.headers['content-disposition']).toContain('Cert.pdf');
    const pdf = pdfRes.body as Buffer;
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');

    const mdRes = await request(app)
      .post('/convert/pdf-to-markdown')
      .set('content-type', 'application/pdf')
      .send(pdf);

    expect(mdRes.status).toBe(200);
    expect(mdRes.body.markdown.toLowerCase()).toContain('certificate of completion');
    expect(mdRes.body.markdown).toContain('Amara Okonkwo');
  });

  it('accepts a raw text/html body and returns base64 on request', async (ctx) => {
    if (!browserOk) ctx.skip();
    const res = await request(app)
      .post('/convert/html-to-pdf?format=base64')
      .set('content-type', 'text/html')
      .send('<h1>Raw body</h1>');
    expect(res.status).toBe(200);
    expect(Buffer.from(res.body.pdfBase64, 'base64').subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('renders an inlined data: URI image with remote fetching disabled', async (ctx) => {
    if (!browserOk) ctx.skip();
    // The hardening aborts every non-data: request, so an inlined asset is the
    // only way a layout can carry a background or a signature. Pinning it here
    // because a regression would return 200 with the image silently missing.
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="#0b5cd5"/></svg>',
    ).toString('base64');
    const html = `<body><img src="data:image/svg+xml;base64,${svg}"><p>with art</p></body>`;

    const res = await request(app).post('/convert/html-to-pdf?format=base64').send({ html });
    expect(res.status).toBe(200);
    expect(Buffer.from(res.body.pdfBase64, 'base64').subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('the css option actually takes effect in the rendered PDF', async (ctx) => {
    if (!browserOk) ctx.skip();

    // Asserts the OUTCOME rather than where the <style> element was placed.
    // That distinction is the whole point here: the failure mode this endpoint
    // kept producing was a stylesheet parsed as text, which returns 200 with a
    // well-formed PDF and no styles applied — indistinguishable from success
    // unless something reads the rendered page back.
    const html = '<html><head></head><body><p>VISIBLEMARKER</p></body></html>';

    const renderThenExtract = async (options?: Record<string, unknown>): Promise<string> => {
      const pdfRes = await request(app)
        .post('/convert/html-to-pdf?format=base64')
        .send(options ? { html, options } : { html });
      expect(pdfRes.status).toBe(200);

      const mdRes = await request(app)
        .post('/convert/pdf-to-markdown')
        .set('content-type', 'application/pdf')
        .send(Buffer.from(pdfRes.body.pdfBase64, 'base64'));
      expect(mdRes.status).toBe(200);
      return mdRes.body.markdown;
    };

    expect(await renderThenExtract(), 'control: the text renders').toContain('VISIBLEMARKER');
    expect(
      await renderThenExtract({ css: 'p{display:none}' }),
      'the caller css hid it, so the stylesheet was applied',
    ).not.toContain('VISIBLEMARKER');
  });

  /**
   * The documents that defeated every string-level way of placing the <style>.
   * Each contains a `</head>` that is TEXT rather than a tag, or ends in an open
   * tokenizer context that swallows anything appended after it. Applying the CSS
   * to the parsed document instead of the source string makes all of them
   * ordinary — and each failure they used to cause was silent, so they are
   * asserted on the rendered output rather than on the markup.
   */
  it.each([
    ['</head> in a comment', '<head><!-- </head> --></head><body><p>MARKER</p></body>'],
    ['</head> in a title', '<head><title>x </head> y</title></head><body><p>MARKER</p></body>'],
    ['</head> in an attribute', '<head><meta content="a </head> b"></head><body><p>MARKER</p></body>'],
    ['an unclosed textarea', '<body><p>MARKER</p><textarea>trailing'],
    ['an unterminated comment', '<body><p>MARKER</p><!-- trailing'],
  ])('applies the css option to a document with %s', async (_label, html, ctx) => {
    if (!browserOk) (ctx as { skip: () => void }).skip();

    const res = await request(app)
      .post('/convert/html-to-pdf?format=base64')
      .send({ html, options: { css: 'p{display:none}' } });
    expect(res.status).toBe(200);

    const md = await request(app)
      .post('/convert/pdf-to-markdown')
      .set('content-type', 'application/pdf')
      .send(Buffer.from(res.body.pdfBase64, 'base64'));
    expect(md.status).toBe(200);
    expect(md.body.markdown, 'the stylesheet reached the document').not.toContain('MARKER');
  });
});
