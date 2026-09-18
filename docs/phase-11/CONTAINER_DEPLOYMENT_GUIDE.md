# PDSChain Phase 11: Container Deployment Guide

## 1. Container Architecture

PDSChain provides an official multi-stage Docker build producing a minimal, secure, and reproducible image:
- **Base Image**: `node:20-alpine`
- **User Security**: Runs as unprivileged user `pdschain:pdschain` (`UID:GID = 10001:10001`).
- **Signal Handling**: Integrated with `dumb-init` to ensure clean propagation of `SIGTERM` and `SIGINT` signals.
- **Volume Mount**: Dedicated persistent mount at `/data`.
- **Health Checks**: Automated probe checking `GET /health/live`.

---

## 2. Building the Image

```bash
# From the repository root
docker build -t pdschain/validator:1.0.0 -f Dockerfile .
```

---

## 3. Running a Standalone Validator

```bash
docker run -d \
  --name pdschain-val-01 \
  --restart unless-stopped \
  --user 10001:10001 \
  --cap-drop ALL \
  --security-opt no-new-privileges:true \
  -p 4001:4001 \
  -p 5001:5001 \
  -v /var/lib/pdschain/val01:/data \
  -e NODE_ENV=production \
  -e VALIDATOR_ID=VAL-01 \
  -e NETWORK_ID=pdschain-mainnet \
  -e CHAIN_ID=1729 \
  -e API_PORT=4001 \
  -e P2P_PORT=5001 \
  -e P2P_HOST=0.0.0.0 \
  -e API_HOST=0.0.0.0 \
  -e DATA_DIR=/data \
  pdschain/validator:1.0.0
```

---

## 4. Local Multi-Validator Network via Docker Compose

To launch a 4-node local consortium cluster on an isolated Docker bridge network:

```bash
# Launch the 4-node cluster in the background
docker compose -f docker-compose.network.yml up -d

# Inspect running cluster containers
docker compose -f docker-compose.network.yml ps

# Inspect logs for VAL-01
docker compose -f docker-compose.network.yml logs -f validator-01

# Teardown cluster (preserving volumes)
docker compose -f docker-compose.network.yml down
```

---

## 5. Container Health Probes

Containers expose standard health check endpoints:
- **Liveness Probe**: `curl -f http://127.0.0.1:4001/health/live`
- **Readiness Probe**: `curl -f http://127.0.0.1:4001/health/ready`
- **Consensus Probe**: `curl -f http://127.0.0.1:4001/health/consensus`

