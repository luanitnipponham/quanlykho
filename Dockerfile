# Frontend: build the Vite bundle, then serve it with nginx.
# nginx also proxies /api to the backend container, replacing the Vite dev proxy.

# ---------------------------------------------------------------------------
# 1. Build
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig*.json vite.config.ts tailwind.config.js postcss.config.js index.html ./
COPY src ./src

# In a deployed image the browser-only demo fallback is a trap: if the API is down the
# user would keep working against localStorage. Build with it disabled.
ARG VITE_REQUIRE_BACKEND=true
ENV VITE_REQUIRE_BACKEND=$VITE_REQUIRE_BACKEND
RUN npm run build

# ---------------------------------------------------------------------------
# 2. Serve
# ---------------------------------------------------------------------------
FROM nginx:1.27-alpine AS runtime

COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=5 \
  CMD wget -q --spider http://127.0.0.1/ || exit 1
