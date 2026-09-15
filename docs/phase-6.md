# Phase 6: Professional Block Structure & Consensus Certificate

## Overview

In **Phase 6**, PDSChain introduces a **cryptographically verifiable consensus architecture** that transitions the network from:
`BLOCK + HASH + FBA RESULT`
to:
`PROPOSED BLOCK + VALIDATOR APPROVALS + SIGNED VALIDATOR VOTES + FBA QUORUM EVIDENCE + CONSENSUS CERTIFICATE + FINALIZED BLOCK`.

Consensus evidence in PDSChain is now explicit, self-contained, and independently verifiable by any third party without needing to replay the network protocol.

> [!IMPORTANT]
> **PDSChain uses an application-specific Federated Byzantine Agreement (FBA) consensus model over 12 institutional validator nodes with 3-of-4 quorum slices and a configured 9-of-12 global agreement threshold. It is NOT a full implementation of the Stellar Consensus Protocol (SCP) and does NOT use PoW, PoS, EVM, gas, or Ethereum consensus.**

---

## 1. Professional Block Structure & Layer Separation

The block model strictly separates the consensus-critical **Block Header**, execution **Block Body**, and immutable **Consensus Metadata**:

```
Block
│
├── 1. Block Header (Consensus-Critical)
│   ├── version: 1
│   ├── index / blockNumber: 42
│   ├── timestamp: "2026-03-31T12:00:00.000Z"
│   ├── previousHash: "0x8a7f..."
│   ├── merkleRoot: "0x4ae1..." (Transaction Commitment)
│   ├── stateRoot: "0x9f86..." (World State Commitment)
│   ├── proposerId: "VAL-01"
│   └── nonce: 0
│
├── 2. Block Body (Execution Payload)
│   └── transactions: Array<Transaction>
│
└── 3. Consensus Metadata (Cryptographic Evidence)
    ├── proposerAddress: "PDS1..."
    ├── proposalId: "0x3f8a..." (Deterministic Proposal ID)
    ├── proposerSignature: "0x7c9b..." (Ed25519 Proposal Signature)
    ├── consensusCertificate: ConsensusCertificate
    │   ├── version: 1
    │   ├── proposalId: "0x3f8a..."
    │   ├── blockHash: "0x8a7f..."
    │   ├── stateRoot: "0x9f86..."
    │   ├── round: 0
    │   ├── threshold: 9
    │   ├── totalValidators: 12
    │   ├── achieved: true
    │   ├── validatorApprovals: Array<SignedApproval> (Sorted by validatorId ASC)
    │   └── certificateHash: "0x1b2c..."
    └── consensusStatus: "FINALIZED"
```

---

## 2. Cryptographic Signatures & Domain Separation

PDSChain strictly isolates digital signatures using explicit protocol domain separation prefixes:

| Signature Type | Domain Tag | Signer | Purpose | Verification Key |
| :--- | :--- | :--- | :--- | :--- |
| **Transaction Signature** | `PDSCHAIN_TX_V1` | Citizen / Shop / Warehouse Actor | Proves transaction authorization & quota consent | Sender Public Key |
| **Block Proposal Signature** | `PDSCHAIN_BLOCK_V1` | Block Proposer (e.g. `VAL-01`) | Proves proposer identity & candidate block authenticity | Proposer Public Key |
| **Validator Vote Signature** | `PDSCHAIN_VOTE_V1` | Institutional Validator Node | Proves independent verification & consensus approval | Validator Public Key |

> [!CAUTION]
> **A transaction signature cannot be reused as a validator vote or block proposal signature. Reusing a signature across domains immediately fails cryptographic verification.**

---

## 3. Deterministic Proposal ID & Block Header Hashing

1. **Proposal ID**:
   Derived deterministically via SHA-256 over the canonical proposal header:
   ```
   proposalId = SHA256({ domain: "PDSCHAIN_PROPOSAL_V1", version, blockNumber, previousHash, timestamp, merkleRoot, stateRoot, proposerId, proposerAddress, round })
   ```
2. **Block Header Hash (`blockHash`)**:
   Derived deterministically over all consensus-critical header fields:
   ```
   blockHash = SHA256({ version, blockNumber, previousHash, timestamp, merkleRoot, stateRoot, proposerId, nonce })
   ```
   Any alteration to `previousHash`, `merkleRoot`, `stateRoot`, `proposerId`, or `blockNumber` immediately invalidates `blockHash` and `proposalId`.

---

## 4. Signed Validator Vote Model (`ValidatorVote.js`)

Each validator independently audits candidate blocks and issues an explicit, signed `ValidatorVote`:

```json
{
  "validatorId": "VAL-01",
  "validatorAddress": "PDS101a9f4c82e3b7701000000000000000000000000",
  "validatorPublicKey": "01a9f4c82e3b7701...",
  "proposalId": "3f8a9c2d...",
  "blockNumber": 42,
  "blockHash": "8a7f9c2d...",
  "stateRoot": "9f86d081...",
  "round": 0,
  "vote": "ACCEPT",
  "reason": "",
  "timestamp": "2026-03-31T12:00:00.000Z",
  "signature": "7c9b2e1f..."
}
```

