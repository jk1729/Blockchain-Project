# PDSChain — Known Limitations, Host Environment Constraints & Operational Boundaries

## 1. Host Environment Constraints on Evaluation Machine

In accordance with strict engineering honesty, the following external runtimes were **not installed** on the local Windows evaluation machine during the Final Independent Verification Gate:

| Runtime / Subsystem | Exact Verification Command | Observed Result | Classification |
| :--- | :--- | :--- | :---: |
| **Docker Engine & Docker Compose** | `docker --version` | Exit code `1`: `'docker' is not recognized as an internal or external command, operable program or batch file.` | **BLOCKED (Host Runtime Unavailable)** — Container manifests (`Dockerfile`, `docker-compose.yml`, `docker-compose.network.yml`, `docker-compose.production.yml`) are statically validated (`VERIFIED`), but live container orchestration could not be executed on this Windows host. |
| **PostgreSQL Server & CLI** | `psql --version` | Exit code `1`: `'psql' is not recognized as an internal or external command, operable program or batch file.` | **BLOCKED / UNVERIFIED AT RUNTIME** — Sequelize PostgreSQL dialect, connection pooling (`DatabaseManager.js`), and production fail-fast validation (`DB_DIALECT=postgres` requires `DATABASE_URL`) are implemented and unit-tested (`PARTIALLY VERIFIED`), but a live PostgreSQL instance was not available on this host. Live persistence was verified on SQLite WAL (`database/pdschain.sqlite`). |

---

## 2. FBA Quorum Slice Safety vs. Liveness Analysis

1. **Why `9-of-12` Arithmetic Alone Does Not Guarantee FBA Finality**:
   - PDSChain configures 12 institutional validators (`VAL-01`..`VAL-12` / `V1`..`V12`) with **overlapping 4-member quorum slices (`threshold: 3`, i.e., `3-of-4`)** in `QuorumEngine` (`backend/src/consensus/Quorum.js`) plus a **`9-of-12` (`75%`) global finality threshold**.
   - A block is finalized **only** when `QuorumEngine.findQuorum(approvingSet, slices)` finds a survivor subset $Q \subseteq \text{Approvers}$ where **every** validator $v \in Q$ has at least $3$ of its $4$ slice peers inside $Q$, **and** $|Q| \ge 9$.
   - **Verified Example of 9 Approvals Refusing Finality (Safety Over Liveness)**:
     - `VAL-02`'s slice is `[VAL-02, VAL-03, VAL-05, VAL-06]` (`threshold: 3`).
     - When the 9 validators `{V1, V2, V3, V4, V8, V9, V10, V11, V12}` vote `ACCEPT` (so `V5, V6, V7` have not approved), `VAL-02` only has `{VAL-02, VAL-03}` (`2 < 3`) in the approving set.
     - `QuorumEngine.findQuorum` prunes `VAL-02`, leaving a surviving quorum of size `8 < 9`.
     - Even though `approvedCount === 9`, `quorumAchieved` is `false` and `POST /api/consensus/proposals/:id/finalize` refuses finality with `409 QUORUM_NOT_MET` until `V5` (or `V6`) votes `ACCEPT`.
2. **Byzantine Fault Tolerance Bound**:
   - With $N = 12$ and global finality threshold $9$, any two finalized quorums $Q_1, Q_2$ of size $\ge 9$ intersect in at least $|Q_1 \cap Q_2| \ge 9 + 9 - 12 = 6$ validators.
   - Under the standard BFT bound $N \ge 3f + 1$ ($f = 3$ for $N = 12$), even if $f = 3$ validators are arbitrarily Byzantine (equivocating), every pair of quorums still shares at least $6 - 3 = 3$ honest validators, preventing conflicting blocks from both achieving valid `ConsensusCertificate`s at the same height.

---

## 3. Local Multi-Process Demonstration vs. Genuinely Distributed Production Deployment

| Dimension | Local Demonstration (`VERIFIED` on this Host) | Distributed Production Deployment (`Requires Multi-Host Infrastructure`) |
| :--- | :--- | :--- |
| **Validator Process Isolation** | 12 independent Node.js OS child processes (`validatorWorker.js` on `127.0.0.1:4001..4012`, P2P `5001..5012`) with 12 distinct PIDs and isolated state directories (`database/validators/VAL-01..VAL-12/`). | 12 separate physical/cloud hosts or Kubernetes pods across independent institutional networks (`NIC`, `FCI`, `TNCSC`, `CAG`, etc.) communicating over mTLS/authenticated P2P WAN. |
| **Cryptographic Key Storage** | 12 unique Ed25519 keypairs stored in per-validator `identity.json` / AES-256-GCM keystores on the local disk. | Hardware Security Modules (HSM) or Cloud KMS per participating institution so no single host holds multiple validator keys. |
| **Database Engine** | SQLite 3 in Write-Ahead Logging (`WAL`) mode (`database/pdschain.sqlite`) with atomic Sequelize transactions and `DatabaseBackupManager` SHA-256 verified snapshots. | Dedicated PostgreSQL 16 HA cluster per institutional node with streaming replication and encrypted off-site backups. |
| **Authentication & Credentials** | Demo accounts (`v1`..`v12`, `admin`, `warehouse`, `shop`, `citizen`) provisioned for interactive faculty evaluation; validator private keys never leave the backend/validator processes. | Institutional SSO/mTLS + rotated high-entropy secrets (`JWT_SECRET >= 32 chars`, explicit `CORS_ORIGIN`, demo accounts disabled). |
