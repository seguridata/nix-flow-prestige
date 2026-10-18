# syntax=docker/dockerfile:1.7
#
# Front de Prestige (Next.js). El CONTEXTO de build es la RAÍZ del monorepo:
#   docker build -f frontend/web/Dockerfile --build-arg NEXT_PUBLIC_API_URL=https://api.ejemplo.com -t prestige-web .
# El build usa NEXT_OUTPUT=standalone (ver next.config.ts). Sin estado: escala con réplicas.

ARG BUN_VERSION=1.4.0
ARG NODE_VERSION=22

FROM oven/bun:${BUN_VERSION}-debian AS deps
WORKDIR /app
COPY package.json bun.lock ./
COPY backend/bff/package.json backend/bff/package.json
COPY frontend/web/package.json frontend/web/package.json
RUN bun install --frozen-lockfile

FROM deps AS build
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL} NEXT_TELEMETRY_DISABLED=1 NEXT_OUTPUT=standalone
WORKDIR /app/frontend/web
COPY frontend/web/ ./
RUN bunx next build

FROM node:${NODE_VERSION}-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends tini ca-certificates \
 && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production PORT=3001 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
# Con outputFileTracingRoot en la raíz del monorepo, standalone conserva la ruta frontend/web.
COPY --from=build --chown=node:node /app/frontend/web/.next/standalone ./
COPY --from=build --chown=node:node /app/frontend/web/.next/static ./frontend/web/.next/static
COPY --from=build --chown=node:node /app/frontend/web/public ./frontend/web/public
USER node
EXPOSE 3001
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/login').then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "frontend/web/server.js"]
