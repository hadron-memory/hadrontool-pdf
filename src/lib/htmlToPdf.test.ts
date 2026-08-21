import { describe, expect, it } from 'vitest';
import { injectExtraCss } from './htmlToPdf.js';

describe('injectExtraCss', () => {
  it('returns the document untouched when no css is given', () => {
    const html = '<!DOCTYPE html><html><head></head><body>hi</body></html>';
    expect(injectExtraCss(html)).toBe(html);
    expect(injectExtraCss(html, '')).toBe(html);
  });

  it('appends AFTER the document so it wins the cascade', () => {
    const html = '<html><head><style>body{color:red}</style></head><body>hi</body></html>';
    const out = injectExtraCss(html, 'body{color:blue}');

    expect(out.indexOf('color:blue')).toBeGreaterThan(out.indexOf('color:red'));
    expect(out.endsWith('<style>\nbody{color:blue}\n</style>')).toBe(true);
  });

  /**
   * The property that replaced a pile of insertion-point special cases. Each
   * document below contains a `</head>` or `<body>` that is TEXT, not a tag —
   * a comment, RCDATA, raw text, a quoted attribute. An implementation that
   * searches for a boundary has to get every one of them right; one that
   * appends cannot get any of them wrong.
   */
  it.each([
    ['complete document', '<!DOCTYPE html><html><head></head><body>b</body></html>'],
    ['uppercase tags', '<HTML><HEAD></HEAD><BODY></BODY></HTML>'],
    ['bare fragment', '<p>fragment</p>'],
    ['no head or body', '<!DOCTYPE html><title>Invoice</title><main>total</main>'],
    ['comment before the doctype', '<!-- license --><!DOCTYPE html><title>x</title>'],
    ['</head> inside a comment', '<head><!-- </head> --><title>t</title></head><body>b</body>'],
    ['</head> inside a title', '<head><title>Example </head> text</title></head><body>b</body>'],
    ['</head> inside a script', '<head><script>var s = "</head>";</script></head><body>b</body>'],
    ['</head> inside an attribute', '<head><meta content="example </head> text"></head><body>b</body>'],
    ['<body> inside a comment', '<!-- <body> --><body class="real">hi</body>'],
  ])('leaves %s byte-identical as a prefix', (_label, html) => {
    const out = injectExtraCss(html, 'p{margin:0}');
    expect(out.startsWith(html)).toBe(true);
    expect(out.slice(html.length)).toBe('\n<style>\np{margin:0}\n</style>');
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
    // Structurally impossible now that this is a template append rather than a
    // String.replace, but worth pinning: `$&` silently expanding to the whole
    // match would corrupt the stylesheet with no error.
    const css = 'p::after{content:"$& $1 $`"}';
    const out = injectExtraCss('<html><head></head><body></body></html>', css);
    expect(out).toContain('content:"$& $1 $`"');
  });
});
