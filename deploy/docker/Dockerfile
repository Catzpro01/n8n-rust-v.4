# TypeScript runtime image (LEGO baseline).
#
# Multi-stage by convention, but there is nothing to compile: the runtime is
# plain TypeScript executed by Node's native type stripping, with zero runtime
# dependencies.
#
#   docker build -f deploy/docker/Dockerfile -t n8n-ts-runtime .
#   docker run --rm -p 5678:5678 -v n8n-ts-data:/data n8n-ts-runtime

ARG NODE_IMAGE=node:22-bookworm-slim

# ---------------------------------------------------------------- deps stage
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY apps/n8n-ts/package.json apps/n8n-ts/package-lock.json ./apps/n8n-ts/
# The runtime has no runtime dependencies; this stage only proves the lockfile
# installs cleanly and warms the npm cache for the typecheck stage.
RUN npm --prefix apps/n8n-ts ci --omit=dev --no-audit --no-fund

# -------------------------------------------------------------- runtime stage
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    N8N_TS_HOST=0.0.0.0 \
    N8N_TS_PORT=5678 \
    N8N_TS_DATA_DIR=/data \
    N8N_TS_ENV=production \
    N8N_TS_LOG_FORMAT=json \
    N8N_TS_PID_FILE=/data/runtime.pid

WORKDIR /app

COPY --from=deps /app/apps/n8n-ts/node_modules ./apps/n8n-ts/node_modules
COPY apps/n8n-ts/package.json apps/n8n-ts/tsconfig.json ./apps/n8n-ts/
COPY apps/n8n-ts/src ./apps/n8n-ts/src
COPY apps/n8n-ts/README.md ./apps/n8n-ts/
COPY packages/reconstructed-engine ./packages/reconstructed-engine
COPY contracts/runtime-api.contract.md ./contracts/
COPY scripts ./scripts

RUN mkdir -p /data && chown -R node:node /app /data

USER node
VOLUME ["/data"]
EXPOSE 5678

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "const port=process.env.N8N_TS_PORT||5678;fetch('http://127.0.0.1:'+port+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "apps/n8n-ts/src/server.ts"]
