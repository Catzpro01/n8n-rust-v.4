# n8n lego — container image.
#
#   docker build -t n8n-lego .
#   docker run -d --name n8n-lego -p 5678:5678 -v n8n-lego-data:/home/node/.n8n-lego n8n-lego
#
# The image ships the app, the vendored LEGO engine and the editor UI bundle, plus
# a pre-fetched node catalog + icons, so a container starts with a populated
# palette and needs no network on first boot.
#   docker run --rm n8n-lego doctor      # check the install
#   docker run --rm n8n-lego catalog     # refresh the catalog
ARG NODE_IMAGE=node:22-bookworm-slim

# ------------------------------------------------------------------ deps stage
# Only the dependencies: the editor UI bundle is ~150 MB unpacked and must not be
# re-downloaded when application code changes.
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY apps/n8n-lego/package.json apps/n8n-lego/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# --------------------------------------------------------------- runtime stage
FROM ${NODE_IMAGE} AS runtime

ENV NODE_ENV=production \
    N8N_LEGO_HOST=0.0.0.0 \
    N8N_LEGO_PORT=5678 \
    N8N_LEGO_ENV=production \
    N8N_LEGO_USER_FOLDER=/home/node/.n8n-lego

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY apps/n8n-lego/bin ./bin
COPY apps/n8n-lego/src ./src
COPY apps/n8n-lego/scripts ./scripts
COPY apps/n8n-lego/data ./data
COPY apps/n8n-lego/package.json apps/n8n-lego/LICENSE.md apps/n8n-lego/README.md ./
COPY packages/reconstructed-engine ./vendor/reconstructed-engine
COPY deploy/docker/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

RUN chmod +x /usr/local/bin/docker-entrypoint.sh && chown -R node:node /app

USER node

# Bake the node catalog (n8n-nodes-base JSON + icons, ~9 MB download) into the
# default data directory: a fresh container/volume starts with a full palette.
RUN node bin/n8n-lego.mjs version \
 && node bin/n8n-lego.mjs catalog

# Informational: a failed check must not fail the build, it is printed for the log
# (`docker run --rm n8n-lego doctor` re-runs it inside the container).
RUN node bin/n8n-lego.mjs doctor || true

VOLUME ["/home/node/.n8n-lego"]
EXPOSE 5678

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.N8N_LEGO_PORT||5678)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["start"]
