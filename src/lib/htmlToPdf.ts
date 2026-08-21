import type { HTTPRequest } from 'puppeteer';
import { getBrowser } from './browser.js';
import { config } from '../config.js';
import type { PdfOptions } from '../types.js';

/**
 * Render a complete HTML document to PDF bytes using the shared headless
 * browser. Each call gets its own page, which is always closed.
 *
 * Security hardening: JavaScript is disabled (the document is static print
 * content), and unless PDF_ALLOW_REMOTE is set, every non-inline request is
 * aborted — only `data:` and the initial `about:blank`/document load proceed.
 * That blocks `file://` reads and remote (SSRF) fetches via crafted Markdown.
 */
/**
 * Append caller-supplied CSS to a COMPLETE HTML document, last in `<head>` so
 * it overrides the document's own styles — the same meaning `css` has on the
 * Markdown path, where it is appended after the default stylesheet.
 *
 * Falls back to the top of `<body>`, then to the front of the string, so a
 * fragment or a headless document still gets the styles rather than silently
 * dropping them.
 *
 * The `</style>` neutralization mirrors `markdownToHtml`: without it, CSS
 * carrying a close tag would end the `<style>` element and inject arbitrary
 * markup into the rendered document.
 *
 * Replacements are FUNCTIONS, not strings: a `$&` or `$1` inside caller CSS
 * would otherwise be interpreted as a replacement pattern and silently corrupt
 * the stylesheet.
 */
export function injectExtraCss(html: string, css?: string): string {
  if (!css) return html;

  const safe = css.replace(/<\/style/gi, '<\\/style');
  const block = `<style>\n${safe}\n</style>`;

  if (/<\/head>/i.test(html)) {
    // Re-emit the MATCHED text rather than a literal `</head>`: this endpoint
    // renders the caller's document verbatim, and rewriting their `</HEAD>` to
    // lowercase would be a silent edit to it.
    return html.replace(/<\/head>/i, match => `${block}\n${match}`);
  }
  if (/<body[^>]*>/i.test(html)) {
    return html.replace(/<body[^>]*>/i, match => `${match}\n${block}`);
  }
  return `${block}\n${html}`;
}

export async function htmlToPdf(html: string, options: PdfOptions): Promise<Buffer> {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setJavaScriptEnabled(false);
    await page.setRequestInterception(true);

    page.on('request', (req: HTTPRequest) => {
      const url = req.url();
      // The setContent document itself arrives as a data: URL.
      if (url.startsWith('data:') || req.isInterceptResolutionHandled()) {
        if (!req.isInterceptResolutionHandled()) void req.continue();
        return;
      }
      if (config.allowRemote && /^https?:/i.test(url)) {
        void req.continue();
        return;
      }
      // Block file://, ftp://, and (when allowRemote=false) http(s)://.
      void req.abort();
    });

    await page.setContent(html, { waitUntil: 'load', timeout: 30_000 });
    await page.emulateMediaType('print');

    const pdf = await page.pdf({
      format: options.format,
      landscape: options.landscape,
      printBackground: options.printBackground,
      margin: options.margin,
      preferCSSPageSize: false,
    });

    return Buffer.from(pdf);
  } finally {
    await page.close().catch(() => {});
  }
}
