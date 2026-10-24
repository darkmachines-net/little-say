# Builds the web app and API into a non-root server image with durable caches and database readiness checks.
# Compile portable JavaScript/web assets once, without emulating the target CPU.
FROM --platform=$BUILDPLATFORM node:24-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/mobile/package.json apps/mobile/package.json
COPY apps/server/package.json apps/server/package.json
COPY packages/core/package.json packages/core/package.json
RUN npm ci
COPY . .
RUN npm run build

# Install runtime dependencies per target so native modules (including sharp) match the image.
FROM node:24-bookworm-slim AS server-deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/mobile/package.json apps/mobile/package.json
COPY apps/server/package.json apps/server/package.json
COPY packages/core/package.json packages/core/package.json
RUN npm ci --omit=dev --workspace @little-say/server --include-workspace-root=false --ignore-scripts

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8787 WEB_ROOT=/app/web
WORKDIR /app
COPY --from=build /app/apps/server/dist ./server
COPY --from=build /app/apps/server/migrations ./migrations
COPY --from=build /app/apps/mobile/dist ./web
COPY --from=server-deps /app/node_modules ./node_modules
COPY --from=build /app/apps/server/package.json ./package.json
RUN mkdir -p /app/data/speech /app/data/pictures && chown node:node /app/data/speech /app/data/pictures
ENV SPEECH_CACHE_DIR=/app/data/speech
ENV PICTURE_CACHE_DIR=/app/data/pictures
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:8787/api/ready',{signal:AbortSignal.timeout(4000)}).then(async r=>{if(!r.ok||(await r.json()).status!=='ok')process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "server/index.js"]
