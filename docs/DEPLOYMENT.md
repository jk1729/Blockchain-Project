# PDSChain — Local, Containerized & Production Deployment Guide

## 1. Prerequisites

- **Node.js**: `v18.18+` or `v20 LTS`
- **npm**: `v9+`
- **Database**: SQLite 3 (bundled for local/demo) or PostgreSQL 15/16 (recommended for production)
- **Docker & Docker Compose** (optional, for containerized deployment)

---

## 2. Local Development / Faculty Demo Deployment

```bash
# 1. Install backend dependencies
cd backend
npm ci

# 2. Install & compile Solidity smart contracts (optional if artifacts already built)
cd ../contracts
npm ci
npx hardhat compile

# 3. Start the application server (auto-initializes SQLite WAL database)
cd ../backend
npm start
```
The server listens on `http://localhost:3000`.

---

## 3. Production Bare-Metal / VM Deployment

### Step 1: Configure Production Environment Variables
Copy `backend/.env.example` to `backend/.env` and configure production values:
```ini
NODE_ENV=production
PORT=3000
DB_DIALECT=postgres
DATABASE_URL=postgres://pdschain_user:<STRONG_DB_PASSWORD>@127.0.0.1:5432/pdschain
JWT_SECRET=<AT_LEAST_32_CHARACTER_CRYPTOGRAPHIC_RANDOM_STRING>
JWT_EXPIRES_IN=12h
CORS_ORIGIN=https://pdschain.example.org
```
> **Strict Startup Validation**: In `NODE_ENV=production`, `backend/src/config/env.js` refuses to start if `JWT_SECRET` is `< 32` characters, matches the dev secret, or if `CORS_ORIGIN` is `*`.

### Step 2: Provision Production Administrator Account
Without running destructive demo seeding (`force: true` is blocked in production), provision the initial administrator account:
```bash
cd backend
ADMIN_USERNAME=sysadmin ADMIN_PASSWORD='<StrongPassword123!>' npm run provision:admin
```

### Step 3: Provision 12 Validator Cryptographic Identities & Accounts
```bash
cd backend
node src/scripts/provisionValidators.js
```
This provisions 12 distinct Ed25519 validator keypairs (`database/validators/VAL-01..VAL-12/identity.json`) and 12 validator login accounts (`v1`..`v12`).

### Step 4: Start Under Systemd or Process Supervisor
Install the included systemd service (`scripts/service/pdschain-validator.service`) or Windows Service (`scripts/service/Install-ValidatorService.ps1`), or launch directly (which automatically spawns all 12 validator OS processes on ports `4001`–`4012`):
```bash
cd backend
NODE_ENV=production npm start
```

---

## 4. Containerized Production Deployment (Docker Compose)

### A. Full-Stack Application + PostgreSQL 16 + 12 Validators (`docker-compose.production.yml`)
```bash
export POSTGRES_PASSWORD='<StrongPostgresPassword>'
export JWT_SECRET='<AtLeast32CharacterRandomProductionJwtSecret>'
export CORS_ORIGIN='https://pdschain.example.org'

docker compose -f docker-compose.production.yml up -d --build
```

### B. 12-Validator Consortium Network (`docker-compose.network.yml`)
Spins up all 12 independent validator containers (`validator-01`..`validator-12`, corresponding to `VAL-01`..`VAL-12` / `V1`..`V12` on ports `4001`–`4012` and P2P ports `5001`–`5012`) over an isolated bridge network (`172.28.0.0/16`):
```bash
docker compose -f docker-compose.network.yml up -d --build
```

---

## 5. Health, Readiness & Metrics Endpoints

| Endpoint | Purpose | Expected Response |
| :--- | :--- | :--- |
| `GET /health` | Overall system health summary | `200 OK` (`status: "UP"`) |
| `GET /health/live` | Kubernetes / Docker liveness probe | `200 OK` (`live: true`) |
| `GET /health/ready` | Readiness probe (DB + Chain + Consensus) | `200 OK` (`ready: true`) |
| `GET /metrics` | Prometheus text-format telemetry | `200 OK` (`text/plain; version=0.0.4`) |
| `GET /api/blockchain/validate` | Full cryptographic chain verification | `200 OK` (`isValid: true`) |

