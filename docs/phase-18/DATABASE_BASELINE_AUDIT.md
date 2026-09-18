# Phase 18: Production Database Baseline Audit

**Project**: PDSChain — Blockchain-Based Public Distribution System  
**Phase**: Phase 18 — Production Database Architecture  
**Stage**: Stage A — Production Database Baseline Audit  
**Date**: September 17, 2026  
**Status**: COMPLETE  

---

## 1. Executive Summary

This document establishes an exhaustive, end-to-end baseline audit of the persistence architecture across PDSChain as of Phase 17. The system currently uses a hybrid persistence model comprising:
1. **Relational Database (Sequelize / SQLite)**: Used for blockchain blocks, transaction records, master inventory entities (beneficiaries, shops, warehouses, commodities), and validator records.
2. **Append-Only JSONL Journals**: Used for high-throughput consensus state (`consensus_journal.jsonl`), blockchain and contract events (`events_journal.jsonl`), and cryptographic security audit trails (`security_audit.jsonl`).
3. **JSON State Checkpoints**: Used for ledger sync checkpoints (`checkpoint.json`).
4. **Encrypted Keystores & Identity Files**: Used for validator Ed25519 identity, TLS certificates, and AES-256-GCM encrypted keystores.
5. **In-Memory Derived Indexes**: Used for EVM state tries, Merkle proof indexing (`ProofIndexer`), and mempool candidate pools.

The audit identifies key architectural boundaries, authoritative versus derived data flows, concurrency assumptions, and operational limitations that Phase 18 must resolve.

---

## 2. Current Persistence Artifacts & File Locations

| Storage Component | Canonical File Location | Format | Classification | Authority Level |
| :--- | :--- | :--- | :--- | :--- |
| **Relational Database** | `database/pdschain.sqlite` (or `DATABASE_URL` via PostgreSQL) | SQLite / Postgres | Relational | **Authoritative (Blocks, Entities)** / Derived (Cached txs) |
| **Consensus Journal** | `database/consensus_journal.jsonl` or `database/validators/<VAL_ID>/consensus_journal.jsonl` | JSONL | Write-Ahead Log | **Authoritative (Consensus Rounds, Votes, Certs)** |
| **Events Journal** | `database/events_journal.jsonl` or `database/validators/<VAL_ID>/events_journal.jsonl` | JSONL | Append-Only Log | Derived / Operational Event Stream |
| **Security Audit Journal**| `database/security_audit.jsonl` | JSONL (SHA-256 Chained) | Audit Trail | **Authoritative (Security & Access Events)** |
| **Ledger Checkpoints** | `database/checkpoint.json` or `database/validators/<VAL_ID>/checkpoints/checkpoint.json` | JSON | Snapshot | **Authoritative (Finalized State Anchor)** |
| **Validator Identity** | `database/validators/<VAL_ID>/identity.json` | JSON | Identity | **Authoritative (Non-secret Public ID & Private Key)** |
| **Validator Keystores** | `database/validators/<VAL_ID>/keystore.json` | AES-256-GCM JSON | Keystore | **Authoritative (Encrypted Private Keys & Passphrases)** |
| **Validator PID Lock** | `database/validators/<VAL_ID>/validator.pid` | Plaintext PID | Process Guard | Operational Lock |
| **Validator Backups** | `database/validators/<VAL_ID>/backups/backup-<VAL_ID>-H<HEIGHT>-<TS>/` | Directory / Files | Disaster Recovery | Point-In-Time Snapshot |

---

## 3. Relational Schema & Model Inventory

Sequelize models currently reside in `backend/src/models/`:

### 3.1 `Block` (`blocks` table)
- **Primary Key**: `id` (INTEGER, AUTOINCREMENT)
- **Columns**: `version`, `blockNumber` (UNIQUE), `blockHash` (UNIQUE), `previousHash`, `timestamp`, `transactions` (JSON), `txCount`, `nonce`, `merkleRoot`, `stateRoot`, `proposerId`, `proposerAddress`, `proposerSignature` (TEXT), `proposalId`, `round`, `consensusStatus`, `consensusCertificate` (JSON), `validatorSignatures` (JSON), `createdAt`, `updatedAt`.
- **Authoritative**: YES. Represents authoritative committed blocks.
- **Current Limitations**: Lacks explicit receipt roots, lacks automated immutable triggers at the database engine level, uses JSON blob for transactions instead of normalized foreign key relations.

### 3.2 `Transaction` (`transactions` table)
- **Primary Key**: `id` (INTEGER, AUTOINCREMENT)
- **Columns**: `transactionId` (UNIQUE), `beneficiaryId`, `beneficiaryName`, `shopId`, `commodity`, `quantity` (FLOAT), `unit`, `blockNumber`, `blockHash`, `hash`, `fbaValidators`, `fbaConsensus`, `status` (`Pending`, `Verified`, `Rejected`), `timestamp`, `remarks`, `createdAt`, `updatedAt`.
- **Authoritative**: Derived query cache of transactions included within blocks.
- **Current Limitations**: `quantity` stored as FLOAT (potential floating-point precision hazards); status update does not have foreign key cascade to block.

