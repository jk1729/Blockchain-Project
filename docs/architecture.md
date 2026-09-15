# PDSChain Architecture Specification

## Overview

**PDSChain** is a permissioned, application-specific, blockchain-based Public Distribution System platform. It is engineered to provide end-to-end transparency, auditability, and tamper-proof verification for essential food grain allocation, Fair Price Shop distribution, and warehouse logistics.

> [!IMPORTANT]
> **Transaction signatures provide transaction authenticity and integrity. FBA remains the consensus mechanism.**
> 
> **PDSChain is Ethereum-inspired in selected blockchain architecture concepts, but it is not an Ethereum network and does not use Ethereum consensus.**
> 
> Key Characteristics:
> - **Permissioned**: Validator participation is governed by institutional identities.
> - **Application-Specific**: Tailored specifically for public distribution governance, ration entitlements, and inventory integrity.
> - **PDS-Focused**: Native state models represent Beneficiaries, Fair Price Shops, Warehouses, and Commodities.
> - **Cryptographically Signed**: Every transaction is signed via native Ed25519 digital signatures and protected by sequential nonces.
> - **Dual Cryptographic Commitments**: Every block header anchors both `merkleRoot` (transaction commitment) and `stateRoot` (post-execution state commitment).
> - **Cryptographic Consensus Certificates**: Every finalized block contains signed validator vote approvals and an FBA consensus certificate.
> - **NOT an Ethereum Network**: Does not run EVM bytecodes, Solidity smart contracts, or Ethereum RPCs.
> - **NOT Using Cryptocurrency**: Operates strictly on subsidized public distribution quotas with zero native token or gas fees.
> - **NOT Using Proof-of-Work (PoW) / PoS**: Uses zero energy-waste mining; consensus is achieved via Federated Byzantine Agreement.

---

## 5-Layer Platform Architecture

```
PDSChain
│
├── 1. Application Layer
│   ├── Citizen / Beneficiary Management & Monthly Quotas
│   ├── Fair Price Shop (FPS) Point-of-Sale Operations
│   ├── Central / Regional Warehouse Logistics & Transfers
│   ├── Commodity Catalog & Subsidized Pricing
│   └── RBAC, Authentication & REST API Controllers
│
├── 2. Blockchain & Identity Layer
│   ├── Cryptographic Identities & Ed25519 Key Pairs (`keyManager.js`, `Identity.js`)
│   ├── Asymmetric Digital Signatures & Domain Separation (`signature.js`)
│   │   ├── `PDSCHAIN_TX_V1` (Transaction signatures)
│   │   ├── `PDSCHAIN_BLOCK_V1` (Block proposal signatures)
│   │   └── `PDSCHAIN_VOTE_V1` (Validator vote signatures)
│   ├── Canonical Serialization & Deterministic IDs (`serialization.js`)
│   ├── Transaction Mempool Module (`backend/src/blockchain/mempool/`)
│   │   ├── `Mempool.js` (Admission pipeline, candidate selection, queued promotion)
│   │   ├── `MempoolEntry.js` (Lifecycle states: READY, QUEUED, INCLUDED, EXPIRED)
│   │   ├── `MempoolPolicy.js` (Configurable capacity, per-sender limits, TTL)
│   │   └── `MempoolErrors.js` (Structured error codes)
│   ├── Deterministic Consensus State Root Module (`backend/src/blockchain/state/`)
│   │   ├── `stateSerializer.js` (Canonical serialization & SHA-256 stateRoot)
│   │   └── `stateConsistency.js` (World state invariant & integrity verification)
│   ├── Signed Blockchain Transaction (`Transaction.js`)
│   ├── Cryptographic Block Representation with Dual Roots & Certificates (`Block.js`)
│   ├── Sequential Blockchain Ledger (`Blockchain.js`)
│   ├── SHA-256 Block Header, Proposal & Payload Hashing (`hashing.js`)
│   ├── Merkle Tree & Merkle Root Calculations (`merkle.js`)
│   └── Ledger Cryptographic Integrity Validation (`validation.js`)
│
├── 3. Execution Layer
│   ├── Execution Boundary & Dispatcher (`ExecutionEngine.js`)
│   ├── Deterministic Execution Context (`ExecutionContext.js`)
│   ├── Structured Execution Receipts & Ordered Diffs (`ExecutionReceipt.js`)
│   ├── World State Access, Sender Nonce Tracking & State Snapshots (`StateManager.js`)
│   ├── Standardized Structured Error Codes (`errors/ExecutionErrors.js`)
│   └── Modular Smart-Contract-Like Domain Rules (`rules/`)
│       ├── `BaseRule.js` (Rule contract interface)
│       ├── `AuthorizationRule.js` (Actor permission validation)
│       ├── `EntitlementRule.js` (Citizen quota allowances & deductions)
│       ├── `InventoryRule.js` (Shop stock management & zero-stock guards)
│       ├── `DistributionRule.js` (Atomic composite grain distribution)
│       └── `WarehouseTransferRule.js` (Atomic logistics transfers & audit logging)
│
├── 4. Consensus Layer
│   ├── Federated Byzantine Agreement Engine (`FBAConsensus.js`)
│   ├── 12 Institutional Validator Topology (`consensusConfig.js`)
│   ├── Validator Node Representation & Independent Signature Checks (`ValidatorNode.js`)
│   ├── Dedicated Signed Validator Vote Model (`ValidatorVote.js`)
│   ├── In-Memory Consensus Vote Store & Conflict Protection (`VoteStore.js`)
│   ├── Cryptographic Consensus Certificate & Standalone Verifier (`ConsensusCertificate.js`)
│   ├── Individual Trust Quorum Slices (`QuorumSlice.js`)
│   └── Dynamic Network Quorum Finding & Evaluation (`Quorum.js`)
│
└── 5. Network Layer
    ├── Inter-Validator Communication Protocol
    ├── Proposal Broadcast & Vote Gossip Transport
    └── HTTP Transport & Peer Synchronization
```

