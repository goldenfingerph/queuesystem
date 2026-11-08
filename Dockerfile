FROM node:22-bookworm-slim AS build

WORKDIR /app

# better-sqlite3 may need a native build when no matching prebuilt binary is available.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build \
    && ./node_modules/.bin/tsc -p tsconfig.docker.json \
    && mkdir -p /app/server-dist/server/db \
    && cp server/db/*.sql /app/server-dist/server/db/ \
    && cp -a dist /app/server-dist/dist

# Keep only production dependencies in the final image.
RUN npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
    PORT=4000 \
    HOST=0.0.0.0 \
    DB_PATH=/data/infinity.db \
    ADS_DIR=/data/ads \
    LOGO_DIR=/data/logo \
    BACKUPS_DIR=/data/backups

WORKDIR /app

COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/server-dist ./server-dist

RUN mkdir -p /data/ads /data/logo /data/backups \
    && chown -R node:node /data

USER node

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4000/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "server-dist/server/index.js"]
