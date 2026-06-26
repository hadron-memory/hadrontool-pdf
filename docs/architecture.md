# hadrontool-pdf — Architecture

**Status:** Draft for review · **Date:** 2026-06-25

A **stateless Markdown ↔ PDF renderer** for the Hadron platform: an
independently-deployed Express service that owns the heavy rendering dependency
(headless Chromium) and exposes a small HTTP surface. It converts Markdown to
PDF and extracts Markdown text back out of a PDF.

This document says where the tool sits, what crosses the boundary, and why the
line is drawn where it is. It is meant to validate the *approach*, not to be an
implementation spec.

## What this builds on

| Prior art | What we take from it |
|---|---|
| [`design:export-node-pdf`](hrn:node:hadronmemory.com::hadron-server::design:export-node-pdf) | The whole boundary analysis. It recommends **splitting the PDF pipeline at HTML→PDF**: hadron-server keeps auth + decryption + node loading; a **stateless renderer holds no DB, no keys, no access-control logic**. It also picks **Chromium (Puppeteer)** over pure-JS for Markdown fidelity, rules out hosted SaaS render APIs (in-infra privacy posture), and says **delete any `/tmp` "file mode."** This tool is that renderer. |
| [hadrontool-email architecture](https://github.com/hadron-memory/hadrontool-email) | The "a tool is a separate process that owns one provider-specific concern" shape, and the deployment model (separate container alongside hadron-server). |

**One difference from the design node, by request:** the node's recommendation
A draws the boundary at **HTML→PDF** (hadron-server does Markdown→HTML). Here the
boundary is drawn one step earlier, at **Markdown→PDF** — this service runs the
`marked` Markdown→HTML step itself. That keeps the service self-contained and
usable by any caller with plain Markdown (not just hadron-server's node
renderer), at the cost of a second Markdown renderer existing in the platform.
The privacy/security invariant is unchanged: the service still holds **no keys,
no DB, no access-control logic** — node *plaintext* only reaches it after
hadron-server has done auth + decryption, exactly as the node requires.

**One difference from the email tool:** the platform message bus (NATS
JetStream) is **designed-but-not-built** (see the email tool's
*What must exist first* and the `:dev` finding
`email-tool-not-shipped-defer-docs`). So this tool speaks **HTTP**, not NATS.
If/when the bus lands, a `pdf.render.v1` request/reply subject can wrap the same
two pure functions without touching the rendering core.

## Where the tool sits

```
┌──────────────────────────────────────────────────────────────────────┐
│  hadron-server (open core) — the front door                           │
│                                                                        │
│  • canReadMemory / access control     — unchanged                      │
│  • decryptNodesBatch + loadAndRender  — node -> Markdown (with edges)  │
│  • exportNodeToPDF GraphQL resolver    — auth + data access only       │
│      └─ POST Markdown -> hadrontool-pdf, gets PDF bytes back           │
└───────────────────────────────┬──────────────────────────────────────┘
                 HTTP  POST /convert/markdown-to-pdf   (Bearer token)
                 HTTP  POST /convert/pdf-to-markdown
                                │
                                ▼
┌──────────────────────────────────────────────────────────────────────┐
│  hadrontool-pdf  (THIS REPO — separate process/container)             │
│                                                                        │
│  • marked (GFM + highlight.js)  — Markdown -> styled HTML              │
│  • Puppeteer / Chromium         — HTML -> PDF (one warm browser)       │
│  • pdfjs-dist                   — PDF text layer -> Markdown (v1)      │
│  • NO database, NO keys, NO access-control logic                       │
└──────────────────────────────────────────────────────────────────────┘
```

**The split.** Everything that needs identity, keys, or the graph stays in
hadron-server. Everything that is "turn this document into that document" — the
Chromium dependency, the fonts, the RAM spikes, the browser lifecycle — lives
here, isolated from the API process. That is precisely the isolation goal stated
in the design node (keep hadron-server lean: no Chromium, no image bloat, no
zombie browser processes in the API container).

## HTTP surface

Two directions, plus health/info. Full request/response shapes are in the
[README](../README.md).

| Method · Path | In | Out |
|---|---|---|
| `POST /convert/markdown-to-pdf` | `{ markdown, options? }` | `application/pdf` bytes (or `{ pdfBase64 }`) |
| `POST /convert/pdf-to-markdown` | raw `application/pdf` or `{ pdfBase64 }` | `{ markdown, pageCount, info }` |
| `GET /convert/info` | — | capabilities (no secrets) |
| `GET /healthz` · `GET /readyz` | — | liveness / readiness |

### Statelessness & idempotency

Both operations are **pure functions of their input** — same bytes in, same
bytes out, no stored state. There is nothing to dedupe and nothing to lose on a
crash, so (unlike the email tool's mutating sends) no idempotency key or outbox
is needed. A failed request is simply retried.

## Engine choices

- **Markdown → PDF: Chromium via Puppeteer.** Per the design node's engine
  trade-off, a Hadron document is rendered Markdown, so fidelity (tables, code,
  CSS, page breaks, fonts) favors a browser engine over a pure-JS primitive
  mapper. One browser is launched at boot and **reused** across requests to
  amortize the ~200-500ms launch cost; each request renders on a throwaway page.
- **PDF → Markdown: `pdfjs-dist` text extraction (v1).** Reads the PDF text
  layer, groups items into lines/paragraphs by geometry, infers headings from
  font size. No OCR (scanned PDFs yield no text) and no exact table
  reconstruction — those are explicit non-goals for v1.

## Security posture

The service trusts its caller (hadron-server) and enforces that trust with a
**shared bearer token** on `/convert/*`, required in production. Two further
hardening rules protect against *content-borne* attacks, since Markdown can
embed HTML:

1. **JavaScript disabled** in the render page — the document is static print
   content.
2. **No non-`data:` requests** unless `PDF_ALLOW_REMOTE=true`. The render page
   intercepts and aborts `file://` (local-file read / exfiltration) and remote
   `http(s)://` (SSRF to internal hosts) fetches triggered by crafted
   `<img>`/`<link>` tags. This honors the design node's in-infra privacy posture:
   plaintext never leaves the boundary, and the renderer can't be tricked into
   reaching out.

## Deployment

A separate container alongside hadron-server (same model as the email tool —
Komodo/Docker). The [Dockerfile](../Dockerfile) builds on the official Puppeteer
base image, which ships a matching Chromium + fonts. hadron-server reaches it
over the internal network with `PDF_SERVICE_TOKEN`.

The serverless shape from the design node (Lambda + `@sparticuz/chromium`,
mirroring the in-tenant SageMaker offload) remains a valid alternative for bursty
volume; the HTTP contract above is identical either way.

## Open items / future work

1. **CLI / GraphQL wiring in hadron-server.** The `exportNodeToPDF` resolver,
   the `loadAndRender` extraction refactor, and `marked` (if hadron-server,
   rather than this service, ends up owning Markdown→HTML) are tracked against
   the design node — not in this repo.
2. **Delivery mode.** v1 returns base64/bytes inline. Presigned S3/R2 (mirroring
   `beginAssetUpload`) is the scale path if PDFs get large.
3. **Bus transport.** Wrap the two pure functions in a `pdf.*` NATS subject once
   the message bus ships.
4. **PDF → Markdown fidelity.** OCR + table reconstruction if real inputs demand
   it (v2).
