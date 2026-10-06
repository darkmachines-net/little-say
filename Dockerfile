# Builds the web app and API into a non-root server image with writable speech and picture caches.
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/mobile/package.json apps/mobile/package.json
COPY apps/server/package.json apps/server/package.json
COPY packages/core/package.json packages/core/package.json
RUN npm ci
COPY . .
RUN npm run build

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
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:8787/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "server/index.js"]
