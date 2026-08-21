import type { HTTPRequest } from 'puppeteer';
import { getBrowser } from './browser.js';
import { config } from '../config.js';
import type { PdfOptions } from '../types.js';

/**
 * Blanks out regions whose text must not be treated as markup — comments and
 * the raw-text content of `<script>`/`<style>` — replacing them with spaces so
 * every offset still lines up with the original string.
 *
 * Searching the mask and splicing the ORIGINAL is what stops
 * `<head><!-- </head> --></head>` from having its stylesheet inserted inside
 * the comment, where it would be silently ignored.
 */
function maskInertRegions(html: string): string {
  const blank = (match: string): string => ' '.repeat(match.length);
  return html
    .replace(/<!--[\s\S]*?-->/g, blank)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, blank)
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, blank);
}

/**
 * Append caller-supplied CSS to an HTML string, last in `<head>` so it
 * overrides the document's own styles — the same meaning `css` has on the
 * Markdown path, where it is appended after the default stylesheet.
 *
 * Accepts a complete document or a bare fragment. Falls back to the top of
 * `<body>`, then to the front of the string, so a headless document or a
 * fragment still gets the styles rather than silently dropping them.
 *
 * Three things that are easy to get wrong here, all of which fail SILENTLY:
 *
 * 1. The insertion point is found in a MASKED copy (see above), so a `</head>`
 *    appearing inside a comment or a script string is not mistaken for the
 *    real one.
 * 2. When there is neither `<head>` nor `<body>`, the block goes AFTER any
 *    leading doctype. Putting it before makes the doctype late, which drops
 *    Chromium into quirks mode and changes the box model under a layout the
 *    caller has already positioned.
 * 3. Insertion is by SLICING, not `String.replace`. A `$&` or `$1` in caller
 *    CSS would be read as a replacement pattern and corrupt the stylesheet,
 *    and re-emitting a literal `</head>` would rewrite a caller's `</HEAD>` to
 *    lowercase — an edit to a document this endpoint renders verbatim.
 *
 * The `</style>` neutralization mirrors `markdownToHtml`: without it, CSS
 * carrying a close tag would end the `<style>` element and inject arbitrary
 * markup into the rendered document.
 */
export function injectExtraCss(html: string, css?: string): string {
  if (!css) return html;

  const safe = css.replace(/<\/style/gi, '<\\/style');
  const block = `<style>\n${safe}\n</style>`;
  const mask = maskInertRegions(html);

  const headClose = mask.search(/<\/head\s*>/i);
  if (headClose !== -1) {
    return `${html.slice(0, headClose)}${block}\n${html.slice(headClose)}`;
  }

  const bodyOpen = /<body\b[^>]*>/i.exec(mask);
  if (bodyOpen) {
    const at = bodyOpen.index + bodyOpen[0].length;
    return `${html.slice(0, at)}\n${block}${html.slice(at)}`;
  }

  const doctype = /^\s*<!doctype\b[^>]*>/i.exec(html);
  const at = doctype ? doctype[0].length : 0;
  return at > 0
    ? `${html.slice(0, at)}\n${block}${html.slice(at)}`
    : `${block}\n${html}`;
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
