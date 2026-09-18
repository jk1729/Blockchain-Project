# ==============================================================================
# PDSChain Validator Multi-Stage Dockerfile (Phase 11)
# ==============================================================================

# --- Stage 1: Build & Dependencies ---
FROM node:20-alpine AS build

WORKDIR /app

# Install build dependencies for native compilation (sqlite3, python)
RUN apk add --no-cache python3 make g++

# Copy dependency manifests
COPY backend/package*.json ./

# Deterministic production install
RUN npm ci --omit=dev

# --- Stage 2: Minimal Production Runtime ---
FROM node:20-alpine AS runtime

LABEL org.opencontainers.image.title="PDSChain Validator Node" \
      org.opencontainers.image.description="Deployable FBA Validator Node for PDSChain" \
      org.opencontainers.image.version="1.0.0" \
      org.opencontainers.image.vendor="PDSChain Consortium"

# Install dumb-init for proper PID 1 signal forwarding (SIGINT/SIGTERM)
RUN apk add --no-cache dumb-init curl

WORKDIR /app

# Create non-privileged service user and group
RUN addgroup -g 10001 -S pdschain && \
    adduser -u 10001 -S pdschain -G pdschain

# Copy production node_modules from build stage
COPY --chown=pdschain:pdschain --from=build /app/node_modules ./node_modules

# Copy backend application source
COPY --chown=pdschain:pdschain backend/src ./src
COPY --chown=pdschain:pdschain backend/package.json ./

# Create persistent storage directories and assign ownership
RUN mkdir -p /data/database /data/journal /data/checkpoints /data/logs && \
    chown -R pdschain:pdschain /data

# Default environment variables
ENV NODE_ENV=production \
    DATA_DIR=/data \
    PORT=4001 \
    API_PORT=4001 \
    P2P_PORT=5001 \
    P2P_HOST=0.0.0.0 \
    API_HOST=0.0.0.0

# Expose HTTP API and P2P Wire ports
EXPOSE 4001 5001

# Run as non-root user
USER pdschain

# Define persistent storage volume
VOLUME ["/data"]

# Health check probe against liveness and readiness endpoints
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://127.0.0.1:4001/health/live || exit 1

# Launch validator daemon with signal handling
ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "src/validators/validatorProcess.js"]

