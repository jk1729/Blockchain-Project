# Phase 20: Recovery and Remediation Validation Runbook

**Document Reference:** `docs/phase-20/RECOVERY_VALIDATION_RUNBOOK.md`  
**Phase:** 20 — Attack and Failure Simulation  
**Status:** Approved & Implemented  
**Date:** September 2026  

---

## 1. Overview & Purpose

This operational runbook documents validated recovery and remediation procedures for PDSChain node operators, site reliability engineers (SREs), and consortium administrators. Every procedure in this runbook corresponds to a deterministic recovery workflow verified by Phase 20 simulation scenarios.

All recovery workflows require explicit verification of post-recovery invariants—such as ledger height monotonicity, sequence continuity, and database atomicity—before restoring live production traffic.

---

## 2. Recovery Procedures

### 2.1 Byzantine Slashing & Isolation (`#byzantine-slashing`)
- **Trigger Scenario**: `CONSENSUS-001` (Double-Voting Equivocation)
- **Symptom**: Alert `PdsConsensusByzantineBehavior` firing; `ConflictDetector` logs `CONFLICTING_DOUBLE_VOTE`.
- **Automated Mitigation**:
  1. The node drops the conflicting vote immediately and refuses to include it in the round state machine.
  2. The equivocating validator's ID is flagged in the consortium blacklist.
- **Operator Verification Steps**:
  1. Query `/api/v1/consensus/status` to verify current active validators and blacklist status.
  2. Verify that finalized block height continues to increase without equivocator participation.
  3. Confirm that the finalized block hash matches consortium majority.

### 2.2 Quorum Recovery After Validator Crash (`#validator-rejoin`)
- **Trigger Scenario**: `CONSENSUS-003` (Validator Crash & Quorum Loss)
- **Symptom**: Alert `PdsConsensusStallAlert` firing; `/health/ready` returns 503; consensus rounds timing out.
- **Recovery Workflow**:
  1. Restart offline validator node process:
     ```bash
     npm run start:validator -- --id=validator-3
     ```
  2. The returning validator establishes peer connections and initiates catch-up ledger synchronization (`GET /api/v1/ledger/sync`).
  3. Once local height matches consortium tip, validator casts `PREPARE` and `COMMIT` votes.
  4. Quorum is restored (>= 3/4 validators active).
- **Post-Recovery Invariant Verification**:
  - `InvariantMonitor.assertMonotonicHeight(preCrashHeight, postRecoveryHeight)`: MUST pass.
  - `InvariantMonitor.assertSequenceContinuity()`: No missing block sequence numbers.

### 2.3 HA Writer Fencing Promotion (`#writer-promotion`)
- **Trigger Scenario**: `CONSENSUS-004` (Stale Writer Split-Brain Defense)
- **Symptom**: Alert `PdsDbStaleWriterAttempt` firing; logs show `WRITER_FENCING_REJECTED`.
- **Recovery Workflow**:
  1. Inspect active writer fencing token via database HA manager:
     ```bash
     curl -H "Authorization: Bearer $OPERATOR_TOKEN" http://localhost:5000/api/v1/database/status
     ```
  2. Promote candidate node with incremented monotonic fencing token ($T_{new} = T_{old} + 1$).
  3. Demoted node steps down to read-replica mode, shedding in-flight writes.
- **Post-Recovery Invariant Verification**:
  - Candidate writer commits with $T_{new}$.
  - Demoted node write attempts are rejected with `E_WRITER_FENCING_REJECTED`.

### 2.4 Peer Mesh Reconnection (`#peer-reconnect`)
- **Trigger Scenario**: `NETWORK-001` (Peer Disconnect & Mesh Partition)
- **Symptom**: Alert `PdsPeerMeshDegraded` firing; peer count drops below configured threshold.
- **Recovery Workflow**:
  1. `PeerConnectionManager` initiates exponential backoff reconnection loop (1s, 2s, 4s up to max 30s).
  2. Validates TLS certificate and public key identity during handshake.
  3. Transitions peer state from `DISCONNECTED` -> `RECONNECTING` -> `CONNECTED`.
- **Post-Recovery Verification**:
  - Check peer status: `curl http://localhost:5000/api/v1/network/peers`
  - Assert active peer count matches expected mesh topology.

### 2.5 Corrupt Consensus Journal Quarantine & Replay (`#journal-replay`)
- **Trigger Scenario**: `DATABASE-002` (Corrupt Journal Line Quarantine)
- **Symptom**: Alert `PdsJournalCorruptionQuarantined` firing; log warning `Corrupted journal entry isolated`.
- **Recovery Workflow**:
  1. `JournalStorageManager` automatically appends the corrupt line into `journal.log.corrupt` alongside timestamp and byte offset.
  2. Valid preceding and subsequent lines are processed without aborting consensus.
  3. Operator inspects `.corrupt` sidecar file to audit cause (disk fault, bit-rot, or ungraceful shutdown).
- **Post-Recovery Verification**:
  - Verify authoritative ledger matches finalized state:
    ```bash
    npm run verify:ledger-integrity
    ```

### 2.6 Encrypted Backup Restoration & Verification (`#backup-restore`)
- **Trigger Scenario**: `RECOVERY-001`, `RECOVERY-002`, `RECOVERY-003`
- **Symptom**: Primary storage corrupted or catastrophic host failure.
- **Recovery Workflow**:
  1. Stage candidate backup bundle in isolated temporary sandbox:
     ```bash
     mkdir -p /tmp/pdschain-restore-stage
     ```
  2. Verify cryptographic SHA-256 checksum against manifest signature.
  3. Decrypt bundle using AES-256-GCM decryption key and verify 16-byte authentication tag.
  4. Validate chain ID, network ID, and genesis hash compatibility.
  5. Promote staged database to live path (`pdschain.db`).
  6. Restart server daemon and execute health check:
     ```bash
     curl http://localhost:5000/health/ready
     ```
- **Post-Recovery Verification**:
  - RPO = 0 blocks lost (if restoring from synchronized replica snapshot).
  - Assert monotonic height and block hash integrity across all restored blocks.

### 2.7 Database Connection Pool Recovery (`#db-pool`)
- **Trigger Scenario**: `DATABASE-003` (Connection Pool Exhaustion)
- **Symptom**: Alert `PdsDbPoolExhaustion` firing; `/health/ready` returns 503; request timeouts.
- **Recovery Workflow**:
  1. Check active vs waiting queries: `GET /api/v1/database/metrics`.
  2. Identify and terminate long-running leaked queries or uncommitted transactions exceeding 30s timeout.
  3. Connection pool releases handles; waiting queue drains.
  4. Health probe `/health/ready` automatically transitions from 503 to 200.

### 2.8 Mempool Transaction Backpressure Drain (`#mempool-drain`)
- **Trigger Scenario**: `RESOURCE-001` (Mempool Saturation)
- **Symptom**: Mempool capacity reached (100% full); incoming client transactions rejected with HTTP 429.
- **Recovery Workflow**:
  1. Validators continue proposing blocks, packaging transactions into candidate blocks.
  2. Mempool size drains as transactions transition from `PENDING` -> `COMMITTED`.
  3. Backpressure is released; new transaction submissions resume.

