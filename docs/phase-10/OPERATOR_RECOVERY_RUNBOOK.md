# PDSChain Phase 10: Node Operator Recovery Runbook

## 1. Scope & Purpose

This operational runbook provides step-by-step procedures for validator node operators, network administrators, and devops engineers managing PDSChain institutional nodes (`VAL-01` through `VAL-12`). It outlines diagnostic workflows, error states, and mitigation actions for ledger recovery and synchronization events.

---

## 2. Sync & Recovery State Machine Reference

A node's current status is exposed via `GET /api/ledger/status` and visible in the Frontend Validator Telemetry Dashboard:

| State | Consensus Role | Description | Recommended Operator Action |
| :--- | :--- | :--- | :--- |
| `BOOTSTRAPPING` | Blocked | Initializing filesystem and loading configuration. | None. Transitory state (<100ms). |
| `RECOVERING` | Blocked | Reconciling SQLite, journal replay, and checkpoints. | None. Transitory state (<500ms). |
| `DISCOVERY` | Blocked | Polling peers for height and common ancestor. | If stuck >30s, verify peer firewalls / P2P ports. |
| `CATCHING_UP` | Blocked | Streaming and applying missing block batches. | Normal operation. Monitor progress bar. |
| `VERIFYING` | Blocked | Executing EVM state and verifying QC integrity. | Normal operation. CPU load may increase. |
| `CURRENT` | **Active** | Ledger is fully aligned with network head. | Node is voting and proposing normally. |
| `STALLED` | Blocked | Sync timeout exceeded or peers unresponsive. | Follow **Playbook 1: Stalled Sync Recovery**. |
| `HALTED` | Blocked | Local blockchain corruption or broken hash chain. | Follow **Playbook 2: Halted Node Recovery**. |
| `CORRUPTED` | Blocked | Conflicting block or checkpoint divergence detected. | Follow **Playbook 3: Divergence & Corruption**. |
| `RECOVERY_REQUIRED` | Blocked | Checkpoint ahead of local database height. | Follow **Playbook 4: State Inconsistency**. |

---

## 3. Observability & Diagnostic Toolkit

### 3.1 REST Observability Endpoints

Query the validator's local HTTP management port (e.g. port 3001 for `VAL-01`):

```bash
# Check overall ledger synchronization status
curl -s http://localhost:3001/api/ledger/status | jq .

# Inspect the canonical disk checkpoint
curl -s http://localhost:3001/api/ledger/checkpoint | jq .

# Inspect P2P sync telemetry and peer heights
curl -s http://localhost:3001/api/network/sync/status | jq .

# Query Prometheus metrics
curl -s http://localhost:3001/api/network/metrics | grep sync_
```

### 3.2 Key Telemetry Metrics

- `pdschain_sync_state`: Current sync state enum value.
- `pdschain_sync_progress_pct`: Percentage completed towards target network height ($0.00$ to $100.00$).
- `pdschain_sync_rejections_total`: Number of rejected or invalid batches.
- `pdschain_sync_timeouts_total`: Number of sync network timeouts.
- `pdschain_checkpoints_saved_total`: Count of atomically committed checkpoints.

---

## 4. Incident Playbooks

### Playbook 1: Stalled Sync Recovery (`STALLED`)
- **Symptoms**: State stays in `STALLED` or `DISCOVERY` for $>60$ seconds; `pdschain_sync_timeouts_total` increments.
- **Diagnostic Steps**:
  1. Check network connectivity: `curl http://localhost:3001/api/network/peers`
  2. Verify that peer count $\ge 1$. If 0, check inbound/outbound firewall rules for configured TCP ports (ports 9001–9012).
  3. Check peer heights: `curl http://localhost:3001/api/network/sync/status | jq .peers`
- **Resolution**:
  - If peer addresses changed, update `PEERS` configuration in environment.
  - Restart validator process using `processManager.restartValidator(validatorId)`.

