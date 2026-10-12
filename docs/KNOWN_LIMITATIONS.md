# PDSChain — Known Limitations, Operating Boundaries & External Dependencies

In accordance with engineering transparency standards, this document distinguishes between **verified local/consortium features** and **external or infrastructure-dependent capabilities**.

## 1. Consensus & Network Topology Boundaries

1. **Default Single-Process Consortium Mode vs. Distributed Multi-Host Deployment**:
   - When launched via `npm start` (`backend/src/server.js`), the 12 FBA validators (`VAL-01` – `VAL-12`) execute **in-process** within the Node.js application runtime using distinct Ed25519 keypairs. This is a **local consortium consensus simulation** designed for single-machine academic evaluation, deterministic testing, and interactive fault-injection demos.
   - While PDSChain also includes a multi-process P2P validator daemon (`backend/src/validators/validatorProcess.js` and `docker-compose.network.yml`) with TCP wire framing and Ed25519 peer authentication, true Byzantine fault tolerance against physical host or network compromise requires deploying each validator container onto independent physical/cloud hosts managed by separate institutions.

## 2. Cryptographic Key Management

1. **Deterministic Dev/Demo Identities vs. Production HSM/KMS**:
   - In development/demo mode (`NODE_ENV !== 'production'`), validator and participant Ed25519 keys are deterministically derived or loaded from local files (`keyManager.js`) so seeded blocks and certificates remain reproducible across machines.
   - For production consortium deployment, validator identities must be provisioned uniquely per node using `npm run provision:identity` and protected via OS permissions (`0600`) or an external Hardware Security Module (HSM) / Cloud KMS.

## 3. External Government & Hardware Integrations

1. **No Live Aadhaar / UIDAI or e-POS Biometric Hardware Integration**:
   - Beneficiary enrollment and verification operate on application-level pseudonymous IDs (`BEN-1024`) and SHA-256 identity commitments. No connection to government UIDAI servers, SMS/OTP gateways, or physical e-POS fingerprint scanners is configured.
2. **No External Public Ethereum / MetaMask Dependency**:
   - The Solidity `0.8.24` smart contract suite executes inside the embedded `@ethereumjs/vm` (Cancun hardfork, Chain ID `1729`) synchronized with the PDSChain ledger rather than a public Ethereum testnet requiring gas tokens or browser wallets.

## 4. Production Infrastructure Prerequisites

- Deploying to a public internet domain requires external infrastructure not bundled in the repository:
  - A provisioned PostgreSQL 15/16 server (or Docker host running `docker-compose.production.yml`).
  - DNS records and a TLS certificate (e.g., Let's Encrypt / Nginx reverse proxy) for HTTPS termination.
  - Explicit `JWT_SECRET` ($\ge 32$ chars) and `CORS_ORIGIN` environment variables.

