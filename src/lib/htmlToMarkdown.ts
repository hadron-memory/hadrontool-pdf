import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import sanitizeHtml from 'sanitize-html';
import type { HtmlToMarkdownResult } from '../types.js';

/**
 * The structural tags we keep before converting to Markdown. Anything not in
 * this list is dropped (its text is preserved by sanitize-html unless it is a
 * `nonTextTags` member below). Presentational wrappers (span/div) are kept so
 * their inline content survives, but their attributes are stripped.
 */
const ALLOWED_TAGS = [
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'p', 'a', 'ul', 'ol', 'li', 'blockquote',
  'pre', 'code', 'em', 'strong', 'b', 'i', 'del', 's', 'ins', 'sub', 'sup',
  'hr', 'br', 'img', 'figure', 'figcaption',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption',
  'span', 'div',
];

// A single reusable converter — turndown holds no per-call state, mirroring the
// shared `marked` instance in markdownToHtml.ts.
const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
  emDelimiter: '_',
  linkStyle: 'inlined',
});
turndown.use(gfm); // GFM tables, strikethrough, task lists

function extractTitle(html: string): string | undefined {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title = m?.[1]?.replace(/\s+/g, ' ').trim();
  return title || undefined;
}

// Spec: cor:cnv:010:01 (HTML→Markdown import)
/**
 * Convert HTML to Markdown for node import — e.g. a web page's main article,
 * already extracted client-side (reader mode) by the caller, not a raw full
 * page. The HTML is sanitized first: scripts, styles, event handlers, and
 * non-http(s) URLs are removed so nothing executable survives into the Markdown
 * (which may later be re-rendered or exported to PDF). Conversion is lossy by
 * design — complex layout and some table structure will not round-trip.
 */
export function htmlToMarkdown(html: string, options?: { title?: string }): HtmlToMarkdownResult {
  const clean = sanitizeHtml(html, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: {
      a: ['href', 'title'],
      img: ['src', 'alt', 'title'],
    },
    // Drop javascript:, file:, and other schemes; keep only safe link targets.
    allowedSchemes: ['http', 'https', 'mailto'],
    // Remove these tags *and their contents* entirely (not just the wrapper).
    nonTextTags: ['script', 'style', 'noscript', 'textarea'],
  });

  const markdown = turndown
    .turndown(clean)
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const title = options?.title?.trim() || extractTitle(html);

  return { markdown, ...(title ? { title } : {}) };
}
