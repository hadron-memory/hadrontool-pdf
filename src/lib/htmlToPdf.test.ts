import { describe, expect, it } from 'vitest';
import { injectExtraCss } from './htmlToPdf.js';

describe('injectExtraCss', () => {
  it('returns the document untouched when no css is given', () => {
    const html = '<!DOCTYPE html><html><head></head><body>hi</body></html>';
    expect(injectExtraCss(html)).toBe(html);
    expect(injectExtraCss(html, '')).toBe(html);
  });

  it('appends LAST in <head> so it overrides the document own styles', () => {
    const html = '<html><head><style>body{color:red}</style></head><body>hi</body></html>';
    const out = injectExtraCss(html, 'body{color:blue}');

    expect(out).toContain('<style>\nbody{color:blue}\n</style>\n</head>');
    // Order is the point: the caller's rule must come after the document's.
    expect(out.indexOf('color:blue')).toBeGreaterThan(out.indexOf('color:red'));
  });

  it('falls back to the top of <body> when there is no </head>', () => {
    const out = injectExtraCss('<body class="x">hi</body>', 'p{margin:0}');
    expect(out).toContain('<body class="x">\n<style>');
    expect(out).toContain('p{margin:0}');
  });

  it('falls back to prepending when the document has neither', () => {
    const out = injectExtraCss('<p>fragment</p>', 'p{margin:0}');
    expect(out.startsWith('<style>')).toBe(true);
    expect(out).toContain('<p>fragment</p>');
  });

  it('neutralizes a </style> breakout in caller css', () => {
    const out = injectExtraCss(
      '<html><head></head><body></body></html>',
      '</style><script>alert(1)</script>',
    );
    // The injected close tag must not end the real <style> element.
    expect(out).not.toContain('</style><script>');
    expect(out).toContain('<\\/style');
  });

  it('does not interpret $ patterns in caller css as replacement patterns', () => {
    // `$&` in a string replacement expands to the whole match, which would
    // silently corrupt the stylesheet. The implementation uses a function
    // replacement precisely to avoid this.
    const css = 'p::after{content:"$& $1 $`"}';
    const out = injectExtraCss('<html><head></head><body></body></html>', css);
    expect(out).toContain('content:"$& $1 $`"');
  });

  it('is case-insensitive about </HEAD>', () => {
    const out = injectExtraCss('<HTML><HEAD></HEAD><BODY></BODY></HTML>', 'p{margin:0}');
    expect(out).toContain('<style>\np{margin:0}\n</style>\n</HEAD>');
  });
});
