import { describe, expect, it } from 'vitest';
import { markdownToHtml } from './markdownToHtml.js';
import { PdfOptionsSchema } from '../types.js';

const opts = () => PdfOptionsSchema.parse({});

describe('markdownToHtml', () => {
  it('produces a complete HTML document', () => {
    const html = markdownToHtml('# Hello\n\nWorld', opts());
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<h1>Hello</h1>');
    expect(html).toContain('<p>World</p>');
    expect(html).toContain('markdown-body');
  });

  it('renders GFM tables', () => {
    const md = '| a | b |\n| - | - |\n| 1 | 2 |';
    const html = markdownToHtml(md, opts());
    expect(html).toContain('<table>');
    expect(html).toContain('<td>1</td>');
  });

  it('highlights fenced code blocks', () => {
    const md = '```js\nconst x = 1;\n```';
    const html = markdownToHtml(md, opts());
    expect(html).toContain('hljs');
    expect(html).toContain('language-js');
  });

  it('uses the title option in <title>', () => {
    const o = PdfOptionsSchema.parse({ title: 'My Report' });
    const html = markdownToHtml('# x', o);
    expect(html).toContain('<title>My Report</title>');
  });

  it('appends caller-supplied css', () => {
    const o = PdfOptionsSchema.parse({ css: '.marker-xyz { color: red; }' });
    const html = markdownToHtml('# x', o);
    expect(html).toContain('.marker-xyz');
  });
});
