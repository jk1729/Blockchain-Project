# PDSChain Phase 10: Stage A — Baseline Architecture & Integration Audit

## 1. Executive Summary

This document establishes the architectural baseline audit for **Phase 10: Ledger Synchronization and Recovery**. Prior to introducing new ledger recovery and synchronization components, the existing codebase was verified against the full regression suite:

- **Backend Test Suites**: 25 passed, 25 total
- **Backend Tests**: 399 passed, 399 total
- **Solidity / Hardhat Tests**: 20 passed, 20 total
- **Combined Test Baseline**: **419 / 419 passing tests** with 0 regressions and 0 failures.

---

## 2. Audit of Existing Synchronization & Recovery Surfaces

### 2.1 Finalized Height Tracking
- **Location**: `Blockchain.js` (`getLatestBlock()`, `chain.length - 1`), `models/Block.js` (`blockNumber`).
- **Current Behavior**:
  - Blocks are sequentially indexed starting from Genesis at height `0`.
  - In-memory height is determined by the last element in `this.blockchain.chain`.
  - In `validatorProcess.js`, `blockHeight` is reported from `this.blockchain.getLatestBlock().blockNumber`.
- **Gaps Identified for Phase 10**:
  - No explicit concept of separate "committed height", "finalized height", and "verified height".
  - No tracking of target network heights or peer heights within the blockchain core.

### 2.2 Local Chain Persistence Model
- **Location**: `models/Block.js` (Sequelize SQLite model), `database/validators/{validatorId}/pdschain.sqlite`.
- **Current Behavior**:
  - Individual blocks are persisted to the `blocks` table with fields for hashes, timestamps, transactions JSON, state roots, and consensus certificates.
  - Multi-process validators maintain physically separated SQLite database files per validator directory.
- **Gaps Identified for Phase 10**:
  - Lacks atomic multi-block batch transactions for range synchronization.
  - No crash staging table or rollback recovery journal for interrupted block ingestion.

### 2.3 Existing Block Validation Behavior
- **Location**: `validation.js` (`validateBlock`, `validateBlockStateRoot`, `validateBlockConsensusCertificate`, `validateChain`), `FinalityEngine.js` (`evaluateFinality`).
- **Current Behavior**:
  - Cryptographic verification checks Merkle roots, proposer Ed25519 signatures, previousHash linkage, and ConsensusCertificate validity (with 9-of-12 threshold and quorum slice verification).
- **Gaps Identified for Phase 10**:
  - Ingestion during synchronization does not execute transactions through the embedded EVM runtime to verify whether the executed state root and receipts root match the block header commitments.

### 2.4 Existing SyncHandler Request/Response Behavior
- **Location**: `backend/src/network/handlers/SyncHandler.js`.
- **Current Behavior**:
  - `handleSyncRequest(envelope, peerConn)`: queries local in-memory chain for `[fromHeight, toHeight]` up to `maxBlocks` (default 50) and responds with `SYNC_RESPONSE`.
  - `handleSyncResponse(envelope, peerConn)`: checks height continuity (`latest.blockNumber + 1`), checks `previousHash`, verifies `ConsensusCertificate`, constructs a new `Block`, and pushes to `this.blockchain.chain`.
- **Gaps Identified for Phase 10**:
  - Only supports querying a single peer; lacks multi-peer height comparison and quorum agreement.
  - No request/response correlation IDs or tracking of pending requests.
  - Does not support chunked responses, end-of-range markers, or batch checksums.
  - Does not commit blocks atomically in verified batches.

### 2.5 Current Restart and Journal Replay Behavior
- **Location**: `backend/src/consensus/ConsensusJournal.js`.
- **Current Behavior**:
  - Appends JSON lines to `consensus_journal.jsonl` for events: `VOTE_CAST`, `VOTE_RECORDED`, `ROUND_CHANGE`, `BLOCK_FINALIZED`.
  - `recoverState()`: reads lines and skips malformed records with `try { JSON.parse(l) } catch (e) { return null; }`.
- **Gaps Identified for Phase 10**:
  - Silently discards corrupt or truncated journal records without quarantining or alerting.
  - Does not detect height mismatches between the journal and the database.
  - Does not distinguish active unfinalized rounds from finalized commitments during node reboot.

### 2.6 Handling of Incomplete Blocks or Interrupted Writes
- **Current Behavior**:
  - No write-ahead staging file or temporary atomic rename for block writes.
  - If a process terminates mid-sync, previously appended blocks remain in the database, but no checkpoint tracks whether the EVM state was committed for that block.
- **Gaps Identified for Phase 10**:
  - Need durable checkpointing (`checkpoint.json`) with atomic `.tmp` swap.
  - Need `LedgerRecoveryManager` on startup to detect and repair inconsistencies between DB, journal, EVM state, and checkpoint.

### 2.7 Existing Observability and Frontend Sync Indicators
- **Location**: `backend/src/controllers/networkController.js`, `frontend/js/validator.js`, `frontend/html/validator/validator.html`.
- **Current Behavior**:
  - Exposes peer status, metrics, and topology.
  - Frontend displays validator node port indicators and peer counts.
- **Gaps Identified for Phase 10**:
  - No explicit endpoint for `/api/network/sync/status` or `/api/ledger/status`.
  - Frontend lacks real-time synchronization progress, EVM verification status, and consensus-readiness indicators.

---

## 3. Baseline Test Evidence

Command: `npm test`
Result:
```text
Test Suites: 25 passed, 25 total
Tests:       399 passed, 399 total
Snapshots:   0 total
Time:        20.645 s
```

Command: `npx hardhat test`
Result:
```text
  20 passing (2s)
```

**Total baseline: 419 / 419 passing tests.**

