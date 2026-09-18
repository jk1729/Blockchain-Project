# Phase 18: Production Database Architecture Specification

**Project**: PDSChain — Blockchain-Based Public Distribution System  
**Phase**: Phase 18 — Production Database Architecture  
**Stage**: Stage B — Target Production Database Architecture  
**Date**: September 17, 2026  
**Status**: COMPLETE  

---

## 1. Architectural Principles & Invariants

The PDSChain Production Database Architecture is governed by four core zero-trust principles:

1. **Absolute Ledger Immutability**: Finalized blocks, transactions, receipts, consensus certificates, and Merkle roots cannot be altered, replaced, or deleted by any application user, API client, database administrator, or migration script.
2. **Strict Separation of Concerns**: Authoritative ledger persistence is strictly decoupled from derived query indexes, operational peer state, security audit logging, and sensitive cryptographic identity storage.
3. **Fail-Closed Consensus Durability**: An authoritative ledger write failure causes the node to halt or fail closed immediately. Conversely, a failure in a secondary query index or analytics cache never corrupts or invalidates the authoritative ledger.
4. **Monotonic Finality Ordering**: Finalized block height must be monotonically increasing ($H_{new} = H_{current} + 1$). Height regressions, fork overwrites, or conflicting blocks at the same height are strictly rejected.

```
+---------------------------------------------------------------------------------------+
|                                    PDSCHAIN NODE                                      |
+---------------------------------------------------------------------------------------+
                                           |
                                           v
               +-------------------------------------------------------+
               |               Database Routing & Safety               |
               |                (DatabaseManager.js)                   |
               +-------------------------------------------------------+
                     /                     |                    \
                    /                      |                     \
                   v                       v                      v
      +-------------------------+  +----------------+  +---------------------+
      | 1. Authoritative Store  |  | 2. Derived     |  | 3. Security & Audit |
      | (Validator-Local SQLite)|  |    Index Store |  |    Storage          |
      +-------------------------+  | (SQLite / PG)  |  +---------------------+
      | - Finalized Blocks      |  +----------------+  | - SHA-256 Chained   |
      | - Block Headers         |  | - Address Idx  |  |   Audit Journal     |
      | - Receipts & Roots      |  | - Tx Search Idx|  | - Auth Failures     |
      | - Consensus Certs       |  | - Proof Index  |  | - Break-Glass Logs  |
      | - Checkpoints           |  | - Explorer Aggs|  | - Zero Secrets      |
      +-------------------------+  +----------------+  +---------------------+
                   |                                              |
                   v                                              v
      +-------------------------+                      +---------------------+
      | 4. Operational State    |                      | 5. Identity/Keystore|
      | - Peer Status & CRL     |                      | - AES-256-GCM       |
      | - Sync Progress         |                      | - Strict Isolation  |
      | - Rate Limit Quotas     |                      | - Memory Zeroing    |
      +-------------------------+                      +---------------------+
```

---

## 2. Storage Tier Classification

### Tier 1: Validator-Local Authoritative Storage
- **Primary Engine**: SQLite with Write-Ahead Logging (`PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA busy_timeout=5000;`).
- **Data Contents**:
  - `blocks`: Canonical blocks with Merkle roots, state roots, and proposer signatures.
  - `receipts`: Canonical execution receipts, status codes, gas consumed, and logs.
  - `consensus_certificates`: Cryptographic 9-of-12 validator approval records.
  - `checkpoints`: Finalized height anchors with state commitments.
  - `consensus_journal.jsonl`: Write-ahead log for round proposals and prevotes.
- **Authority**: **AUTHORITATIVE**. Bit-for-bit canonical truth.
- **Consistency**: Strict Serializability.
- **Failure Policy**: If write fails $\rightarrow$ Consensus halts, transaction reverts, node enters `RECOVERY_REQUIRED`.

