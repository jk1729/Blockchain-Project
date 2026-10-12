# ==============================================================================
# PDSChain Full-Stack Application Production Dockerfile
# Serves Backend REST/RPC API, EVM Runtime, FBA Engine, and Static Frontend UI
# ==============================================================================

FROM node:20-alpine AS build

WORKDIR /app/backend

RUN apk add --no-cache python3 make g++

COPY backend/package*.json ./
RUN npm ci --omit=dev

# --- Stage 2: Production Runtime ---
FROM node:20-alpine AS runtime

LABEL org.opencontainers.image.title="PDSChain Application Server" \
      org.opencontainers.image.description="Production Blockchain-Based Public Distribution System" \
      org.opencontainers.image.version="1.0.0"

RUN apk add --no-cache dumb-init curl

WORKDIR /app

RUN addgroup -g 10001 -S pdschain && \
    adduser -u 10001 -S pdschain -G pdschain

COPY --chown=pdschain:pdschain --from=build /app/backend/node_modules ./backend/node_modules
COPY --chown=pdschain:pdschain backend/package.json ./backend/
COPY --chown=pdschain:pdschain backend/src ./backend/src
COPY --chown=pdschain:pdschain frontend ./frontend
COPY --chown=pdschain:pdschain contracts/artifacts ./contracts/artifacts

RUN mkdir -p /app/database && chown -R pdschain:pdschain /app/database

WORKDIR /app/backend

ENV NODE_ENV=production \
    PORT=3000

EXPOSE 3000

USER pdschain

VOLUME ["/app/database"]

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://127.0.0.1:3000/health/live || exit 1

ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "src/server.js"]

