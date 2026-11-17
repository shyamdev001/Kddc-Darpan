# KDCC Darpan dashboard. Build from the repository root:
#   docker build -f apps/web/Dockerfile .
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci -w @darpan/shared -w @darpan/web --no-audit --no-fund
COPY packages/shared packages/shared
COPY apps/web apps/web
# The dashboard's /api proxy address is fixed at build time: the API container on the Docker network.
ARG API_URL=http://api:4000
ENV API_URL=${API_URL} \
    NEXT_TELEMETRY_DISABLED=1
RUN npm run build -w @darpan/shared && npm run build -w @darpan/web

FROM node:22-bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini \
 && rm -rf /var/lib/apt/lists/*
ARG API_URL=http://api:4000
ENV NODE_ENV=production \
    API_URL=${API_URL} \
    NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=build --chown=node:node /app /app
USER node
WORKDIR /app/apps/web
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/login').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
ENTRYPOINT ["tini", "--"]
CMD ["node", "/app/node_modules/next/dist/bin/next", "start", "-p", "3000", "-H", "0.0.0.0"]