### Tier 2: Query & Index Storage
- **Supported Engines**: SQLite read replicas or PostgreSQL read cluster.
- **Data Contents**:
  - `address_activity`: Inverted index of transactions by sender, receiver, and shop.
  - `contract_logs`: Filterable index of decoded EVM events by topic and contract address.
  - `merkle_proof_index`: Fast in-memory/on-disk lookup from hash to `(blockHeight, leafIndex)`.
  - `explorer_summaries`: Rolling 24h metrics, TPS, active validators, commodity distribution totals.
- **Authority**: **DERIVED**. Can be discarded and 100% deterministically rebuilt from Tier 1 at any time.
- **Consistency**: Eventual consistency (maximum allowable lag: $< 250$ms).
- **Failure Policy**: If write or query fails $\rightarrow$ Returns degraded status or cache miss; Tier 1 remains completely unharmed.

### Tier 3: Operational State Storage
- **Supported Engines**: SQLite / Redis / In-Memory with periodic disk flushing.
- **Data Contents**:
  - `peer_state`: Connected peer IPs, latency, protocol versions, CRL status.
  - `sync_sessions`: Active block download batches, peer response timeouts.
  - `rate_limits`: Sliding window request counters.
- **Authority**: **OPERATIONAL (EPHEMERAL)**. Reconstructed on node startup.
- **Consistency**: Weak / Eventual consistency.
- **Failure Policy**: Degraded network routing or rate-limiting reset; zero impact on ledger validity.

### Tier 4: Security & Audit Storage
- **Engine**: Append-Only Hash-Chained Journal (`security_audit.jsonl`) + relational audit log table.
- **Data Contents**:
  - Authentication attempts, authorization denials (IDOR/BOLA), break-glass activations, key rotations, peer whitelisting changes, backup/restore invocations.
  - SHA-256 hash chaining: $\text{entryHash} = \text{SHA256}(\text{previousEntryHash} + \dots)$.
- **Authority**: **AUTHORITATIVE (FORENSIC)**.
- **Consistency**: Immediate synchronous write before returning privileged API responses.
- **Failure Policy**: If audit append fails $\rightarrow$ Privileged operation aborts (Fail Closed).

### Tier 5: Cryptographic Identity & Keystores
- **Engine**: Encrypted Flat Files (`keystore.json`, `identity.json`).
- **Security**: AES-256-GCM encryption with Argon2id / PBKDF2 derived keys.
- **Storage Rules**: **STRICTLY EXCLUDED** from relational databases, query caches, backups, logs, and error envelopes.

---

## 3. Database Engine Selection Matrix

| Workload Role | Engine Choice | Rationale | Durability Settings |
| :--- | :--- | :--- | :--- |
| **Validator Node Consensus** | SQLite (WAL mode) | Zero network hops, sub-millisecond local disk latency, strictly isolated per-validator process. No external database daemon dependency. | `journal_mode=WAL`, `synchronous=NORMAL`, `busy_timeout=5000` |
| **Consortium Explorer / Gateway** | PostgreSQL | Multi-tenant concurrent read scalability, complex SQL filtering, connection pooling, enterprise monitoring. | `sslmode=verify-full`, `statement_timeout=10000`, `idle_in_transaction_session_timeout=5000` |
| **Edge / Mobile Light Client** | In-Memory / Ephemeral SQLite | Read-only verification of Merkle proofs; zero persistent footprint required. | `mode=memory` |

---

## 4. Cross-Database Consistency & Reconciliation

When a secondary query store (Tier 2) or analytical replica is maintained alongside the authoritative validator store (Tier 1):

1. **Reconciliation Job**:
   - `DatabaseIntegrityManager` runs every 60 seconds (or on recovery).
   - Verifies that `max(Tier 2 blockNumber) <= max(Tier 1 blockNumber)`.
   - Compares the `blockHash` of the highest common height.
   - If a mismatch is detected, Tier 2 drops records $> H_{mismatch}$ and triggers an asynchronous resync from Tier 1.
2. **Finality Gating**:
   - Query APIs inspecting Tier 2 must never report a block as `FINALIZED` unless its `consensusCertificate` exists in Tier 1 and quorum $\ge 9/12$ is verified.

