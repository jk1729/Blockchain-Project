# PDSChain Phase 10: Ledger Synchronization Architecture

## 1. System Architecture Overview

The PDSChain Ledger Synchronization subsystem provides high-assurance, deterministic block catch-up and crash recovery for the 12-node Federated Byzantine Agreement (FBA) network. 

```
                                  +-----------------------+
                                  |    Peer Validators    |
                                  | (VAL-01 ... VAL-12)   |
                                  +-----------+-----------+
                                              | Authenticated TLS / TCP
                                              v
                                  +-----------+-----------+
                                  |    PeerConnection     |
                                  +-----------+-----------+
                                              | Length-Prefixed Frames
                                              v
+-----------------------+         +-----------+-----------+
|    SyncPlanner        | <-----> |     SyncHandler       |
|  - Peer Discovery     |         |  - Range Ingestion    |
|  - Common Ancestor    |         |  - Block Validation   |
|  - Batch Scheduler    |         |  - Checksum Checking  |
+-----------+-----------+         +-----------+-----------+
            |                                 |
            v                                 v
+-----------+-----------+         +-----------+-----------+
|   LedgerSyncState     |         |      Blockchain       |
|  - Lifecycle Status   |         |  - Chain Continuity   |
|  - Consensus Gating   |         |  - Merkle Tree Check  |
+-----------+-----------+         +-----------+-----------+
            |                                 |
            +----------------+----------------+
                             |
                             v
                 +-----------+-----------+
                 |   EVM State Adapter   |
                 |  - World State Commit |
                 |  - StateRoot Replay   |
                 +-----------+-----------+
                             |
                             v
                 +-----------+-----------+
                 |  CheckpointManager    |
                 |  - Atomic Persistence |
                 |  - Conflict Trapping  |
                 +-----------------------+
```

---

## 2. Core Protocol Messages

The wire protocol uses 4-byte length-prefixed streaming framing carrying versioned `MessageEnvelope` structures.

### 2.1 Height Discovery Exchange
- **`HEIGHT_DISCOVERY_REQUEST`**: Sent by a node to survey peer heights.
  ```json
  {
    "type": "HEIGHT_DISCOVERY_REQUEST",
    "senderId": "VAL-02",
    "correlationId": "REQ-1001",
    "payload": {}
  }
  ```
- **`HEIGHT_DISCOVERY_RESPONSE`**: Responded with latest finalized commitments.
  ```json
  {
    "type": "HEIGHT_DISCOVERY_RESPONSE",
    "senderId": "VAL-01",
    "correlationId": "REQ-1001",
    "payload": {
      "finalizedHeight": 4281,
      "latestBlockHash": "00b084f08f67b94c...",
      "stateRoot": "0xstate...",
      "checkpointHash": "a9f3701...",
      "timestamp": "2026-09-17T12:00:00.000Z"
    }
  }
  ```

### 2.2 Finalized Block Range Exchange
- **`SYNC_REQUEST`**:
  - `fromHeight`: Starting block height (inclusive).
  - `toHeight`: Ending block height (inclusive).
  - `maxBlocks`: Bounded window size (default 20, max 100).
- **`SYNC_RESPONSE`**:
  - `fromHeight` & `toHeight`: Range contained.
  - `count`: Number of blocks in payload.
  - `batchChecksum`: SHA-256 hash of concatenated block hashes.
  - `isEndOfRange`: Boolean flag indicating if target height or chain tip reached.
  - `blocks`: Array of canonically serialized blocks.

---

## 3. Strict 14-Point Block Validation Pipeline

Every received synchronized block must independently satisfy:
1. **Contiguous Height**: `blockNumber === previousBlock.blockNumber + 1`.
2. **Previous Hash Link**: `block.previousHash === previousBlock.blockHash`.
3. **Block Self-Integrity**: Block hash matches canonical header serialization.
4. **Transaction Merkle Root**: `calculateMerkleRoot(transactions) === block.merkleRoot`.
5. **Consensus Certificate Presence**: Block must contain a `ConsensusCertificate`.
6. **Certificate Hash**: Certificate hash matches canonical certificate payload.
7. **Threshold Signatures**: $\ge 9$-of-12 institutional validator signatures.
8. **Quorum Slice Validity**: Signer set satisfies FBA quorum slices.
9. **Chain ID Verification**: Matches EVM Chain ID `1729`.
10. **Network ID Verification**: Matches configured network ID (`pdschain-devnet` / `pdschain-mainnet`).
11. **Protocol Version**: Protocol version $\ge 1$.
12. **EVM Execution Verification**: Transactions re-executed in local EVM produce matching `stateRoot`.
13. **Receipts Root Verification**: Executed transaction receipts produce matching `receiptsRoot`.
14. **Batch Integrity**: Combined batch hash matches advertised `batchChecksum`.

---

## 4. Consensus Participation Gating

To prevent Byzantine equivocations or forks from out-of-sync nodes:
- When a validator is in any state other than `CURRENT` (`BOOTSTRAPPING`, `SYNCING`, `VERIFYING`, `CATCHING_UP`, `RECOVERY_REQUIRED`, `CORRUPTED`, `HALTED`), all candidate block proposals and consensus votes are dropped.
- The validator resumes voting only upon atomic commit of the finalized checkpoint matching network target height.

