import { Router, type Request, type Response, type NextFunction } from 'express';
import { config } from '../config.js';
import { requireAuth } from '../middleware/auth.js';
import { HttpError } from '../middleware/error.js';
import {
  MarkdownToPdfSchema,
  PdfToMarkdownSchema,
  PdfOptionsSchema,
  HtmlToMarkdownSchema,
  MarkdownToHtmlSchema,
} from '../types.js';
import { markdownToHtml } from '../lib/markdownToHtml.js';
import { htmlToPdf } from '../lib/htmlToPdf.js';
import { pdfToMarkdown } from '../lib/pdfToMarkdown.js';
import { htmlToMarkdown } from '../lib/htmlToMarkdown.js';
import { logger } from '../logger.js';

export const convertRouter = Router();

convertRouter.use(requireAuth);

/**
 * POST /convert/markdown-to-pdf
 * Body: { markdown: string, options?: PdfOptions }
 * Returns: application/pdf bytes by default, or { pdfBase64, ... } when the
 * client sends `Accept: application/json` or `?format=base64`.
 */
convertRouter.post(
  '/markdown-to-pdf',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { markdown, options } = MarkdownToPdfSchema.parse(req.body);
      const opts = PdfOptionsSchema.parse(options ?? {});

      const html = markdownToHtml(markdown, opts);
      const pdf = await htmlToPdf(html, opts);

      const wantsJson =
        req.query.format === 'base64' || req.accepts(['application/pdf', 'application/json']) === 'application/json';

      logger.info('markdown-to-pdf', { bytes: pdf.length, format: opts.format, json: wantsJson });

      if (wantsJson) {
        res.json({ pdfBase64: pdf.toString('base64'), bytes: pdf.length });
        return;
      }

      res
        .status(200)
        .setHeader('Content-Type', 'application/pdf')
        .setHeader('Content-Length', pdf.length)
        .setHeader('Content-Disposition', `inline; filename="${(opts.title || 'document').replace(/[^\w.-]/g, '_')}.pdf"`)
        .send(pdf);
    } catch (err) {
      next(err);
    }
  },
);

/**
 * POST /convert/markdown-to-html
 * Body: { markdown: string, options?: { title, css } }
 * Returns: a complete, self-contained text/html document by default, or
 * { html, bytes } when the client sends `Accept: application/json` /
 * `?format=json` (the shape hadron-server's `nodeExport` HTML path consumes).
 */
convertRouter.post(
  '/markdown-to-html',
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const { markdown, options } = MarkdownToHtmlSchema.parse(req.body);
      const html = markdownToHtml(markdown, options);
      const bytes = Buffer.byteLength(html);

      const wantsJson =
        req.query.format === 'json' || req.accepts(['text/html', 'application/json']) === 'application/json';

      logger.info('markdown-to-html', { bytes, json: wantsJson });

      if (wantsJson) {
        res.json({ html, bytes });
        return;
      }

      res
        .status(200)
        .setHeader('Content-Type', 'text/html; charset=utf-8')
        .send(html);
    } catch (err) {
      next(err);
    }
  },
);

/**
 * POST /convert/pdf-to-markdown
 * Body: a raw application/pdf payload, OR JSON { pdfBase64: string }.
 * Returns: { markdown, pageCount, info }.
 */
convertRouter.post(
  '/pdf-to-markdown',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      let pdf: Buffer;
      const contentType = req.get('content-type') ?? '';

      if (contentType.includes('application/pdf')) {
        if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
          throw new HttpError(400, 'empty application/pdf body');
        }
        pdf = req.body;
      } else {
        const { pdfBase64 } = PdfToMarkdownSchema.parse(req.body);
        pdf = Buffer.from(pdfBase64, 'base64');
        if (pdf.length === 0) throw new HttpError(400, 'pdfBase64 decoded to empty buffer');
      }

      if (pdf.subarray(0, 5).toString('latin1') !== '%PDF-') {
        throw new HttpError(400, 'payload is not a PDF (missing %PDF- header)');
      }

      const result = await pdfToMarkdown(pdf);
      logger.info('pdf-to-markdown', { pages: result.pageCount, chars: result.markdown.length });
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

/**
 * POST /convert/html-to-markdown
 * Body: a raw text/html payload, OR JSON { html: string, options?: { title } }.
 * Returns: { markdown, title? }. Intended for content HTML (e.g. a web page's
 * main article, extracted client-side) being imported into a node.
 */
convertRouter.post(
  '/html-to-markdown',
  (req: Request, res: Response, next: NextFunction) => {
    try {
      let html: string;
      let title: string | undefined;
      const contentType = req.get('content-type') ?? '';

      if (contentType.includes('text/html')) {
        if (typeof req.body !== 'string' || req.body.length === 0) {
          throw new HttpError(400, 'empty text/html body');
        }
        html = req.body;
      } else {
        const parsed = HtmlToMarkdownSchema.parse(req.body);
        html = parsed.html;
        title = parsed.options?.title;
      }

      const result = htmlToMarkdown(html, { title });
      logger.info('html-to-markdown', { chars: result.markdown.length });
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

// Surfaces config to callers/operators without exposing secrets.
convertRouter.get('/info', (_req, res) => {
  res.json({
    service: 'hadrontool-pdf',
    directions: ['markdown-to-pdf', 'markdown-to-html', 'pdf-to-markdown', 'html-to-markdown'],
    allowRemote: config.allowRemote,
    authRequired: Boolean(config.serviceToken),
  });
});
