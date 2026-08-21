import { z } from 'zod';

/** Shared input limits (kept in one place so every mode enforces the same cap). */
export const MAX_HTML_CHARS = 5_000_000;
export const MAX_TITLE_CHARS = 500;

/** Page geometry options shared by the markdown->PDF endpoint. */
export const PdfOptionsSchema = z
  .object({
    /** Optional document title; rendered into <title> and usable in headers. */
    title: z.string().max(500).optional(),
    /** Paper format passed to Chromium. */
    format: z
      .enum(['A4', 'A3', 'A5', 'Letter', 'Legal', 'Tabloid'])
      .default('A4'),
    landscape: z.boolean().default(false),
    /** Print background colors/images (code-block backgrounds, etc.). */
    printBackground: z.boolean().default(true),
    /** CSS margin strings, e.g. "20mm". */
    margin: z
      .object({
        top: z.string().default('20mm'),
        right: z.string().default('18mm'),
        bottom: z.string().default('20mm'),
        left: z.string().default('18mm'),
      })
      .default({ top: '20mm', right: '18mm', bottom: '20mm', left: '18mm' }),
    /** Extra CSS appended after the default print stylesheet. */
    css: z.string().max(100_000).optional(),
  });

export type PdfOptions = z.infer<typeof PdfOptionsSchema>;

export const MarkdownToPdfSchema = z.object({
  markdown: z.string().min(1, 'markdown must not be empty').max(5_000_000),
  options: PdfOptionsSchema.optional(),
});

export type MarkdownToPdfRequest = z.infer<typeof MarkdownToPdfSchema>;

/**
 * JSON body shape for html->pdf (alternative to a raw text/html body).
 *
 * The caller's HTML is rendered verbatim — usually a complete document, though
 * a bare fragment works too, since Chromium supplies the missing structure.
 * Nothing is wrapped and nothing is restyled. This is the direction to use when
 * the output is a *layout* rather than prose (a certificate, an invoice, a
 * report cover), where routing through Markdown would mean fighting the
 * converter over what it escapes, wraps or reflows.
 *
 * Shares `PdfOptionsSchema` with markdown-to-pdf so page geometry behaves
 * identically. `css` is appended to the caller's own styles rather than
 * replacing them; `title` sets the download filename only, since the document
 * already carries its own `<title>`.
 */
export const HtmlToPdfSchema = z.object({
  html: z.string().min(1, 'html must not be empty').max(MAX_HTML_CHARS),
  options: PdfOptionsSchema.optional(),
});

export type HtmlToPdfRequest = z.infer<typeof HtmlToPdfSchema>;

/**
 * Options for markdown->HTML. A subset of PdfOptions — only the two fields that
 * affect the HTML document itself apply; page geometry (format/margin/...) is
 * PDF-only. `PdfOptions` is structurally assignable to this, so the shared
 * `markdownToHtml()` renderer accepts either.
 */
export const HtmlOptionsSchema = z.object({
  /** Optional document title; rendered into <title>. */
  title: z.string().max(500).optional(),
  /** Extra CSS appended after the default stylesheet. */
  css: z.string().max(100_000).optional(),
});

export type HtmlOptions = z.infer<typeof HtmlOptionsSchema>;

export const MarkdownToHtmlSchema = z.object({
  markdown: z.string().min(1, 'markdown must not be empty').max(5_000_000),
  options: HtmlOptionsSchema.optional(),
});

export type MarkdownToHtmlRequest = z.infer<typeof MarkdownToHtmlSchema>;

/** JSON body shape for pdf->markdown (alternative to a raw application/pdf body). */
export const PdfToMarkdownSchema = z.object({
  pdfBase64: z.string().min(1),
});

export type PdfToMarkdownRequest = z.infer<typeof PdfToMarkdownSchema>;

export interface PdfToMarkdownResult {
  markdown: string;
  pageCount: number;
  /** Best-effort metadata pulled from the PDF, when present. */
  info: {
    title?: string;
    author?: string;
  };
}

/** JSON body shape for html->markdown (alternative to a raw text/html body). */
export const HtmlToMarkdownSchema = z.object({
  html: z.string().min(1, 'html must not be empty').max(MAX_HTML_CHARS),
  options: z
    .object({
      /** Overrides the title otherwise sniffed from the document's <title>. */
      title: z.string().max(MAX_TITLE_CHARS).optional(),
    })
    .optional(),
});

export type HtmlToMarkdownRequest = z.infer<typeof HtmlToMarkdownSchema>;

export interface HtmlToMarkdownResult {
  markdown: string;
  /** Best-effort title, from the request options or the document's <title>. */
  title?: string;
}
