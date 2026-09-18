# PDSChain Phase 11: Deployment Baseline & Runtime Audit

## 1. Executive Overview

This document records the operational audit of the PDSChain repository at the onset of **Phase 11: Deployable Validator Nodes**.
Phase 10 concluded with **469 / 469 passing tests** (449 backend + 20 Hardhat smart contracts), validating real multi-process FBA consensus, length-prefixed streaming framing, mutual Ed25519 authenticated transport, and self-healing ledger synchronization and recovery.

Phase 11 transitions this runtime into a production-deployable system capable of running across single-node, multi-node, containerized, and native OS service environments.

---

## 2. Runtime Environment & Baseline Dependencies

| Parameter | Current Specification | Production Requirement |
| :--- | :--- | :--- |
| **Node.js Version** | Node.js v24.20.0 (x64) | LTS v20.x or v22.x+ (compatible with v24.x) |
| **Operating Systems** | Windows 10/11 x64, Linux (Debian/Ubuntu, RHEL) | Cross-platform container (Linux) & Windows Service |
| **Package Manager** | npm v11.x (with `package-lock.json`) | Deterministic `npm ci --omit=dev` |
| **EVM Engine** | `@ethereumjs/vm` v10.1.3 (Cancun HF) | Cancun EVM execution on Chain ID 1729 |
| **Storage Engine** | SQLite3 v5.1.7 (WAL mode) | Isolated volume mount per validator process |
| **Cryptographic Library** | Node.js `crypto` (Ed25519, SHA-256) | Hardware-safe Ed25519 PKCS#8 & SPKI |
| **HTTP Framework** | Express v4.21.2 | Hardened REST & Health endpoints |

---

## 3. Port & Network Matrix (12-Validator Topology)

The default 12-validator institutional topology assigns dedicated HTTP management and P2P gossip ports:

| Validator ID | Institutional Entity | HTTP API Port | P2P Wire Port | Local Storage Directory |
| :--- | :--- | :--- | :--- | :--- |
| `VAL-01` | Ministry of Consumer Affairs | `4001` | `5001` | `database/validators/VAL-01/` |
| `VAL-02` | National Informatics Centre | `4002` | `5002` | `database/validators/VAL-02/` |
| `VAL-03` | State Food Commission | `4003` | `5003` | `database/validators/VAL-03/` |
| `VAL-04` | Civil Supplies Corporation | `4004` | `5004` | `database/validators/VAL-04/` |
| `VAL-05` | FCI Logistics Regional Hub | `4005` | `5005` | `database/validators/VAL-05/` |
| `VAL-06` | Central Vigilance Directorate | `4006` | `5006` | `database/validators/VAL-06/` |
| `VAL-07` | District Collectorate Hub A | `4007` | `5007` | `database/validators/VAL-07/` |
| `VAL-08` | District Collectorate Hub B | `4008` | `5008` | `database/validators/VAL-08/` |
| `VAL-09` | State Warehousing Corp | `4009` | `5009` | `database/validators/VAL-09/` |
| `VAL-10` | Public Audit & Accounts Board| `4010` | `5010` | `database/validators/VAL-10/` |
| `VAL-11` | Fair Price Shop Oversight Unit | `4011` | `5011` | `database/validators/VAL-11/` |
| `VAL-12` | Ministry of Electronics & IT | `4012` | `5012` | `database/validators/VAL-12/` |

---

## 4. Production Gaps Identified (Pre-Phase 11 Audit)

The audit identified the following gaps that must be addressed for secure production deployment:

1. **Deterministic Development Keys in Runtime**:
   - `keyManager.js` derives Ed25519 keys from `sha256("PDSCHAIN_DEV_KEY:VAL-XX:...")`. While ideal for unit tests, this is insecure for production.
   - *Phase 11 Fix*: Implement `IdentityProvisioner.js`. In `NODE_ENV=production`, reject dev keys and enforce genuine Ed25519 keypair loading from a protected file (`identity.json`).

2. **Configuration System Rigidity**:
   - Validator configuration is partially hardcoded in `consensusConfig.js` and partially read from ad-hoc environment variables.
   - *Phase 11 Fix*: Implement `ValidatorConfig.js` supporting JSON configuration files, environment variables, CLI flags, schema validation, and sensitive secret redaction.

3. **Storage & Multi-Instance Locking**:
   - If two processes start with the same `VALIDATOR_ID`, they may attempt to write to the same `pdschain.sqlite` or `consensus_journal.jsonl`, risking corruption.
   - *Phase 11 Fix*: Implement `StorageLayout.js` with POSIX/NTFS file-locking (`validator.pid`).

4. **Health Check Probes**:
   - Currently, a single `/health` endpoint returns `{ status: 'OK' }` without distinguishing process liveness, readiness, and FBA consensus readiness.
   - *Phase 11 Fix*: Implement separate `/health/live`, `/health/ready`, and `/health/consensus` endpoints with proper HTTP status codes (`200` vs `503`).

5. **Backup & Disaster Recovery**:
   - No standardized snapshot or automated backup mechanism existed to archive SQLite, journals, and checkpoints while excluding private keys.
   - *Phase 11 Fix*: Implement `BackupManager.js` with SHA-256 manifests and isolated restore staging.

6. **Container & Service Packaging**:
   - Missing Dockerfile, docker-compose, and systemd / Windows service unit scripts for automated orchestration.
   - *Phase 11 Fix*: Provide a production Dockerfile, Compose files for single and 12-validator networks, and systemd/PowerShell scripts.

---

## 5. Verification Baseline

- **Backend Test Suites**: 32 suites, 449 passing tests.
- **Smart Contract Suites**: 1 suite, 20 passing tests.
- **Total Passing Tests**: 469 / 469 (100% green).
- **Execution Time**: $\sim 23\text{ seconds}$.
- **Regression Target**: Zero failures across all existing tests.

