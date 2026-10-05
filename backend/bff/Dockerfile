# syntax=docker/dockerfile:1.7
#
# BFF de Prestige (NestJS + Prisma). El CONTEXTO de build es la RAÍZ del monorepo
# (necesita bun.lock y verifier/):
#   docker build -f backend/bff/Dockerfile -t prestige-bff .
#
# Layout final (el dossier lee process.cwd()/../../verifier → /app/verifier):
#   /app/verifier
#   /app/backend/bff        <- WORKDIR (dist/, prisma/, models/, node_modules/)

ARG BUN_VERSION=1.4.0
ARG NODE_VERSION=22
ARG PRISMA_VERSION=6.19.3

# ---------- deps completas (build) ----------
FROM oven/bun:${BUN_VERSION}-debian AS deps
WORKDIR /app
COPY package.json bun.lock ./
COPY backend/bff/package.json backend/bff/package.json
COPY frontend/web/package.json frontend/web/package.json
RUN bun install --frozen-lockfile

# ---------- build ----------
FROM deps AS build
WORKDIR /app/backend/bff
COPY backend/bff/ ./
RUN bunx prisma@${PRISMA_VERSION} generate --schema prisma/schema.prisma \
 && bunx nest build

# ---------- deps de producción (sin devDependencies) + cliente Prisma ----------
FROM oven/bun:${BUN_VERSION}-debian AS prod-deps
ARG PRISMA_VERSION
WORKDIR /app
COPY package.json bun.lock ./
COPY backend/bff/package.json backend/bff/package.json
COPY frontend/web/package.json frontend/web/package.json
RUN bun install --frozen-lockfile --production --filter @prestige/bff
COPY backend/bff/prisma backend/bff/prisma
RUN cd backend/bff && bunx prisma@${PRISMA_VERSION} generate --schema prisma/schema.prisma
# CLI de Prisma aislado, sólo para `migrate deploy` en el arranque.
RUN mkdir -p /opt/prisma-cli && cd /opt/prisma-cli \
 && echo '{"name":"prisma-cli","private":true}' > package.json \
 && bun add prisma@${PRISMA_VERSION}

# ---------- runtime ----------
FROM node:${NODE_VERSION}-bookworm-slim AS runtime
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates tini \
 && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production PORT=3000 PKI_DIR=./pki FACE_MODEL_DIR=./models/face TESSERACT_CACHE_PATH=/app/backend/bff
WORKDIR /app/backend/bff

COPY --from=prod-deps --chown=node:node /app/node_modules /app/node_modules
COPY --from=prod-deps --chown=node:node /app/backend/bff/node_modules ./node_modules
COPY --from=prod-deps --chown=node:node /opt/prisma-cli /opt/prisma-cli
COPY --from=build --chown=node:node /app/backend/bff/dist ./dist
COPY --chown=node:node backend/bff/prisma ./prisma
COPY --chown=node:node backend/bff/models ./models
COPY --chown=node:node backend/bff/spa.traineddata ./spa.traineddata
COPY --chown=node:node backend/bff/package.json ./package.json
COPY --chown=node:node verifier /app/verifier
COPY --chown=node:node backend/bff/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh \
 && mkdir -p pki && chown node:node pki

USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/operations/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/docker-entrypoint.sh"]
# Worker de Temporal: CMD ["node", "dist/src/temporal/worker.js"] (RUN_MIGRATIONS=false).
CMD ["node", "dist/src/main.js"]
