# Phase 16: Merkle Tree and Proof Specification

## 1. Specification Overview

This document defines the canonical specification for Merkle trees and cryptographic inclusion proofs in the PDSChain blockchain ecosystem. It specifies the mathematical algorithms, domain-separation rules, leaf encodings, sibling ordering conventions, serialization schemas, and standalone verification procedures.

---

## 2. Hash Algorithm & Encodings

- **Cryptographic Hash Primitive**: SHA-256 (FIPS 180-4).
- **Digest Length**: 32 bytes (256 bits).
- **Text Representation**: 64 lowercase hexadecimal characters (optionally prefixed with `0x`).
- **Binary Concatenation**: When computing internal nodes, binary or hex-string inputs are ordered strictly according to tree position (`left || right`).

---

## 3. Commitment Versions

PDSChain supports two commitment versions:

### 3.1 Version 1 (v1) — Legacy Compatible
- **Purpose**: Retains 100% cryptographic compatibility with PDSChain Genesis block #0 and historical blocks 1–15.
- **Leaf Hashing**:
  - Null/undefined: `sha256('NULL_TRANSACTION')`
  - String: `sha256(tx)`
  - Transaction instance: `tx.calculateHash()`
  - Plain object: `sha256(`${id}:${sender}:${receiver}:${commodity}:${qty}:${ts}`)`
  - Receipt object: `sha256(receipt.receiptHash || ...)`
- **Empty Tree**: `[[sha256('EMPTY_TX_POOL')]]`
- **Internal Node Reduction**:
  - Paired nodes: `sha256(leftHex + rightHex)`
  - Odd node: duplicated `sha256(nodeHex + nodeHex)`

### 3.2 Version 2 (v2) — Canonical Domain-Separated
- **Purpose**: Cryptographic standard designed to prevent second-preimage attacks and commitment confusion between leaves and internal nodes.
- **Domain Separation Tags**:
  - `TAG_LEAF = 0x00` (1 byte prefix before hashing leaf content)
  - `TAG_INTERNAL = 0x01` (1 byte prefix before hashing child pair: `0x01 || leftBytes || rightBytes`)
  - `TAG_EMPTY = 0x02`
- **Internal Node Reduction**:
  - `sha256(0x01 || leftDigest || rightDigest)`
  - Odd node: duplicate last node `sha256(0x01 || lastDigest || lastDigest)`

---

## 4. Canonical Merkle Proof Schema

Every Merkle proof in PDSChain conforms to the following schema:

```json
{
  "version": 1,
  "commitmentType": "TRANSACTION",
  "hashAlgorithm": "SHA-256",
  "leafHash": "7b8893d...64hex",
  "leafIndex": 2,
  "totalLeaves": 5,
  "treeDepth": 3,
  "siblings": [
    { "position": "left", "hash": "a1b2c3...64hex" },
    { "position": "right", "hash": "d4e5f6...64hex" },
    { "position": "right", "hash": "789abc...64hex" }
  ],
  "expectedRoot": "f0e1d2c...64hex",
  "blockHeight": 42,
  "blockHash": "0x12345...64hex",
  "transactionHash": "TXN-004281",
  "finality": "FINALIZED",
  "timestamp": "2026-09-17T22:00:00.000Z",
  "requestId": "req-1726610400000-abcd"
}
```

### 4.1 Schema Fields

| Field | Type | Description |
| :--- | :--- | :--- |
| `version` | `integer` | Commitment version (`1` or `2`). |
| `commitmentType` | `string` | `'TRANSACTION'`, `'RECEIPT'`, or `'EVENT'`. |
| `hashAlgorithm` | `string` | Cryptographic algorithm (default `'SHA-256'`). |
| `leafHash` | `string` | 64-char hex digest of the leaf being proven. |
| `leafIndex` | `integer` | 0-indexed position of the leaf in the original tree. |
| `totalLeaves` | `integer` | Total number of leaves in the tree at commitment time. |
| `treeDepth` | `integer` | Number of levels from leaves to root (`siblings.length`). |
| `siblings` | `array` | Array of `{ position: 'left' | 'right', hash: string }` ordered from leaf level up to the root level. |
| `expectedRoot` | `string` | Expected 64-char Merkle root hex string from block header. |
| `blockHeight` | `integer` | Height of the block containing this leaf. |
| `blockHash` | `string` | Cryptographic hash of the block. |
| `finality` | `string` | `'FINALIZED'`, `'COMMITTED'`, or `'PENDING'`. |

---

## 5. Verification Algorithm

An independent verifier verifies an inclusion proof without database or network access using the following deterministic steps:

1. **Input Validation**:
   - Verify `proof` contains all required schema fields.
   - Verify `siblings.length === treeDepth`.
   - Verify `0 <= leafIndex < totalLeaves`.
   - Verify `treeDepth <= MAX_PROOF_DEPTH` (32).
   - Verify all hashes are valid 64-character hexadecimal strings.
2. **Leaf Verification**:
   - If raw leaf data was provided: calculate `computedLeaf = hashLeaf(rawLeaf, version, commitmentType)` and verify `computedLeaf === proof.leafHash`.
3. **Upward Reduction**:
   - Initialize `currentHash = proof.leafHash`.
   - For each sibling in `proof.siblings`:
     - If `sibling.position === 'left'`:
       - If `version === 1`: `currentHash = sha256(sibling.hash + currentHash)`
       - If `version === 2`: `currentHash = sha256(0x01 || sibling.hash || currentHash)`
     - If `sibling.position === 'right'`:
       - If `version === 1`: `currentHash = sha256(currentHash + sibling.hash)`
       - If `version === 2`: `currentHash = sha256(0x01 || currentHash || sibling.hash)`
4. **Root Comparison**:
   - Compare `currentHash.toLowerCase()` with `proof.expectedRoot.toLowerCase()`.
   - If equal, the proof is **VALID**.
   - If not equal, the proof is **INVALID** with code `ROOT_MISMATCH`.

