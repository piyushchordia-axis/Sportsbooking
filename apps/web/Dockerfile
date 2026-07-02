# syntax=docker/dockerfile:1.7
# Build the Sportline Vite SPA and serve it from nginx. Build context is the
# repo ROOT (see docker-compose.prod.yml). The SPA calls `/api` relatively, so
# there is no build-time API URL to bake in — the nginx tier proxies it.

########################## Build ##########################
FROM node:22-alpine AS build
ENV CI=1
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
WORKDIR /repo
COPY . .
# Install the web app + its workspace deps (shared) only.
RUN pnpm install --frozen-lockfile --filter "@sportsbooking/web..."
# shared provides the types the web build type-checks against; build it first.
RUN pnpm --filter @sportsbooking/shared build \
 && pnpm --filter @sportsbooking/web build

########################## Runtime ##########################
# Unprivileged nginx: runs as UID 101 (non-root), not root-in-the-host-net-ns.
# It binds our loopback 8093 (an unprivileged port) fine, and its pid/temp paths
# are pre-configured writable for UID 101. Drop-in for nginx:alpine.
FROM nginxinc/nginx-unprivileged:1.27-alpine AS runtime
# Replace the stock server block with ours (SPA + API proxy). Need root to write
# under /etc/nginx during build; the image switches back to USER 101 to run.
USER root
# The stock unprivileged config's default.conf listens on 8080; drop it for ours.
RUN rm -f /etc/nginx/conf.d/default.conf
COPY apps/web/nginx.conf /etc/nginx/conf.d/sportline.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
# Back to the unprivileged runtime user (UID 101) so the container runs non-root.
USER 101
EXPOSE 8093
HEALTHCHECK --interval=30s --timeout=4s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8093/index.html >/dev/null 2>&1 || exit 1
