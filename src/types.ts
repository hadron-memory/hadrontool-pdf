import { z } from 'zod';

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
