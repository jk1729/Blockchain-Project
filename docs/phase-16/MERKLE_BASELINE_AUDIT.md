# Phase 16: Merkle and Commitment Baseline Audit

## Executive Summary

Phase 16 introduces cryptographic inclusion proofs and Merkle verification to PDSChain. Before designing or deploying new commitment formats, an exhaustive audit of all existing cryptographic commitments, data structures, leaf serializations, odd-node handling, receipt roots, and recovery mechanisms across the codebase was conducted.

This document establishes the verified baseline of PDSChain's cryptographic commitments as of Phase 15 completion (708 passing tests: 688 backend + 20 Hardhat contract tests).

---

## 1. Existing Merkle Root Implementations

### 1.1 Codebase Locations
- **`backend/src/blockchain/merkle.js`**:
  - `sha256(data)`: Computes SHA-256 hex digest of string or `JSON.stringify(data)`.
  - `hashTransactionLeaf(tx)`: Computes leaf hash.
    - If `tx` is null/undefined: returns `sha256('NULL_TRANSACTION')`.
    - If `tx` is a string: returns `sha256(tx)`.
    - If `tx.calculateHash()` is a function (e.g. `Transaction` instance): calls `tx.calculateHash()`.
    - Otherwise (plain object): serializes `${id}:${sender}:${receiver}:${commodity}:${qty}:${ts}` and computes SHA-256.
  - `getMerkleTree(transactions)`: Constructs full layer array `tree[0...depth]`.
    - Empty transactions array: returns `[[sha256('EMPTY_TX_POOL')]]`.
    - Internal nodes: pairwise concatenation `sha256(leaves[i] + leaves[i + 1])`.
    - Odd node at level: duplicates the last leaf `sha256(leaves[i] + leaves[i])`.
  - `calculateMerkleRoot(transactions)`: Returns `tree[tree.length - 1][0]`.

### 1.2 Consumers of `calculateMerkleRoot`
1. **`Block.js`**:
   - `this.merkleRoot = calculateMerkleRoot(this.transactions);`
   - `this.receiptsRoot = options.receiptsRoot || null;`
   - `this.stateRoot = stateRoot || options.stateRoot || null;`
   - Header calculation `hashBlockHeader` commits `merkleRoot` and `stateRoot`.
   - Block validation `isValid()` asserts `this.merkleRoot === calculateMerkleRoot(this.transactions)`.
2. **`validation.js`**:
   - `validateBlock`: Asserts `computedMerkle === block.merkleRoot`.
3. **`transactionService.js`**:
   - Block creation: `merkleRoot = calculateMerkleRoot([txPayload]);`
   - Receipts root: `receiptsRoot = calculateMerkleRoot([{ receiptHash: simReceipt.receiptHash }]);`
4. **`ValidatorNode.js` & `FinalityEngine.js`**:
   - Candidate block proposal validation verifies `computedMerkleRoot === proposal.merkleRoot`.
5. **`LedgerCheckpoint.js`**:
   - Records `merkleRoot`, `stateRoot`, and `receiptsRoot` in finalized checkpoint snapshots.
6. **`LedgerRecoveryManager.js`**:
   - Verifies chain integrity across all blocks upon node startup and journal replay.

---

## 2. Cryptographic Characteristics & Invariants

| Dimension | Version 1 (Current Baseline) | Version 2 (Canonical Domain-Separated) |
| :--- | :--- | :--- |
| **Hash Algorithm** | SHA-256 (FIPS 180-4, 256 bits, 64 hex characters) | SHA-256 (FIPS 180-4, 256 bits, 64 hex characters) |
| **Domain Separation** | None (direct hex string concatenation) | Explicit 1-byte domain tags: `0x00` (Leaf), `0x01` (Internal Node) |
| **Leaf Encoding** | `${id}:${sender}:${receiver}:${commodity}:${qty}:${ts}` or `tx.calculateHash()` | Canonical JSON / RFC-8785 + length-prefixed binary/hex |
| **Odd-Node Handling** | Duplicate last leaf: `sha256(leaves[i] + leaves[i])` | Domain-separated duplicate or balanced promotion |
| **Empty Tree** | `sha256('EMPTY_TX_POOL')` | `sha256('EMPTY_MERKLE_TREE_V2')` |
| **Receipt Commitments** | `receiptsRoot` committed in `Block` options; single/multi receipt root | Dedicated `RECEIPT` commitment type with EVM receipt hash leaves |
| **Event Commitments** | Log array inside `EVMReceipt` -> `receiptHash` -> `receiptsRoot` | Nested proof: Event Log -> Receipt -> Receipts Root |

---

## 3. Backward Compatibility & Migration Strategy

1. **Non-Negotiable Invariant**: Genesis block #0 and all historical blocks committed under Version 1 rules must **never** fail verification or change their computed `merkleRoot`.
2. **Dual-Version Engine**:
   - The Merkle core engine will explicitly support `CommitmentVersion.V1` and `CommitmentVersion.V2`.
   - Proof generation inspects the block’s `version` or commitment metadata: blocks with version 1 use `V1` legacy rules, while version 2 blocks use `V2` domain-separated rules.
   - Proof objects explicitly record `"version": 1` or `"version": 2` so independent verifiers select the exact matching reduction rule.

---

## 4. Derived Indexing vs. Authoritative State

1. **Authoritative State**:
   - Blockchain blocks stored in SQLite/Postgres `Blocks` table and in-memory `Blockchain.chain`.
   - Block headers containing `merkleRoot`, `receiptsRoot`, `stateRoot`, and `consensusCertificate`.
2. **Derived Proof Indexer (`ProofIndexer`)**:
   - Maintained in memory and rebuilt from authoritative ledger data whenever the node restarts or undergoes recovery.
   - Provides sub-millisecond lookup from `txHash`, `receiptHash`, or `eventId` to `{ blockNumber, blockHash, txIndex, leafHash, merkleRoot }`.
   - If index data is missing or out-of-sync, the proof subsystem falls back to authoritative block scans or marks status as `REBUILDING` / `SYNCING`.

