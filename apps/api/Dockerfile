# Backend: NestJS + Prisma. Multi-stage so the runtime image carries no compiler.
# Build context is the repo root (see docker-compose.yml).

# ---------------------------------------------------------------------------
# 1. deps — production node_modules, built where a compiler is available.
#    argon2 is a native module: it falls back to compiling when no prebuilt
#    binary matches the platform, so python3/make/g++ must be present here.
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY apps/api/package*.json ./
# prisma CLI stays in dependencies: the entrypoint runs `prisma migrate deploy`.
RUN npm ci --omit=dev

COPY apps/api/prisma ./prisma
RUN npx prisma generate

# ---------------------------------------------------------------------------
# 2. builder — full deps, compile TypeScript to dist/
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS builder
WORKDIR /app
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY apps/api/package*.json ./
RUN npm ci

COPY apps/api/prisma ./prisma
RUN npx prisma generate

COPY apps/api/tsconfig.json ./
COPY apps/api/src ./src
RUN npx tsc -p tsconfig.json

# ---------------------------------------------------------------------------
# 3. runtime
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Prisma needs OpenSSL at runtime; tini reaps zombies and forwards signals.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates tini \
 && rm -rf /var/lib/apt/lists/*

COPY apps/api/package*.json ./
COPY --from=deps    /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY apps/api/prisma ./prisma
COPY apps/api/docker-entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# Attachments live here; docker-compose mounts a named volume on top.
RUN mkdir -p /app/storage && chown -R node:node /app/storage
ENV STORAGE_DIR=/app/storage

USER node
EXPOSE 3000

# 401 means the API is up and demanding a token, so treat anything under 500 as healthy.
HEALTHCHECK --interval=15s --timeout=5s --start-period=60s --retries=10 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/v1/departments').then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/entrypoint.sh"]
CMD ["node", "dist/main.js"]
