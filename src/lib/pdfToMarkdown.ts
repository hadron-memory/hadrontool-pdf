import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { TextItem } from 'pdfjs-dist/types/src/display/api.js';
import type { PdfToMarkdownResult } from '../types.js';

/**
 * Extract Markdown from a PDF's text layer (v1: text extraction, not full
 * layout reconstruction). Approach: pull positioned text items per page, group
 * them into lines by their baseline Y, then into paragraphs by vertical gaps.
 * Lines whose font height is markedly larger than the page median are promoted
 * to Markdown headings. Scanned/image-only PDFs (no text layer) yield no text —
 * OCR is out of scope for v1.
 */

interface PositionedLine {
  text: string;
  /** baseline y (PDF coords, larger = higher on the page) */
  y: number;
  /** representative glyph height for the line */
  height: number;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function buildLines(items: TextItem[]): PositionedLine[] {
  const lines: PositionedLine[] = [];
  // Y-tolerance: items within this many points share a line.
  const Y_TOLERANCE = 3;

  for (const item of items) {
    const text = item.str;
    if (!text) continue;
    const y = item.transform[5] as number;
    const height = Math.abs(item.transform[3] as number) || item.height || 0;

    const existing = lines.find((l) => Math.abs(l.y - y) <= Y_TOLERANCE);
    if (existing) {
      existing.text += text;
      existing.height = Math.max(existing.height, height);
    } else {
      lines.push({ text, y, height });
    }
    if (item.hasEOL) {
      // hard line break inside the same text run — start a new line below
      lines.push({ text: '', y: y - (height || 1), height });
    }
  }

  return lines
    .map((l) => ({ ...l, text: l.text.replace(/\s+/g, ' ').trim() }))
    .filter((l) => l.text.length > 0)
    .sort((a, b) => b.y - a.y);
}

function linesToMarkdown(lines: PositionedLine[]): string {
  if (lines.length === 0) return '';
  const medianHeight = median(lines.map((l) => l.height).filter((h) => h > 0));
  const out: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const prev = lines[i - 1];

    // Heading heuristic: a comfortably larger line than the body median.
    let prefix = '';
    if (medianHeight > 0 && line.height >= medianHeight * 1.7) {
      prefix = '# ';
    } else if (medianHeight > 0 && line.height >= medianHeight * 1.3) {
      prefix = '## ';
    }

    // Paragraph break when there's a vertical gap larger than ~1.6 lines.
    if (prev) {
      const gap = prev.y - line.y;
      const threshold = (line.height || medianHeight || 12) * 1.6;
      if (gap > threshold || prefix || out[out.length - 1]?.startsWith('#')) {
        out.push('');
      }
    }

    out.push(prefix + line.text);
  }

  return out
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export async function pdfToMarkdown(data: Buffer): Promise<PdfToMarkdownResult> {
  const doc = await getDocument({
    data: new Uint8Array(data),
    // Node-friendly flags: no eval, no worker fetch.
    isEvalSupported: false,
    useSystemFonts: true,
  }).promise;

  const pageMarkdowns: string[] = [];
  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    const page = await doc.getPage(pageNum);
    const content = await page.getTextContent();
    const items = content.items.filter((i): i is TextItem => 'str' in i);
    const lines = buildLines(items);
    const md = linesToMarkdown(lines);
    if (md) pageMarkdowns.push(md);
    page.cleanup();
  }

  let info: PdfToMarkdownResult['info'] = {};
  try {
    const meta = await doc.getMetadata();
    const m = meta.info as { Title?: string; Author?: string } | undefined;
    info = {
      title: m?.Title || undefined,
      author: m?.Author || undefined,
    };
  } catch {
    // metadata is best-effort
  }

  const pageCount = doc.numPages;
  await doc.destroy();

  return {
    // Separate pages with a horizontal rule so page boundaries survive.
    markdown: pageMarkdowns.join('\n\n---\n\n'),
    pageCount,
    info,
  };
}
