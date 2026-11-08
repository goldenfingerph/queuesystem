# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS build
WORKDIR /app

# better-sqlite3 may need a native build toolchain for this Node/Linux image.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run typecheck && npm run lint && npm run build
RUN mkdir -p dist-server \
  && npx esbuild server/index.ts --bundle --platform=node --format=esm --packages=external --outfile=dist-server/index.js \
  && cp server/db/*.sql dist-server/

# Keep only runtime dependencies in the final image.
RUN npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=4000 \
    HOST=0.0.0.0 \
    DB_PATH=/data/infinity.db \
    BACKUPS_DIR=/backups \
    ADS_DIR=/ads \
    LOGO_DIR=/logo

WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/dist-server ./dist-server

RUN mkdir -p /data /backups /ads /logo \
  && chown -R node:node /data /backups /ads /logo /app

USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist-server/index.js"]