### 3.3 System Master Entities
- `User` (`users` table): `id`, `name`, `aadhaar`, `role`, `rationCardType`, `familyMembers`, `contactNumber`, `address`, `password` (hashed), `isActive`, `lastLogin`.
- `Beneficiary` (`beneficiaries` table): `beneficiaryId` (UNIQUE), `name`, `rationCardType`, `monthlyQuota`, `claimedQuota`, `active`.
- `Shop` (`shops` table): `shopId` (UNIQUE), `name`, `allocatedStock`, `distributedStock`, `active`.
- `Warehouse` (`warehouses` table): `warehouseId` (UNIQUE), `name`, `capacity`, `currentStock`, `active`.
- `Commodity` (`commodities` table): `commodityId` (UNIQUE), `name`, `standardQuota`, `unit`, `active`.
- `Inventory` (`inventories` table): `shopId`, `commodity`, `quantity`, `unit`, `lastUpdated`.
- `StockTransfer` (`stock_transfers` table): `transferId`, `sourceWarehouseId`, `destinationShopId`, `commodity`, `quantity`, `status`.
- `Validator` (`validators` table): `id`, `validatorId` (UNIQUE), `name`, `institution`, `ip`, `port`, `publicKey`, `active`, `reputationScore`, `totalBlocksProposed`, `totalVotesCast`.

---

## 4. Transaction Boundaries & Write Ordering

### 4.1 Block Finalization Pipeline
1. **Consensus Agreement**: 12 validators exchange signed votes in round $r$ of FBA.
2. **Quorum Certificate Formation**: 9-of-12 signatures form `ConsensusCertificate`.
3. **Execution & Root Calculation**: State transition executes in memory; `merkleRoot`, `stateRoot`, `receiptsRoot` computed.
4. **Relational Block Commit**:
   - `sequelize.transaction(async (t) => { ... })` opens a database transaction.
   - `BlockModel.create(newBlock.toJSON(), { transaction: t })` writes to `blocks`.
   - `TransactionModel.create(...)` records each verified transaction in `transactions`.
   - `Inventory` balances updated in relational tables.
5. **Post-Commit Asynchronous Tasks**:
   - `mempool.removeIncludedTransactions(...)` purges committed txs from RAM.
   - `proofIndexer.indexBlock(newBlock)` updates in-memory Merkle tree index.
   - `eventBus.emit(...)` emits events and appends to `events_journal.jsonl`.
   - `checkpointManager.createCheckpoint(...)` writes atomic JSON checkpoint.

### 4.2 Write Ordering Gap Analysis
- If the node crashes between the relational commit (step 4) and the checkpoint/journal append (step 5), the database is ahead of the checkpoint.
- `LedgerRecoveryManager` currently reconciles this by inspecting `blockchain.chain.length` against the checkpoint height, but lacks formal write-ahead logging (WAL) coordination between SQLite and JSONL files.

---

## 5. Concurrency & Connection Assumptions

1. **SQLite Concurrency**:
   - Default SQLite connection uses `delete` or `rollback` journal mode, which acquires exclusive locks on writes, blocking concurrent reads.
   - Phase 18 must configure `WAL` (Write-Ahead Logging) mode: `PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA busy_timeout=5000;`.
2. **Process Isolation**:
   - In Phase 9–11 multi-process topologies, each validator process runs in its own isolated directory (`database/validators/<VAL_ID>/`) with its own SQLite file. This completely eliminates cross-process SQLite file-lock collisions.
   - However, query and explorer nodes connecting to a shared database need bounded connection pools and statement timeouts.

---

## 6. Migration & Integrity Baseline

- **Current Migration Tooling**: Simple `001_initial_schema.js` running `sequelize.sync({ alter: false })`.
- **Gaps Identified**:
  - No versioned migration history table (`schema_migrations`).
  - No checksum verification of migration scripts.
  - No dry-run validation mode.
  - No database-level immutability triggers (finalized blocks can technically be updated via direct SQL if an operator accesses SQLite directly).

---

## 7. Operational Limitations & Target Requirements for Phase 18

| Limitation | Impact | Phase 18 Target Solution |
| :--- | :--- | :--- |
| **No WAL Mode in SQLite by Default** | Read/write lock contention under explorer load | Enforce `PRAGMA journal_mode=WAL` and `busy_timeout=5000` |
| **Floating-Point Storage** | `quantity` stored as FLOAT in `transactions` | Use high-precision DECIMAL or integer units |
| **No Normalized Receipts Table** | Receipts only inferred from transaction payloads | Create dedicated `receipts` table with `receiptHash`, `gasUsed`, and logs |
| **No Database-Level Finality Guard** | Direct SQL can mutate finalized blocks | Add Sequelize model lifecycle hooks (`beforeUpdate`, `beforeDestroy`) + `DatabaseIntegrityManager` |
| **Unversioned Migrations** | `sequelize.sync` cannot handle complex rolling updates | Implement `DatabaseMigrationManager` with checksums and audit table |
| **Lack of Encrypted Backup Verification** | Backups are plaintext snapshots | Implement AES-256 backup encryption with detached SHA-256 manifests |
| **No Connection Pool Limits** | Unbounded connections risk database exhaustion | Implement `DatabasePool` with bounded active/idle pools and health metrics |

