# hadrontool-pdf — stateless markdown<->PDF renderer.
#
# Uses Puppeteer's official base image, which ships a matching Chromium plus all
# the system fonts/libs it needs. This is the low-friction path for a standalone
# renderer (vs. wiring puppeteer-core against an Alpine chromium apk).
FROM ghcr.io/puppeteer/puppeteer:25.2.1 AS base

# The base image runs as the non-root `pptruser`; switch to root only to install.
USER root
WORKDIR /app

# Use the Chromium that ships in the base image instead of downloading another.
ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable \
    NODE_ENV=production

# --- deps ---
COPY package.json ./
# No lockfile committed yet; once you commit pnpm-lock.yaml / package-lock.json,
# switch this to the frozen-install form for reproducible builds.
RUN npm install --omit=dev && cp -r node_modules /tmp/prod_node_modules \
    && npm install

# --- build ---
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# --- prune to production deps ---
RUN rm -rf node_modules && mv /tmp/prod_node_modules node_modules

RUN chown -R pptruser:pptruser /app
USER pptruser

EXPOSE 8080
ENV PORT=8080
CMD ["node", "dist/index.js"]
