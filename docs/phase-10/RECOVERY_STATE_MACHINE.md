# PDSChain Phase 10: Ledger Recovery State Machine

## 1. Lifecycle State Machine Diagram

```
                 +-------------------+
                 |   BOOTSTRAPPING   |
                 +---------+---------+
                           |
             +-------------+-------------+
             |                           |
             v                           v
     +---------------+           +---------------+
     |    SYNCING    |           |   VERIFYING   |
     +-------+-------+           +-------+-------+
             |                           |
             v                           v
     +---------------+           +---------------+
     |  CATCHING_UP  | --------> |    CURRENT    |
     +-------+-------+           +-------+-------+
             |                           |
             v                           v
     +---------------+           +---------------+
     |   DEGRADED    |           |RECOVERY_REQ/  |
     |               |           |    HALTED     |
     +---------------+           +---------------+
```

---

## 2. Enumerated States & Semantics

| State | Consensus Participation | Description |
|---|---|---|
| `BOOTSTRAPPING` | Blocked | Initial node boot, reading database and journal files. |
| `SYNCING` | Blocked | Range requests in progress with peer validators. |
| `VERIFYING` | Blocked | Executing EVM simulation & checking Merkle roots. |
| `CATCHING_UP` | Blocked | Processing final delta blocks close to network tip. |
| `CURRENT` | **Enabled** | Fully synchronized, verified, and active in FBA consensus. |
| `DEGRADED` | Blocked | Transient peer loss or slow sync with high latency. |
| `RECOVERY_REQUIRED` | Blocked | Conflicting checkpoint or fork detected; manual review required. |
| `CORRUPTED` | Blocked | Checkpoint or chain hash integrity check failed. |
| `HALTED` | Blocked | Node paused by supervisor due to fatal divergence. |

---

## 3. Transition Invariants

1. **Gated `CURRENT` State**:
   - `transitionTo(CURRENT)` is strictly rejected unless `verificationStatus === 'PASSED'`, `stateRootStatus !== 'MISMATCH'`, and `localFinalizedHeight >= targetHeight`.
2. **Crash & Divergence Safeguard**:
   - Any detected chain inconsistency or corrupted previousHash link causes immediate transition to `HALTED`.
3. **Immutability of Finalized State**:
   - Finalized heights can only increase monotonically. Any attempt to roll back finalized state throws an error and blocks consensus participation.

