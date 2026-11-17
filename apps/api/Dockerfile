# KDCC Darpan API. Build from the repository root:
#   docker build -f apps/api/Dockerfile .
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci -w @darpan/shared -w @darpan/api --no-audit --no-fund
COPY packages/shared packages/shared
COPY apps/api apps/api
# prisma generate only reads the schema; the address is a placeholder, nothing connects to it.
RUN npm run build -w @darpan/shared \
 && cd apps/api \
 && DATABASE_URL=postgresql://build:build@localhost:5432/build npx prisma generate \
 && npm run build

FROM node:22-bookworm-slim
# ffmpeg turns uploaded videos into 1080p H.264; tini passes stop signals on so shutdowns are clean.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg tini \
 && rm -rf /var/lib/apt/lists/* \
 && mkdir -p /data/media \
 && chown node:node /data/media
ENV NODE_ENV=production \
    API_HOST=0.0.0.0 \
    API_PORT=4000 \
    STORAGE_DRIVER=local \
    STORAGE_LOCAL_DIR=/data/media
WORKDIR /app
COPY --from=build --chown=node:node /app /app
USER node
WORKDIR /app/apps/api
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4000/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
ENTRYPOINT ["tini", "--"]
# Apply any new database migrations, then start. Safe to repeat: applied ones are skipped.
CMD ["sh", "-c", "npx prisma migrate deploy && exec node dist/main.js"]
