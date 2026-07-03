# syntax=docker/dockerfile:1.7
# Multi-stage build for the Sportline NestJS API (pnpm monorepo).
# The build context is the repo ROOT (see docker-compose.prod.yml), so paths
# below are repo-relative. Only @sportsbooking/shared needs compiling; ui/config
# are consumed as source. The runtime keeps the full install (incl. dev deps) so
# the SAME image can apply migrations + RLS (`pnpm db:push`) and seed.

########################## Base ##########################
FROM node:22-alpine AS base
ENV CI=1
# Pin the exact pnpm that produced pnpm-lock.yaml (root packageManager field).
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
WORKDIR /repo

########################## Build ##########################
FROM base AS build
# .dockerignore strips node_modules/dist, so this is sources + manifests + lock.
COPY . .
# Install only the api and its workspace deps (skips web/ui toolchains).
RUN pnpm install --frozen-lockfile --filter "@sportsbooking/api..."
# shared must be compiled first (api imports its dist), then build the API.
RUN pnpm --filter @sportsbooking/shared build \
 && pnpm --filter @sportsbooking/api build

########################## Runtime ##########################
FROM base AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    API_PORT=3001 \
    STORAGE_LOCAL_DIR=/data/uploads
# Bring the fully-installed, built workspace across intact (pnpm symlink store
# included, so module resolution + the drizzle/ts-node migration tooling work).
COPY --from=build /repo /repo
# Persistent uploads dir + drop root.
RUN mkdir -p /data/uploads \
 && addgroup -S app && adduser -S app -G app \
 && chown -R app:app /repo /data
USER app
WORKDIR /repo/apps/api

EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${API_PORT}/api/healthz" >/dev/null 2>&1 || exit 1

# dist/main.js reads DATABASE_URL (restricted runtime role) and serves /api.
CMD ["node", "dist/main.js"]