### 14-Point Independent Validator Verification Checklist
Before casting an `ACCEPT` vote, every validator independently verifies:
1. Block header schema & version.
2. Block height sequence (`blockNumber === previousBlock.blockNumber + 1`).
3. Previous block hash reference (`previousHash === previousBlock.blockHash`).
4. Proposer identity recognition in institutional validator registry.
5. Proposer digital signature validity against proposer public key.
6. Proposal ID derivation consistency.
7. Transaction format & field constraints.
8. Transaction digital signatures (Ed25519) for all included transactions.
9. Transaction Merkle root calculation (`merkleRoot === calculateMerkleRoot(transactions)`).
10. Side-effect-free deterministic simulation of all transactions.
11. World state invariant consistency (non-negative stock, non-negative claimed quota).
12. Resulting post-execution state root (`computedStateRoot === proposedBlock.stateRoot`).
13. Consensus round validity.
14. No prior conflicting `ACCEPT` vote cast by this validator in the current round.

---

## 5. Vote Store & Conflict Protection (`VoteStore.js`)

The consensus engine guards against Byzantine faults and accidental double-voting:
- **Duplicate Vote Detection**: Prevents duplicate submission of the same vote statement.
- **Conflicting Double-Vote Detection (`CONFLICTING_VOTE`)**: If a validator has already issued an `ACCEPT` vote for Proposal A in Round $R$, any subsequent `ACCEPT` vote for Proposal B in Round $R$ is rejected.

---

## 6. Consensus Certificate & Verification (`ConsensusCertificate.js`)

When a block proposal achieves FBA quorum (3-of-4 slices across institutional nodes) and satisfies the configured global agreement threshold ($\ge 9$ of 12), a `ConsensusCertificate` is generated.

### Deterministic Validator Ordering
Validator approvals are strictly ordered ascending by `validatorId`:
`VAL-01` $\rightarrow$ `VAL-02` $\rightarrow$ `VAL-03` $\rightarrow \dots \rightarrow$ `VAL-12`.

### Certificate Hash (`certificateHash`)
```
certificateHash = SHA256({
  domain: "PDSCHAIN_CERTIFICATE_V1",
  version: 1,
  proposalId,
  blockNumber,
  blockHash,
  stateRoot,
  round,
  threshold: 9,
  totalValidators: 12,
  achieved: true,
  validatorApprovals
})
```

### Standalone Certificate Verification (`ConsensusCertificate.verify`)
Any external audit node can verify the consensus certificate without executing the consensus round:
1. `certificate.certificateHash === calculateCertificateHash(certificate)`.
2. `certificate.blockHash === block.blockHash`.
3. `certificate.proposalId === block.proposalId`.
4. `certificate.stateRoot === block.stateRoot`.
5. `certificate.round === block.round`.
6. `certificate.validatorApprovals.length >= certificate.threshold` ($\ge 9$).
7. Every approval vote is `'ACCEPT'`.
8. Zero duplicate validator approvals.
9. Every validator vote signature cryptographically verifies against the validator's public key.
10. Quorum slice topology is satisfied for the agreeing validator set (`findQuorum`).

---

## 7. Block Finality & Lifecycle

```
CREATED
   ↓
PROPOSED (Proposer signs block proposal)
   ↓
VALIDATED (Validators independently simulate state & verify roots)
   ↓
VOTES_COLLECTED (Validators cast signed Ed25519 votes)
   ↓
CONSENSUS_REACHED (FBA Quorum slices + 9/12 threshold satisfied)
   ↓
CERTIFICATE_CREATED (ConsensusCertificate constructed & signed)
   ↓
FINALIZED (Block sealed with certificate)
   ↓
COMMITTED (Persisted in blockchain ledger, state committed, mempool pruned)
```

---

## 8. FBA Topology & Failure Matrix

PDSChain preserves the 12-validator institutional topology with 3-of-4 trust slices:

| Node Failure Scenario | Online Count | Agreeing Slices | Quorum Size | Consensus Outcome |
| :--- | :--- | :--- | :--- | :--- |
| **All Online** | 12 / 12 | 12 / 12 | 12 | **ACHIEVED** (Certificate Created) |
| **VAL-07 Offline** | 11 / 12 | 11 / 12 | 11 | **ACHIEVED** (Certificate Created) |
| **VAL-05 & VAL-06 Offline** | 10 / 12 | 9 / 12 | 9 | **ACHIEVED** (Threshold $\ge 9$ Met) |
| **VAL-01 & VAL-02 Offline** | 10 / 12 | 10 / 12 | 10 | **ACHIEVED** (Threshold $\ge 9$ Met) |
| **VAL-05, VAL-06, VAL-07 Offline** | 9 / 12 | 8 / 12 | 8 | **FAILED** (Quorum size 8 < threshold 9) |
| **4 Nodes Offline** | 8 / 12 | $< 8$ | $\le 8$ | **FAILED** (Threshold not met) |
| **5 Nodes Offline** | 7 / 12 | $< 7$ | $\le 7$ | **FAILED** (Threshold not met) |

---

## 9. REST API & Frontend Inspector

### REST Endpoints
- **`GET /api/blockchain/blocks/:number/consensus`**: Returns block consensus certificate, proposer details, and validator signatures.
- **`POST /api/blockchain/consensus/verify`**: Standalone validation of supplied block and consensus certificate.

### Frontend Block Inspector Modal
- Displays **Block Status** (`FINALIZED` badge)
- Displays **Block Proposer** (e.g. `VAL-01`) and **Proposal ID**
- Displays **FBA Consensus Certificate Evidence** with threshold (`9 / 12 (75%)`)
- Highlights individual participating validator checkmarks (`VAL-01 ✓`, etc.) and offline nodes (`VAL-07 ✗`).

