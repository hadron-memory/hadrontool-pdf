import type { HTTPRequest } from 'puppeteer';
import { getBrowser } from './browser.js';
import { config } from '../config.js';
import type { PdfOptions } from '../types.js';

/**
 * Append caller-supplied CSS to an HTML string, so it overrides the document's
 * own styles — the same meaning `css` has on the Markdown path, where it is
 * appended after the default stylesheet.
 *
 * ## The block goes at the END, and that is the design rather than a fallback
 *
 * The obvious placement is last inside `<head>`, and it is a trap. Finding that
 * boundary means finding a `</head>` that is really a tag, and HTML has several
 * ways to write one that is not: inside a comment, inside raw text
 * (`<script>`, `<style>`), inside RCDATA (`<title>`, `<textarea>`), and inside a
 * quoted attribute value (`<meta content="… </head> …">`). Getting it wrong
 * inserts the stylesheet somewhere it is parsed as TEXT, so `options.css` is
 * dropped with a 200 and no error. Review found one variant per round; there is
 * no reason to think the list was finished.
 *
 * Appending removes the question. A `<style>` element applies to the whole
 * document wherever it appears — Chromium's parser relocates a trailing one —
 * and being last in document order is exactly what makes it win the cascade at
 * equal specificity, which is the semantics `css` is documented to have. So the
 * placement that is trivial to compute is also the one that is correct.
 *
 * Two properties fall out of it, both worth having:
 *
 * - The caller's document is left BYTE-IDENTICAL as a prefix. Nothing is spliced
 *   into the middle of markup this endpoint promises to render verbatim, and no
 *   casing or whitespace is rewritten.
 * - Nothing can precede the doctype, so a late doctype — and the quirks-mode
 *   box model that comes with it — is structurally impossible rather than
 *   guarded against.
 *
 * The `</style>` neutralization mirrors `markdownToHtml`: without it, CSS
 * carrying a close tag would end the `<style>` element and inject arbitrary
 * markup into the rendered document.
 */
export function injectExtraCss(html: string, css?: string): string {
  if (!css) return html;

  const safe = css.replace(/<\/style/gi, '<\\/style');
  return `${html}\n<style>\n${safe}\n</style>`;
}

/**
 * Render an HTML document to PDF bytes using the shared headless browser. Each
 * call gets its own page, which is always closed.
 *
 * Security hardening: JavaScript is disabled (the document is static print
 * content), and unless PDF_ALLOW_REMOTE is set, every non-inline request is
 * aborted — only `data:` and the initial `about:blank`/document load proceed.
 * That blocks `file://` reads and remote (SSRF) fetches via crafted Markdown.
 */
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
