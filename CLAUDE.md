# Agent dev guide — hadrontool-pdf

**hadrontool-pdf** is a **stateless microservice** for the Hadron platform: it converts
**Markdown → PDF** (Puppeteer/Chromium) and extracts **PDF → Markdown** text. It holds
no database, no keys, and no access-control logic — `hadron-server` stays the front door
(auth, decryption, node loading) and calls this service over HTTP for the heavy render.
See [docs/architecture.md](docs/architecture.md) for the boundary.

## Use of Hadron

Hadron is the platform's institutional memory. Relevant memories:

- `hrn:memory:hadronmemory.com::hadrontool-pdf` — this tool's own findings/conventions
- `hrn:memory:hadronmemory.com::dev` — shared findings, conventions, ops, the `preflight` routing index
- `hrn:memory:hadronmemory.com::hadron-server` — the caller; newer server findings/conventions
- `hrn:memory:hadronmemory.com::specs` — product specs (loc-as-citation). This service implements
  the PDF render path of the **export contract** at `cor:int:020:02` (presentation export; HTML/PDF
  phases tracked in hadron-server#394).

(1) **Query Hadron before reading code.** For the topics/entities in a request, run
`hadron_find_nodes` first, then `hadron_get_node` on promising hits; cite node `loc` values.

(2) Read `hadron_get_node hrn:node:hadronmemory.com::dev::instructions` once per session (what
Hadron is, URN grammar, the specs corpus), and `hadron_get_node hrn:node:hadronmemory.com::dev::preflight`
before a change (the shared server/platform routing index).

(3) Capture a non-obvious finding the moment it emerges (`hadron_create_node` / `hadron_update_node`) —
don't batch to end-of-session.

(4) The **Hadron CLI is a superset of the MCP tools**: e.g. `hadron spec get cor:int:020:02 -m hadronmemory.com::specs`.

## Quick reference

```bash
npm run dev        # tsx watch (src/index.ts), serves on PORT (default 8080)
npm run build      # tsc → dist/
npm run typecheck  # tsc --noEmit
npm test           # vitest run
npm run test:watch # vitest
```

## Endpoints

- `POST /convert/markdown-to-pdf` — render Markdown to PDF; returns `application/pdf` bytes,
  or `{ pdfBase64, bytes }` with `Accept: application/json` / `?format=base64` (for embedding
  in a GraphQL response — the shape `hadron-server`'s `nodeExport` PDF path consumes).
- `POST /convert/pdf-to-markdown` — extract Markdown from a PDF (raw `application/pdf` body or
  `{ pdfBase64 }`). v1 is **text-layer extraction** (headings by font size, paragraphs by gaps) —
  no OCR of scanned/image-only PDFs, no perfect table reconstruction.
- `GET /convert/info` · `GET /healthz` (liveness) · `GET /readyz` (readiness + Chromium warm).

## Where things live

- `src/index.ts` — entry; `src/app.ts` — Express wiring; `src/config.ts` — env config; `src/logger.ts`.
- `src/routes/convert.ts` — the `/convert/*` handlers (+ `convert.test.ts`); `src/routes/health.ts`.
- `src/lib/markdownToHtml.ts` → `src/lib/htmlToPdf.ts` (Puppeteer) → PDF; `src/lib/browser.ts` —
  the shared/warm Chromium instance; `src/lib/pdfToMarkdown.ts` — text extraction.
- `src/middleware/auth.ts` — bearer-token gate; `src/middleware/error.ts`.

## Things to know before editing

- **Stateless boundary is the point.** No DB, no encryption, no node loading, no ACL — if a
  change wants any of those, it belongs in `hadron-server`, not here. Keep this service a pure
  render/extract function over its HTTP inputs.
- **Auth:** all `/convert/*` routes require `Authorization: Bearer $PDF_SERVICE_TOKEN` when that
  env var is set; in production the service **refuses to start without it**.
- **Chromium is the heavy dependency** — `browser.ts` keeps it warm; `/readyz` reports whether it
  is. Mind cold-start and the Docker image (`Dockerfile` ships Chromium).
- **Byte-identical isn't a goal here** (unlike the MD/JSON export in `cor:int:020:01`); a rendered
  PDF/HTML is a presentation output (`cor:int:020:02`), never the round-trippable portable file.
