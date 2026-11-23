# hadrontool-pdf

Stateless microservice for the Hadron platform that converts **Markdown → PDF**
and extracts **PDF → Markdown** (text). It holds no database, no keys, and no
access-control logic — `hadron-server` stays the front door (auth, decryption,
node loading) and calls this service over HTTP for the heavy rendering step.

See [docs/architecture.md](docs/architecture.md) for where this sits in the
platform and why the boundary is drawn here.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/convert/markdown-to-pdf` | Render Markdown to a PDF |
| `POST` | `/convert/html-to-pdf` | Render an HTML document to a PDF |
| `POST` | `/convert/markdown-to-html` | Render Markdown to a self-contained HTML document |
| `POST` | `/convert/pdf-to-markdown` | Extract Markdown text from a PDF |
| `POST` | `/convert/html-to-markdown` | Convert content HTML to Markdown |
| `GET` | `/convert/info` | Service capabilities (no secrets) |
| `GET` | `/healthz` | Liveness |
| `GET` | `/readyz` | Readiness (+ whether Chromium is warm) |

All `/convert/*` routes require `Authorization: Bearer $PDF_SERVICE_TOKEN` when
that env var is set. In production the service **refuses to start** without it.

### `POST /convert/markdown-to-pdf`

Request (JSON):

```jsonc
{
  "markdown": "# Title\n\nBody **text**.",
  "options": {
    "title": "My Document",        // optional, used in <title> + filename
    "format": "A4",                // A4 | A3 | A5 | Letter | Legal | Tabloid
    "landscape": false,
    "printBackground": true,
    "margin": { "top": "20mm", "right": "18mm", "bottom": "20mm", "left": "18mm" },
    "css": ".note { color: #b00; }" // optional extra CSS appended after defaults
  }
}
```

Response: `application/pdf` bytes by default. Send `Accept: application/json`
or `?format=base64` to get `{ "pdfBase64": "...", "bytes": 12345 }` instead
(handy for embedding in a GraphQL response).

```bash
curl -sS -X POST http://localhost:8080/convert/markdown-to-pdf \
  -H 'content-type: application/json' \
  -H "authorization: Bearer $PDF_SERVICE_TOKEN" \
  -d '{"markdown":"# Hello\n\nWorld"}' \
  -o out.pdf
```

### `POST /convert/html-to-pdf`

For documents that are a **layout** rather than prose — a certificate, an
invoice, a report cover, a badge. Routing those through Markdown means embedding
raw HTML in Markdown and fighting the converter over what it escapes, wraps or
reflows; here your HTML is rendered **verbatim**, with no wrapper and no default
stylesheet. Usually that is a complete document — a bare fragment works too,
since Chromium supplies the missing structure.

Request (JSON), or a raw `text/html` body when you don't need options:

```jsonc
{
  "html": "<!DOCTYPE html><html>…</html>",
  "options": {
    "title": "Certificate",        // filename only — the document has its own <title>
    "format": "A4",                // A4 | A3 | A5 | Letter | Legal | Tabloid
    "landscape": true,
    "printBackground": true,
    "margin": { "top": "0mm", "right": "0mm", "bottom": "0mm", "left": "0mm" },
    "css": "@page { size: A4 landscape }" // optional, appended AFTER your styles
  }
}
```

Response: identical to `markdown-to-pdf` — `application/pdf` bytes by default,
or `{ "pdfBase64": "...", "bytes": 12345 }` with `Accept: application/json` or
`?format=base64`.

```bash
curl -sS -X POST http://localhost:8080/convert/html-to-pdf \
  -H 'content-type: application/json' \
  -H "authorization: Bearer $PDF_SERVICE_TOKEN" \
  -d '{"html":"<h1>Hello</h1>","options":{"landscape":true}}' \
  -o out.pdf
```

**Inline your assets as `data:` URIs.** Rendering runs with JavaScript disabled
and, unless `PDF_ALLOW_REMOTE=true`, every non-`data:` request is aborted — so a
background image or signature referenced by URL renders as nothing and still
returns `200`. Inlining also makes the render deterministic and offline, which
matters for a document people keep.

**Fonts are the image's, not yours.** A document naming a typeface the container
does not have falls back silently, and still returns `200`. The image declares its
fonts: Liberation Sans/Serif/Mono (metric-compatible with Arial, Times New Roman and
Courier New), Noto (Hebrew, Devanagari and the other core scripts), GNU FreeFont, plus
the Japanese, Chinese, Thai, Khmer and Arabic faces the base image ships. Korean and
colour emoji are not installed. `GET /convert/info` returns `fonts` — `source`,
`families` (what fontconfig reports in the running container) and `missingDeclared`
(declared families the image lacks; empty when healthy) — so a caller can assert
coverage in CI instead of finding tofu in a PDF. If `fc-list` cannot run (a dev host
without fontconfig), `source` is `unavailable`, `families` is empty, `error` carries a
fixed reason and `missingDeclared` lists every declared family (fail-closed), so a
caller should check `source === 'fc-list'` before reading the rest. Embed the face as a `data:`
`@font-face` if exact typography matters: it survives the `PDF_ALLOW_REMOTE`
hardening and makes the render deterministic whatever the image ships.

### `POST /convert/pdf-to-markdown`

Send the PDF either as a raw `application/pdf` body or as JSON
`{ "pdfBase64": "..." }`. Returns:

```jsonc
{
  "markdown": "# Title\n\nBody text…",
  "pageCount": 3,
  "info": { "title": "…", "author": "…" }
}
```

```bash
curl -sS -X POST http://localhost:8080/convert/pdf-to-markdown \
  -H 'content-type: application/pdf' \
  -H "authorization: Bearer $PDF_SERVICE_TOKEN" \
  --data-binary @in.pdf
```

**v1 fidelity note:** PDF → Markdown is *text extraction* from the PDF's text
layer (headings inferred from font size, paragraphs from vertical gaps). It does
**not** OCR scanned/image-only PDFs and does not perfectly reconstruct complex
tables.

## Engine

Markdown → PDF runs `marked` (GFM + highlight.js) → HTML → Chromium's
`page.pdf()` via Puppeteer, for full CSS/table/code/page-break fidelity. One
headless browser is launched at boot and reused across requests; each request
gets a throwaway page.

## Security

- **Bearer token** gate on `/convert/*` (`PDF_SERVICE_TOKEN`); required in prod.
- The renderer runs with **JavaScript disabled** and, unless
  `PDF_ALLOW_REMOTE=true`, **blocks every non-`data:` request** — so crafted
  Markdown can't read `file://` paths or reach internal hosts (SSRF) through an
  `<img>`/`<link>`. Set `PDF_ALLOW_REMOTE=true` only for trusted input that
  needs remote images.

## Development

```bash
npm install            # or pnpm install — downloads Chromium for Puppeteer
cp .env.example .env
npm run dev            # tsx watch on src/index.ts
npm test               # vitest (browser round-trip tests skip if Chromium absent)
npm run build && npm start
```

## Configuration

See [.env.example](.env.example). Key vars: `PORT`, `PDF_SERVICE_TOKEN`,
`PDF_ALLOW_REMOTE`, `MAX_BODY_SIZE`, `NODE_ENV`.
