import { describe, expect, it } from 'vitest';
import { injectExtraCss } from './htmlToPdf.js';

describe('injectExtraCss', () => {
  it('returns the document untouched when no css is given', () => {
    const html = '<!DOCTYPE html><html><head></head><body>hi</body></html>';
    expect(injectExtraCss(html)).toBe(html);
    expect(injectExtraCss(html, '')).toBe(html);
  });

  it("appends LAST in <head> so it overrides the document's own styles", () => {
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

  it('is case-insensitive about </HEAD>, and preserves the caller casing', () => {
    const out = injectExtraCss('<HTML><HEAD></HEAD><BODY></BODY></HTML>', 'p{margin:0}');
    expect(out).toContain('<style>\np{margin:0}\n</style>\n</HEAD>');
    // The caller's tag must come back exactly as written, not lowercased.
    expect(out).not.toContain('</head>');
  });

  // A late doctype puts Chromium in quirks mode, which changes the box model —
  // on an endpoint whose whole purpose is rendering a layout the caller has
  // already positioned. The document below is standards-compliant: <head> and
  // <body> are both optional tags.
  it('inserts AFTER a leading doctype when there is no head or body', () => {
    const html = '<!DOCTYPE html><title>Invoice</title><main>total</main>';
    const out = injectExtraCss(html, 'main{margin:0}');

    expect(out.toLowerCase().indexOf('<!doctype html>')).toBe(0);
    expect(out.indexOf('<style>')).toBeGreaterThan(out.toLowerCase().indexOf('<!doctype html>'));
    expect(out).toContain('<main>total</main>');
  });

  it('still prepends when there is no doctype, head or body', () => {
    const out = injectExtraCss('<p>fragment</p>', 'p{margin:0}');
    expect(out.startsWith('<style>')).toBe(true);
  });

  // Silent failure: inserting into the comment would drop the stylesheet with
  // no error and a 200 response.
  it('ignores a </head> that appears inside a comment', () => {
    const html = '<html><head><!-- example: </head> --><title>t</title></head><body>b</body></html>';
    const out = injectExtraCss(html, 'p{margin:0}');

    // The style block lands before the REAL closing tag, after the title.
    expect(out).toContain('<title>t</title><style>\np{margin:0}\n</style>\n</head>');
    // And the comment is left exactly as the caller wrote it.
    expect(out).toContain('<!-- example: </head> -->');
  });

  it('ignores a </head> that appears inside a script', () => {
    const html = '<html><head><script>var s = "</head>";</script></head><body>b</body></html>';
    const out = injectExtraCss(html, 'p{margin:0}');
    expect(out).toContain('</script><style>\np{margin:0}\n</style>\n</head>');
  });

  // <title> is RCDATA: its content is text until its own closing tag, so the
  // document below is valid and its FIRST </head> is not the head boundary.
  it('ignores a </head> that appears inside a <title>', () => {
    const html = '<html><head><title>Example </head> text</title></head><body>b</body></html>';
    const out = injectExtraCss(html, 'p{margin:0}');

    expect(out).toContain('<title>Example </head> text</title><style>\np{margin:0}\n</style>\n</head>');
    // The title must come back exactly as written.
    expect(out).toContain('<title>Example </head> text</title>');
  });

  it('ignores a </head> that appears inside a <textarea>', () => {
    const html = '<html><head></head><body><textarea></head></textarea></body></html>';
    const out = injectExtraCss(html, 'p{margin:0}');
    // The real (and only genuine) </head> comes first, so it wins regardless —
    // what this pins is that the textarea text is not treated as a tag.
    expect(out).toContain('<style>\np{margin:0}\n</style>\n</head>');
    expect(out).toContain('<textarea></head></textarea>');
  });

  // Comments are legal before the doctype. Inserting ahead of them makes the
  // doctype late, which is quirks mode again by a different route.
  it('inserts after a doctype that is preceded by comments', () => {
    const html = '<!-- license --><!DOCTYPE html><title>Invoice</title><main>total</main>';
    const out = injectExtraCss(html, 'main{margin:0}');

    expect(out.startsWith('<!-- license --><!DOCTYPE html>')).toBe(true);
    expect(out.indexOf('<style>')).toBeGreaterThan(out.toLowerCase().indexOf('<!doctype html>'));
  });

  it('ignores a <body> that appears inside a comment when falling back', () => {
    const html = '<!-- <body> --><body class="real">hi</body>';
    const out = injectExtraCss(html, 'p{margin:0}');
    expect(out).toContain('<body class="real">\n<style>');
  });
});