### Playbook 2: Halted Node Recovery (`HALTED`)
- **Symptoms**: Node halts during startup; `GET /api/ledger/status` reports `HALTED`; logs show `Blockchain integrity check failed`.
- **Diagnostic Steps**:
  1. Inspect local SQLite database file: `database/validators/{validatorId}/pdschain.sqlite`.
  2. Check disk health and SQLite integrity:
     ```bash
     sqlite3 database/validators/VAL-01/pdschain.sqlite "PRAGMA integrity_check;"
     ```
- **Resolution**:
  - If database is corrupt due to hardware failure, rename `pdschain.sqlite` to `pdschain.sqlite.bak`.
  - Remove existing `checkpoints/checkpoint.json`.
  - Restart the validator. The node will re-enter `BOOTSTRAPPING` $\to$ `DISCOVERY` $\to$ `CATCHING_UP` and sync complete history from peer consensus nodes.

### Playbook 3: Divergence & Corruption (`CORRUPTED`)
- **Symptoms**: Node enters `CORRUPTED` state; error log displays `CHECKPOINT_MISMATCH` or `DIVERGENCE_DETECTED`.
- **Diagnostic Steps**:
  1. Query `GET /api/ledger/status` to determine the divergent height.
  2. Compare block hash at divergent height with consortium peer nodes:
     ```bash
     curl -s http://peer1:3001/api/ledger/checkpoint | jq .blockHash
     curl -s http://localhost:3001/api/ledger/checkpoint | jq .blockHash
     ```
- **Resolution**:
  > [!CAUTION]
  > Never force an automatic rollback or manually overwrite finalized blocks without consortium quorum consensus.
  - If the node was on an orphaned test fork, backup database and execute a clean resync from the network canonical genesis.
  - If the consortium peers are divergent, escalate immediately to consortium security leads for FBA partition analysis.

### Playbook 4: State Inconsistency (`RECOVERY_REQUIRED`)
- **Symptoms**: Node reports `RECOVERY_REQUIRED` on boot; error log: `Checkpoint height (X) is ahead of blockchain height (Y)`.
- **Diagnostic Steps**:
  1. Inspect `checkpoint.json`: `cat database/validators/{validatorId}/checkpoints/checkpoint.json`
  2. Inspect highest block in SQLite:
     ```bash
     sqlite3 database/validators/{validatorId}/pdschain.sqlite "SELECT MAX(height) FROM blocks;"
     ```
- **Resolution**:
  - This condition occurs if SQLite transaction commit failed after checkpoint creation.
  - If block store is healthy up to height $Y$, remove stale `checkpoint.json`. On restart, `LedgerRecoveryManager` will re-anchor checkpoint to height $Y$ and automatically trigger `CATCHING_UP` to sync blocks $Y+1 \dots X$.

### Playbook 5: Quarantined Journal Files (`.corrupt.<timestamp>`)
- **Symptoms**: A file named `consensus_journal.jsonl.corrupt.<timestamp>` is created in the validator's database directory.
- **Diagnostic Steps**:
  1. Inspect the trailing line in the `.corrupt` file:
     ```bash
     tail -n 5 database/validators/{validatorId}/consensus_journal.jsonl.corrupt.*
     ```
  2. Verify that the node cleanly created a new `consensus_journal.jsonl` with all valid preceding records.
- **Resolution**:
  - This is an automated self-healing action. No manual repair is necessary.
  - Retain the `.corrupt` file for 30 days for post-mortem analysis, then safely delete.

---

## 5. Graceful Maintenance & Upgrade Procedures

### Graceful Node Shutdown
To take a validator offline for system maintenance without triggering journal corruption:
```bash
# Send SIGTERM to allow WAL flush and socket closure
kill -15 <validator_pid>
# Wait 3-5 seconds for clean exit confirmation in validator.log
```

### Validator Restart & Health Check
```bash
# Restart validator
npm run validator:start -- --id VAL-01

# Confirm recovery progression
curl -s http://localhost:3001/api/ledger/status | jq .state
# Expected: "BOOTSTRAPPING" -> "RECOVERING" -> "CURRENT"
```

