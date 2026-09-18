# Phase 16: Merkle Proof Architecture & Inclusion Verification

## Executive Overview

Phase 16 establishes a **production-ready, mathematically rigorous, independently verifiable Merkle proof subsystem** for PDSChain. The subsystem provides validators, APIs, JSON-RPC 2.0 clients, light clients, independent auditors, and the Phase 15 blockchain explorer with the ability to generate and independently verify cryptographic inclusion proofs for transactions, execution receipts, and event logs against authoritative block Merkle roots.

---

## 1. Architectural Principles

1. **Zero-Trust Independent Verification**:
   A proof must never be trusted simply because it was returned by a validator or RPC server. The verifier recomputes the root step-by-step from the leaf hash, ordered sibling path, and canonical commitment rules, comparing the computed root against the certified block header commitment.
2. **Dual-Version Commitment Model**:
   - **Version 1 (v1) Legacy Format**: Retains exact 100% cryptographic compatibility with PDSChain Genesis block #0 and historical blocks 1–15. Uses SHA-256 with pairwise concatenation `sha256(left + right)` and odd-leaf duplication `sha256(leaf + leaf)`.
   - **Version 2 (v2) Canonical Domain-Separated Format**: Introduces 1-byte domain separation prefixes (`0x00` for leaves, `0x01` for internal nodes) to eliminate second-preimage attacks.
3. **Read-Optimized Derived Indexing**:
   The `ProofIndexer` maintains an in-memory index mapping transaction IDs/hashes, receipt hashes, and event IDs to their block height and leaf position. The index is strictly derived from authoritative block data and can be completely rebuilt in milliseconds upon node restart or recovery.

---

## 2. Merkle Tree & Proof Components

```
+-------------------------------------------------------------+
|                     PDSChain Block                          |
|  - blockNumber: 42                                          |
|  - merkleRoot: 0x7b8893d... (Transactions Root)             |
|  - receiptsRoot: 0x112233... (EVM Receipts Root)            |
+-------------------------------------------------------------+
                              |
               +--------------+--------------+
               |                             |
     [ Transaction Tree ]           [ Receipt Tree ]
         (MerkleTree)                 (MerkleTree)
               |                             |
   +-----------+-----------+                 |
   |           |           |                 v
 [Leaf 0]   [Leaf 1]   [Leaf 2]       [Receipt Logs]
   (Tx 0)     (Tx 1)     (Tx 2)              |
               |                             v
               +---> Generates MerkleProof [ Event Log Proof ]
                           |
                           v
               +-----------------------+
               |   Standalone Verifier |
               | (Node.js & WebCrypto) |
               +-----------------------+
                           |
               +-----------+-----------+
               |                       |
               v                       v
      [ REST / RPC APIs ]      [ Explorer UI ]
```

---

## 3. Canonical Proof Schema

Every proof object contains complete self-describing metadata:

```json
{
  "version": 1,
  "commitmentType": "TRANSACTION",
  "hashAlgorithm": "SHA-256",
  "leafHash": "68e30c5ff2dd06f68ab752814672f6c1dac1af8febfbf397f69705f531d323a4",
  "leafIndex": 0,
  "totalLeaves": 3,
  "treeDepth": 2,
  "siblings": [
    { "position": "right", "hash": "125c245bb831034075180d0ce0cfdd6388f8833d3236736b270ff559cad03db3" },
    { "position": "right", "hash": "0bf76083d0dbac3304fd0c1a61b31baa62118e2565881e4fec0944b612001673" }
  ],
  "expectedRoot": "db3e4ec948c717b9dae711c65f6e8cc6aab2f23624f55f52e684da58bcd2d985",
  "blockHeight": 10,
  "blockHash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "transactionHash": "TXN-001",
  "finality": "FINALIZED",
  "timestamp": "2026-09-17T22:00:00.000Z",
  "requestId": "req-1789665658996-abcd"
}
```

---

## 4. Standalone Verification Algorithm

The verifier algorithm is implemented identically in `backend/src/blockchain/merkle/standaloneVerifier.js` and `frontend/js/merkle-verifier.js`:

```javascript
let current = proof.leafHash;
for (const sibling of proof.siblings) {
  if (proof.version === 1) {
    current = sibling.position === 'left'
      ? sha256(sibling.hash + current)
      : sha256(current + sibling.hash);
  } else {
    const prefix = Buffer.from([0x01]);
    const left = Buffer.from(sibling.position === 'left' ? sibling.hash : current, 'hex');
    const right = Buffer.from(sibling.position === 'left' ? current : sibling.hash, 'hex');
    current = sha256(Buffer.concat([prefix, left, right]));
  }
}
const valid = current.toLowerCase() === proof.expectedRoot.toLowerCase();
```

---

## 5. Security Invariants & Abuse Prevention

- **Max Proof Depth**: Configured to 32 levels (`MAX_ALLOWED_DEPTH`), supporting blocks with up to 4.29 billion transactions.
- **Max Batch Verifications**: Bounded at 50 proofs per RPC/batch request to prevent CPU denial of service.
- **Format Validation**: Strict regex `/^(0x)?[0-9a-fA-F]{64}$/` for all 256-bit hashes.
- **Second-Preimage Defense**: Domain separation tags (`0x00` / `0x01`) prevent leaf vs. internal node collisions in Version 2 commitments.
- **Zero Secret Exposure**: Scrubbing passes ensure private keys, seed passphrases, and auth tokens are never present in proofs or logs.
- **XSS Sanitization**: All proof attributes are HTML-escaped before rendering in the explorer.

