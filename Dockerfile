# hadrontool-pdf — stateless Markdown<->PDF renderer.
#
# Built by Komodo from this repo's `main`, pushed to GHCR, deployed on the
# `komodo_default` network as an INTERNAL-ONLY service: no Traefik router, no
# public DNS. hadron-server reaches it by container name at http://hadrontool-pdf:8080.
# Secrets are injected at runtime by Doppler (`doppler run --`), matching
# hadron-server / hadron-portal — Komodo sets only DOPPLER_TOKEN.
#
# Base: the official Puppeteer image ships a Chromium matching the puppeteer npm
# version. KEEP THIS TAG IN SYNC with the locked `puppeteer` in package-lock.json
# (both 25.2.1) — a version mismatch breaks browser launch.
FROM ghcr.io/puppeteer/puppeteer:25.2.1

USER root
WORKDIR /app

# Doppler CLI for runtime secret injection (same pattern as the other services).
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl gnupg \
  && curl -sLf --retry 3 --tlsv1.2 --proto '=https' 'https://cli.doppler.com/install.sh' | sh \
  && apt-get purge -y curl gnupg && apt-get autoremove -y \
  && rm -rf /var/lib/apt/lists/*

# Font policy (hadrontool-pdf#6): declared here, not inherited from the base image. The base installs fonts-ipafont-gothic,
# fonts-wqy-zenhei, fonts-thai-tlwg, fonts-khmeros, fonts-kacst and fonts-freefont-ttf; whatever else it resolves (Liberation,
# DejaVu) is incidental and can change with a pin bump. Declaring the set makes it a guarantee:
#  - fonts-liberation: Liberation Sans/Serif/Mono, metric-compatible with Arial/Times New Roman/Courier New.
#  - fonts-noto-core: Noto Sans Hebrew and Noto Sans Devanagari (Hebrew otherwise falls to DejaVu, Devanagari to FreeSans).
#  - fonts-freefont-ttf: re-declared (Latin/Cyrillic/Greek) so it stays if the base pin changes.
# Korean (fonts-noto-cjk) is left out on purpose (image size) until a caller needs it.
# The build fails if ANY declared family is absent. KEEP the loop below in sync with REQUIRED_FAMILIES in src/lib/fonts.ts;
# GET /convert/info reports what is installed and what is missing.
RUN apt-get update \
  && apt-get install -y --no-install-recommends fonts-liberation fonts-noto-core fonts-freefont-ttf fontconfig \
  && rm -rf /var/lib/apt/lists/* \
  && fc-cache -f \
  && for f in "Liberation Sans" "Liberation Serif" "Liberation Mono" "Noto Sans Hebrew" "Noto Sans Devanagari"; do \
       fc-list : family | grep -Fq "$f" || { echo "font check failed: $f is not installed" >&2; exit 1; }; \
     done

# The base image already contains the matching Chromium; don't re-download it
# during `npm ci`. At runtime puppeteer.launch() finds the image's browser in
# the default cache (~/.cache/puppeteer for pptruser).
ENV NODE_ENV=production \
    PORT=8080 \
    PUPPETEER_SKIP_DOWNLOAD=true

# Reproducible install from the committed lockfile, then compile and drop dev deps.
# --include=dev is required because NODE_ENV=production (set above) would
# otherwise make `npm ci` skip devDependencies (typescript/tsx) and the build
# would fail with `tsc: not found`.
COPY package.json package-lock.json ./
RUN npm ci --include=dev
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

RUN chown -R pptruser:pptruser /app
USER pptruser

EXPOSE 8080
# Doppler injects PDF_SERVICE_TOKEN / NODE_ENV / PORT etc. via DOPPLER_TOKEN.
CMD ["doppler", "run", "--", "node", "dist/index.js"]
