# n8n-ts baseline — multi-stage (build TS → runner minimal).
# Build dari repo root:  docker build -f deploy/docker/Dockerfile .
# Lihat deploy/docker/README.md.

FROM node:22-alpine AS build
WORKDIR /app

# 1. Install deps (layer cache-friendly: lockfile dulu).
COPY apps/n8n-ts/package.json apps/n8n-ts/package-lock.json ./apps/n8n-ts/
RUN npm --prefix apps/n8n-ts ci

# 2. Salin sumber runtime + LEGO engine (.mjs seam yang dipakai adapter).
COPY apps/n8n-ts/ ./apps/n8n-ts/
COPY packages/reconstructed-engine/ ./packages/reconstructed-engine/

# 3. Build + typecheck.
RUN npm --prefix apps/n8n-ts run typecheck \
 && npm --prefix apps/n8n-ts run build

# ---- runner ----
FROM node:22-alpine AS runner
ENV NODE_ENV=production
WORKDIR /app

RUN addgroup -S app && adduser -S app -G app

# Hanya yang dibutuhkan saat jalan: dist/ + package.json + engine .mjs.
COPY --from=build /app/apps/n8n-ts/dist ./apps/n8n-ts/dist
COPY --from=build /app/apps/n8n-ts/package.json ./apps/n8n-ts/package.json
COPY --from=build /app/packages/reconstructed-engine/*.mjs ./packages/reconstructed-engine/

USER app
EXPOSE 5678

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "const p=process.env.PORT||5678;fetch('http://127.0.0.1:'+p+'/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "apps/n8n-ts/dist/server.js"]
