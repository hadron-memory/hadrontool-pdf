import { Marked } from 'marked';
import { markedHighlight } from 'marked-highlight';
import hljs from 'highlight.js';
import type { PdfOptions } from '../types.js';

/**
 * A fresh Marked instance with syntax highlighting. We construct one per call is
 * unnecessary; a single configured instance is safe to reuse across requests
 * because rendering is synchronous and stateless.
 */
const marked = new Marked(
  markedHighlight({
    langPrefix: 'hljs language-',
    highlight(code, lang) {
      const language = lang && hljs.getLanguage(lang) ? lang : 'plaintext';
      try {
        return hljs.highlight(code, { language }).value;
      } catch {
        return code;
      }
    },
  }),
);

marked.setOptions({ gfm: true, breaks: false });

/**
 * Default print stylesheet. Kept compact and self-contained (no external font
 * or CSS fetches) so the renderer can run fully offline. A condensed
 * GitHub-flavored highlight.js theme is inlined so code blocks keep their
 * colors in the PDF without a network request.
 */
const BASE_CSS = `
  :root { color-scheme: light; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    font-size: 11pt;
    line-height: 1.55;
    color: #1f2328;
    margin: 0;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  h1, h2, h3, h4, h5, h6 { font-weight: 600; line-height: 1.25; margin: 1.4em 0 0.6em; }
  h1 { font-size: 1.9em; border-bottom: 1px solid #d8dee4; padding-bottom: 0.3em; }
  h2 { font-size: 1.5em; border-bottom: 1px solid #d8dee4; padding-bottom: 0.3em; }
  h3 { font-size: 1.25em; }
  p, ul, ol, blockquote, table, pre { margin: 0 0 0.9em; }
  a { color: #0969da; text-decoration: none; }
  code { font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace; font-size: 0.88em; }
  :not(pre) > code {
    background: #eff1f3; padding: 0.15em 0.35em; border-radius: 4px;
  }
  pre {
    background: #f6f8fa; border: 1px solid #d8dee4; border-radius: 6px;
    padding: 12px 14px; overflow: auto; white-space: pre-wrap; word-wrap: break-word;
  }
  pre code { background: none; padding: 0; }
  blockquote {
    color: #59636e; border-left: 0.25em solid #d1d9e0; padding: 0 1em; margin-left: 0;
  }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #d1d9e0; padding: 6px 12px; text-align: left; }
  th { background: #f6f8fa; font-weight: 600; }
  tr:nth-child(2n) td { background: #f6f8fa; }
  img { max-width: 100%; }
  hr { border: none; border-top: 1px solid #d8dee4; margin: 1.5em 0; }
  /* page-break helpers */
  h1, h2, h3 { break-after: avoid; }
  pre, blockquote, table, img { break-inside: avoid; }

  /* condensed highlight.js github theme */
  .hljs { color: #1f2328; background: #f6f8fa; }
  .hljs-comment, .hljs-quote { color: #59636e; }
  .hljs-keyword, .hljs-selector-tag, .hljs-built_in, .hljs-name, .hljs-tag { color: #cf222e; }
  .hljs-string, .hljs-title, .hljs-section, .hljs-attribute, .hljs-literal, .hljs-template-tag,
  .hljs-template-variable, .hljs-type, .hljs-addition { color: #0a3069; }
  .hljs-number, .hljs-symbol, .hljs-bullet, .hljs-link, .hljs-meta, .hljs-selector-id,
  .hljs-title.class_, .hljs-class .hljs-title { color: #0550ae; }
  .hljs-variable, .hljs-params { color: #953800; }
  .hljs-function .hljs-title, .hljs-title.function_ { color: #6639ba; }
  .hljs-emphasis { font-style: italic; }
  .hljs-strong { font-weight: 600; }
  .hljs-deletion { color: #82071e; background: #ffebe9; }
`;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Render Markdown to a complete, self-contained HTML document ready for
 * Chromium's print path. The Markdown body is parsed by `marked` (GFM); the
 * resulting fragment is wrapped with the inline print stylesheet.
 *
 * Note on safety: the output is consumed only by the headless renderer (which
 * runs with remote fetches disabled by default and scripts disabled), not
 * served to a browser, so embedded HTML in the Markdown is rendered as-is by
 * design — the trust boundary is the caller, enforced by the bearer token.
 */
export function markdownToHtml(markdown: string, options?: PdfOptions): string {
  const bodyHtml = marked.parse(markdown, { async: false }) as string;
  const title = options?.title ? escapeHtml(options.title) : 'Document';
  const extraCss = options?.css ?? '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${title}</title>
<style>${BASE_CSS}\n${extraCss}</style>
</head>
<body>
<article class="markdown-body">
${bodyHtml}
</article>
</body>
</html>`;
}