---

## Transaction Lifecycle & Consensus Pipeline

```
                 TRANSACTION
                      ↓
                 SIGNATURE
                      ↓
                   MEMPOOL
                      ↓
              EXECUTION ENGINE
                      ↓
              STATE TRANSITION
                      ↓
               CANDIDATE BLOCK
                /           \
               ↓             ↓
        MERKLE ROOT       STATE ROOT
               \             /
                ↓           ↓
                BLOCK PROPOSAL
                      ↓
              PROPOSER SIGNATURE
                      ↓
             VALIDATOR VERIFICATION
                      ↓
              SIGNED VALIDATOR VOTES
                      ↓
                 FBA QUORUM
                      ↓
            CONSENSUS CERTIFICATE
                      ↓
                 FINALIZATION
                      ↓
                BLOCK COMMIT
                      ↓
                STATE COMMIT
```

```mermaid
sequenceDiagram
    autonumber
    actor Shop as Shop / Citizen Operator
    participant Key as Identity & KeyManager
    participant Tx as Canonical Transaction
    participant MP as Transaction Mempool
    participant Exec as ExecutionEngine & StateManager
    participant Prop as Proposer Node (VAL-01)
    participant FBA as 12 Institutional Validators
    participant Cert as Consensus Certificate
    participant Chain as Blockchain Ledger

    Shop->>Key: Resolve Identity & Nonce (e.g. Nonce #0)
    Key-->>Shop: Keypair & Address (PDS1...)
    Shop->>Tx: Construct & Sign Transaction (Ed25519)
    Tx-->>Shop: Signed Transaction + Deterministic TXN-ID
    Shop->>Exec: Pre-validate Signature, Nonce, Quota & Stock (Simulation)
    Exec-->>Shop: Pre-validation OK
    Shop->>MP: addTransaction(signedTx) -> Stage as READY
    MP-->>Shop: Admitted to Mempool (READY)
    Shop->>Prop: Build Candidate Block Proposal
    Prop->>Prop: Compute Merkle Root & Simulated State Root
    Prop->>Prop: Sign Proposal with Ed25519 Private Key
    Prop->>FBA: Broadcast Candidate Proposal Header to 12 Validators
    loop Each of 12 Institutional Validators
        FBA->>FBA: Independently Verify Proposer Signature & Tx Signatures
        FBA->>FBA: Re-execute State & Verify State Root
        FBA->>FBA: Cast Signed ValidatorVote (ACCEPT / REJECT)
        FBA->>FBA: Evaluate Quorum Slices (3-of-4)
    end
    FBA-->>Cert: Quorum Agreement Achieved (>= 9 of 12 Nodes)
    Cert->>Cert: Construct & Hash ConsensusCertificate
    Cert-->>Shop: Verified Consensus Certificate
    Shop->>Exec: executeTransaction(signedTx) [Atomic DB Transaction]
    Exec->>Exec: Deduct Quota, Deduct Stock, Consume Nonce
    Shop->>Chain: addBlock([signedTx], validatorSignatures, stateRoot, certificate)
    Chain->>Chain: Seal FINALIZED Block with Dual Roots + Certificate
    Chain-->>Shop: Block Sealed (#N, Hash, StateRoot, CertHash)
    Shop->>MP: removeIncludedTransactions([txId], blockNumber)
    MP->>MP: Prune & Promote Queued Nonces
    Exec-->>Shop: Return Verifiable Execution Receipt
```

---

## Database Separation

PDSChain maintains a clean conceptual separation of persistence responsibilities:

1. **Blockchain Ledger (`blocks`, `transactions`)**:
   - Immutable historical record of finalized blocks, Merkle roots (`merkleRoot`), State roots (`stateRoot`), proposer signatures, Consensus Certificates (`consensusCertificate`), and cryptographically sealed transactions.
2. **Application / State Database (`beneficiaries`, `shops`, `warehouses`, `inventory`, `users`, `stock_transfers`)**:
   - Indexed operational state, monthly entitlements, stock balances, sender nonces, and authentication records.
3. **In-Memory Mempool & Vote Store**:
   - Ephemeral pre-consensus staging area for unconfirmed transactions and consensus round vote deduplication.
