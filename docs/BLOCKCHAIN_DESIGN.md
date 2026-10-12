# PDSChain — Blockchain Design, Cryptographic Commitments & Validation Rules

## 1. Block Structure (`backend/src/blockchain/Block.js`)

Every block in PDSChain (`version: 1`) contains the following canonical fields:

| Field | Type | Description |
| :--- | :--- | :--- |
| `version` | `number` | Protocol block format version (`1`). |
| `blockNumber` | `number` | Monotonically increasing 0-indexed block height (`0` for Genesis). |
| `previousHash` | `string` | 64-character lowercase hex SHA-256 hash of block `blockNumber - 1` (`"0".repeat(64)` for Genesis). |
| `timestamp` | `string` | ISO-8601 UTC timestamp signed by the proposer. |
| `transactions` | `Array<Object>` | Ordered list of canonical transaction payloads included in the block. |
| `merkleRoot` | `string` | 64-character hex SHA-256 Merkle root of `transactions`. |
| `stateRoot` | `string` | `0x`-prefixed 64-character hex SHA-256 digest of the deterministic post-execution system state snapshot. |
| `receiptsRoot` | `string \| null` | Merkle root of execution receipts (when EVM or execution receipts are attached). |
| `proposerId` | `string` | Validator identifier of the block proposer (`"GENESIS"` for block 0, `"VAL-01"` for normal rounds). |
| `proposerAddress` | `string` | `PDS1...` address derived from the proposer's Ed25519 public key. |
| `proposerSignature` | `string` | Hex-encoded 64-byte Ed25519 signature over the canonical proposal header. |
| `proposalId` | `string` | SHA-256 digest of the canonical proposal header (`getProposalHeader()`). |
| `round` | `number` | Consensus round number (`0` for first-round finality). |
| `nonce` | `number` | Proof-of-work / ordering nonce (`0` or mined integer). |
| `consensusStatus` | `string` | `"GENESIS"` for block 0, `"FINALIZED"` for consensus-committed blocks. |
| `consensusCertificate` | `Object` | Signed quorum certificate containing `>= 9/12` Ed25519 validator approvals. |
| `blockHash` | `string` | 64-character hex SHA-256 digest of the canonical block header (`getHeader()`). |

---

## 2. Canonical Serialization & Hashing (`backend/src/blockchain/hashing.js`)

To guarantee deterministic hashing across Node.js runtimes and operating systems:
- Objects are serialized using recursive lexicographical key sorting (`canonicalStringify`).
- **Block Header Hash (`blockHash`)**: Computed via `hashBlockHeader(block.getHeader())`, which applies SHA-256 with domain separation over `{ version, blockNumber, previousHash, timestamp, merkleRoot, stateRoot, proposerId, nonce, consensusStatus }`.
- **Proposal ID (`proposalId`)**: Computed via `hashProposal(block.getProposalHeader())` over `{ version, blockNumber, previousHash, timestamp, merkleRoot, stateRoot, proposerId, round }`.

---

## 3. Merkle Tree Construction (`backend/src/blockchain/merkle/`)

PDSChain implements a domain-separated binary SHA-256 Merkle tree (`MerkleTree.js`) with standalone proof generation (`MerkleProof.js`) and verification (`MerkleVerifier.js`):

1. **Empty Block Rule**: If `transactions.length === 0`, the Merkle root is the SHA-256 hash of `"EMPTY_MERKLE_ROOT_V1"`.
2. **Leaf Hashing (Domain Separation)**:
   - Version 1 leaves hash the canonical transaction JSON payload.
   - Version 2 leaves prepend a `0x00` domain byte before hashing to prevent second-preimage attacks between leaf and internal nodes.
3. **Odd-Node Handling Rule**:
   - At any tree level with an odd number of nodes $2k + 1$, the final node at index $2k$ is **duplicated** and paired with itself: $H(\text{node}_{2k} \parallel \text{node}_{2k})$.
4. **Inclusion Proof Verification**:
   - Proofs can be independently verified via `GET /api/v1/proofs/tx/:txHash` on the backend or offline in the browser via `frontend/js/merkle-verifier.js`.

---

## 4. Digital Signatures (`backend/src/blockchain/identity/`)

- **Algorithm**: Ed25519 (RFC 8032) via Node.js native `crypto.sign(null, Buffer, PrivateKey)` and `crypto.verify(null, Buffer, PublicKey, Signature)`.
- **Address Derivation**: `PDS1` + first 40 hex characters of `SHA-256(DER_SPKI_PUBLIC_KEY)`.
- **Three Signature Domains**:
  1. `PDSCHAIN_TX_V1`: Authenticates transaction creator (`senderPublicKey`, `signature`).
  2. `PDSCHAIN_PROPOSAL_V1`: Authenticates block proposer (`proposerSignature`).
  3. `PDSCHAIN_VOTE_V1`: Authenticates each validator's consensus vote (`validatorApprovals[i].signature`).

---

## 5. Authoritative Chain Validation (`backend/src/blockchain/validation.js`)

`validateChain(chain)` verifies every block from index `0` to `N - 1`:
1. **Genesis Check**: Block `#0` must match canonical genesis parameters and self-hash.
2. **Contiguous Height**: `block[i].blockNumber === i`.
3. **Previous Hash Link**: `block[i].previousHash === block[i - 1].blockHash`.
4. **Merkle Root Integrity**: Recomputes `calculateMerkleRoot(block[i].transactions)` and rejects on mismatch (`MERKLE_ROOT_MISMATCH`).
5. **Block Header Hash Integrity**: Recomputes `block[i].calculateHash()` and rejects on mismatch (`BLOCK_HASH_MISMATCH`).
6. **Transaction Signature Verification**: Verifies every transaction's Ed25519 signature against its `senderPublicKey`.
7. **Proposer Signature Verification**: Verifies `proposerSignature` against the registered validator's Ed25519 public key.
8. **Consensus Certificate Verification**: Verifies `ConsensusCertificate` quorum (`>= 9/12` distinct active validators) and every validator's Ed25519 vote signature.

