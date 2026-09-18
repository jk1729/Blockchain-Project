# PDSChain Phase 10: Byzantine Recovery & Adversarial Threat Rules

## 1. Threat Model & Adversarial Assumptions

During ledger synchronization, a recovering or lagging node must communicate over the P2P network with remote peers. Even in an authenticated consortium network with mutual Ed25519 transport, individual validator nodes may be:
- Compromised by an external attacker.
- Misconfigured or running corrupted state.
- Maliciously attempting to fork, stall, partition, or eclipse the recovering node.

PDSChain enforces the **Zero-Trust Synchronization Axiom**:
> *Transport-level authentication identifies the sender; it never certifies the truth of the ledger payload. Every block, batch, header, and checkpoint received from a peer must undergo strict cryptographic verification before committing to the local ledger.*

---

## 2. Adversarial Attack Vectors & Defensive Rules

### Vector 1: Height Inflation & Denial of Service (DoS)
- **Attack**: A malicious peer advertises an astronomical height (e.g. $H=1,000,000$ when the network is at $H=250$) to trick the recovering node into allocating memory, requesting non-existent blocks, or remaining stuck in `SYNCING` state indefinitely.
- **Rule & Defense**:
  - `SyncPlanner` requires multi-peer height agreement ($\ge 2$ independent peers agreeing on height) before accepting a target height.
  - If peers report divergent heights, `SyncPlanner` selects the quorum-bounded median/consensus height.
  - Sync batch range requests are strictly bounded ($20$ blocks maximum per batch).
  - Sync timeout watchdog aborts unresponsive or stalling sync cycles.

### Vector 2: Checkpoint Forgery & Conflicting State Root
- **Attack**: A Byzantine peer sends a checkpoint claiming a different block hash or EVM state root at a height already finalized locally.
- **Rule & Defense**:
  - `CheckpointManager.verifyAgainstBlock()` checks the local finalized block header against the checkpoint.
  - If $H \le H_{\text{local}}$ and `checkpoint.blockHash !== localBlock.hash`, the node triggers `CHECKPOINT_MISMATCH`.
  - The node transitions to `CORRUPTED` and refuses consensus participation rather than accepting the conflicting checkpoint.

### Vector 3: Chain Reorganization / Rollback Attacks
- **Attack**: A peer provides an alternate chain history that diverges at height $H_{\text{fork}} < H_{\text{local}}$, requesting the node to wipe its local blocks and adopt the peer's branch.
- **Rule & Defense**:
  - **PDSChain Absolute Finality Invariant**: Finalized blocks with a 9-of-12 Quorum Certificate are mathematically irreversible.
  - `SyncPlanner.findCommonAncestor()` tests ancestor hashes against local SQLite blocks.
  - If the common ancestor is before local finalized height or if Genesis blocks differ, `DIVERGENCE_DETECTED` is thrown. The local chain is never rolled back or truncated.

### Vector 4: Non-Contiguous Block Injection (Gap Attack)
- **Attack**: An attacker sends a batch skipping block heights (e.g. delivering blocks 10, 11, 14, 15) to create gaps in the relational block store.
- **Rule & Defense**:
  - `SyncHandler` validates continuous sequential progression:
    $$\text{block}[i].\text{height} === \text{lastHeight} + 1$$
  - Any non-contiguous block halts batch application immediately without applying subsequent blocks.

### Vector 5: Transaction Tampering & Merkle Root Forgery
- **Attack**: An attacker alters transaction parameters (e.g. diverting rations, changing beneficiary IDs) while keeping the outer block header identical.
- **Rule & Defense**:
  - `SyncHandler` recomputes the SHA-256 Merkle root from the raw transaction array via `calculateMerkleRoot()`.
  - If `recalculatedRoot !== block.merkleRoot`, the block is rejected with `INVALID_BLOCK_HASH`.

### Vector 6: EVM State Root Falsification
- **Attack**: An attacker constructs a valid block structure but injects a falsified `stateRoot` or `receiptRoot` to bypass smart contract execution.
- **Rule & Defense**:
  - `SyncHandler` executes every transaction through `@ethereumjs/vm` in Cancun configuration.
  - The resultant post-execution EVM state root and receipt root are checked against `block.stateRoot` and `block.receiptRoot`.
  - Any mismatch triggers `INVALID_EXECUTION_ROOT` and discards the batch.

### Vector 7: Batch Checksum Tampering
- **Attack**: An in-flight tampering attack alters block contents inside a batch while keeping envelope fields identical.
- **Rule & Defense**:
  - `RANGE_RESPONSE` envelopes include an authoritative `batchChecksum`:
    $$\text{batchChecksum} = \text{SHA256}(\text{blockHashes.join(':')})$$
  - `SyncHandler` verifies the checksum before parsing individual blocks. A mismatched checksum rejects the entire batch in $O(1)$ time.

---

## 3. The 14-Point Sync Verification Pipeline

Every batch received during synchronization is processed through the 14-point pipeline:

```
Incoming RANGE_RESPONSE
         │
 1. [Envelope Integrity & Ed25519 Signature Check]
 2. [Batch Length Guard: 1 <= count <= 20]
 3. [Batch Checksum Match: SHA256(hashes) == batchChecksum]
         │
         ▼  (For each block in batch)
 4. [Height Continuity Check: height == current + 1]
 5. [Cryptographic Block Hash Check: calculateHash(block) == block.hash]
 6. [Previous Hash Continuity: previousHash == prevBlock.hash]
 7. [Timestamp Monotonicity: timestamp >= prevBlock.timestamp]
 8. [Transaction Syntax & Schema Validation]
 9. [Merkle Root Recalculation: calculateMerkle(txs) == block.merkleRoot]
10. [EVM Execution: verify stateRoot == postStateRoot]
11. [EVM Execution: verify receiptRoot == postReceiptRoot]
12. [Quorum Certificate Verification: 9-of-12 institutional signatures]
         │
         ▼
13. [Multi-Peer Height Consensus Anchor Validated]
14. [Atomic SQLite Database Commit: COMMIT TRANSACTION]
         │
         ▼
    [Persist Checkpoint & Advance LedgerSyncState]
```

If any step fails, the entire batch is rolled back atomically (`ROLLBACK TRANSACTION`), ensuring zero dirty state reaches the database.

---

## 4. Peer Rotation & Quarantine Policy

When a peer violates the verification rules:
1. **Immediate Batch Abort**: The active sync batch terminates immediately.
2. **Peer Rotation**: `SyncPlanner.rotatePeer()` deprioritizes the failing peer and redirects range requests to alternative authenticated peers.
3. **Metric Increment**: The `sync_rejections_total` and `sync_timeouts_total` metrics are recorded in Prometheus telemetry.
4. **Permanent Ban on Equivocation**: If a peer supplies cryptographic proof of two conflicting blocks signed for the same height/round, the peer identity is added to the quarantine blacklist.

