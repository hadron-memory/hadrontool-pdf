import type { HTTPRequest } from 'puppeteer';
import { getBrowser } from './browser.js';
import { config } from '../config.js';
import type { PdfOptions } from '../types.js';

/**
 * Render an HTML document to PDF bytes using the shared headless browser. Each
 * call gets its own page, which is always closed.
 *
 * Security hardening: JavaScript is disabled (the document is static print
 * content), and unless PDF_ALLOW_REMOTE is set, every non-inline request is
 * aborted — only `data:` and the initial `about:blank`/document load proceed.
 * That blocks `file://` reads and remote (SSRF) fetches via crafted Markdown.
 *
 * `extraCss` is applied to the PARSED DOCUMENT, after `setContent`, never by
 * concatenating it to the source string. The Markdown path does not use it —
 * `markdownToHtml` bakes `options.css` into the document it builds — so it is
 * only the HTML path, where the source is the caller's and cannot be edited
 * safely, that passes it.
 *
 * Why it has to be the DOM. Deciding where a `<style>` belongs in someone
 * else's markup means knowing the tokenizer's state, and every string-level
 * answer has a document that defeats it: a `</head>` that is really text
 * (inside a comment, raw text, RCDATA, or a quoted attribute value) sends the
 * block somewhere it is parsed as content, and appending at the end is
 * swallowed whole by a document ending in an open context (`<textarea>text`,
 * `<!-- comment`). Every one of those failures is SILENT — a 200, a well-formed
 * PDF, and no styles applied. Adding a node to the parsed document skips the
 * question: the browser has already resolved the markup, and the node lands in
 * `<head>` after the document's own styles, which is the cascade position
 * `css` is documented to have.
 *
 * It also retires the `</style>` neutralization that the string form needed:
 * DOM text content cannot close an element, so caller CSS containing `</style>`
 * is now just CSS.
 */
export async function htmlToPdf(
  html: string,
  options: PdfOptions,
  extraCss?: string,
): Promise<Buffer> {
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

    // A caller document carrying its own Content-Security-Policy would
    // otherwise block the style node added below, and block it SILENTLY — the
    // injection call still succeeds and the PDF comes back unstyled. Safe here
    // because the two things CSP would be protecting against are already gone:
    // page scripts are disabled, and every non-`data:` request is aborted
    // regardless of what any policy permits.
    await page.setBypassCSP(true);

    await page.setContent(html, { waitUntil: 'load', timeout: 30_000 });

    // Applied to the PARSED document, after setContent, so there is no
    // tokenizer state left to guess at.
    //
    // Appended to the END of the body rather than to <head>: a caller may carry
    // a <style> or a stylesheet link in the body, which is later in document
    // order than <head> and would therefore win at equal specificity. `css` is
    // documented to come after ALL the caller's styles, so it has to be last in
    // the document, not merely present.
    //
    // This works despite setJavaScriptEnabled(false): that disables scripts
    // belonging to the PAGE, while this runs over the DevTools protocol, which
    // is not page script. Pinned by end-to-end tests rather than trusted — a
    // silent failure here looks exactly like success.
    if (extraCss) {
      await page.evaluate((cssText: string) => {
        const style = document.createElement('style');
        style.textContent = cssText;
        (document.body ?? document.documentElement).appendChild(style);
      }, extraCss);
    }

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
