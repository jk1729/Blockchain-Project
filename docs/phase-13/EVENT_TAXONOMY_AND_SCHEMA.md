# PDSChain Phase 13: Event Taxonomy and Canonical Schema

## 1. Overview & Architecture

The PDSChain Blockchain Events Subsystem provides a structured, finality-aware, and cryptographically verified event trail across all subsystems:
- Core Blockchain & Transactions
- Embedded EVM Smart Contract Execution & Receipts
- Federated Byzantine Agreement (FBA) Consensus
- Validator Process & Node States
- Peer-to-Peer Authenticated Transport
- Transport Layer Security (TLS 1.2/1.3 & mTLS)
- Encrypted Keystore & Consensus Key Rotation
- Ledger Synchronization & Checkpoint Recovery

Every event emitted in PDSChain is encapsulated as an instance of `BlockchainEvent`, which enforces schema validation, size bounds (maximum 64KB), automatic secret redaction, and deterministic deduplication keys.

---

## 2. Canonical BlockchainEvent Schema

```typescript
interface BlockchainEvent {
  eventId: string;                 // evt_<32 hex chars> (UUID/Crypto-random)
  timestamp: string;               // ISO-8601 UTC timestamp
  schemaVersion: number;           // Integer, default 1
  category: EventCategory;         // Enumerated category
  type: EventType;                 // Enumerated event type
  severity: EventSeverity;         // DEBUG | INFO | WARNING | ERROR | CRITICAL
  finalityStatus: FinalityStatus;  // PENDING | COMMITTED | FINALIZED | REVERTED
  blockHeight?: number;            // Monotonic block sequence number (nullable)
  blockHash?: string;              // 0x-prefixed 32-byte SHA-256 block hash (nullable)
  txHash?: string;                 // 0x-prefixed transaction hash (nullable)
  contractAddress?: string;        // 0x-prefixed 20-byte EVM contract address (nullable)
  source: string;                  // Originating subsystem (e.g., 'blockchain', 'evm', 'consensus')
  payload: Record<string, any>;    // Sanitized JSON payload (max 64KB)
  dedupKey: string;                // Deterministic deduplication key for idempotency
}
```

---

## 3. Enumerated Categories (`EVENT_CATEGORIES`)

| Category | Description | Primary Sources |
|---|---|---|
| `BLOCKCHAIN` | Block production, finalization, and chain reorganization | `Blockchain.js`, `Block.js` |
| `TRANSACTION` | Transaction submission, execution, and rejection | `Transaction.js`, `Blockchain.js` |
| `CONTRACT` | EVM smart contract call execution, revert, and receipt logs | `EVMRuntime.js`, `ABIEncoder.js` |
| `CONSENSUS` | FBA proposals, votes, quorum slices, and certificates | `validatorProcess.js`, `VoteStore.js` |
| `VALIDATOR` | Validator lifecycle, status toggles, and peer connections | `ValidatorNode.js`, `validatorProcess.js` |
| `NETWORK` | Peer discovery, P2P connections, framed transport | `PeerManager.js`, `MessageRouter.js` |
| `SYNC` | Block sync ranges, checkpoint transfers, ledger sync state | `SyncHandler.js`, `LedgerSyncState.js` |
| `RECOVERY` | Write-ahead journal replay, state rollback, corruption recovery | `LedgerRecoveryManager.js` |
| `TLS` | Certificate validation, mutual TLS handshakes, hot-reloads | `CertificateManager.js` |
| `KEY_MANAGEMENT`| Keystore encryption, consensus key activation, rotation | `KeyStore.js`, `KeyRotationManager.js` |

---

## 4. Enumerated Event Types (`EVENT_TYPES`)

### 4.1 Blockchain & Transactions
- `BLOCK_PROPOSED`: Candidate block proposed by node.
- `BLOCK_FINALIZED`: Block cryptographically verified, added to ledger, and persisted.
- `BLOCK_REVERTED`: Candidate block discarded or rolled back.
- `TRANSACTION_RECEIVED`: Transaction entered validator mempool.
- `TRANSACTION_EXECUTED`: Transaction successfully executed and state updated.
- `TRANSACTION_REJECTED`: Transaction rejected due to invalid signature, balance, or nonce.

### 4.2 EVM Smart Contracts
- `CONTRACT_DEPLOYED`: Smart contract deployed to deterministic address.
- `CONTRACT_CALL_EXECUTED`: Contract method executed successfully.
- `CONTRACT_CALL_FAILED`: Contract execution reverted or encountered exception.
- `CONTRACT_EVENT_EMITTED`: Contract emitted an event log with topics and data.

### 4.3 Consensus (FBA)
- `CONSENSUS_PROPOSAL_BROADCAST`: Node broadcast a candidate block proposal.
- `CONSENSUS_PROPOSAL_RECEIVED`: Node received a proposal from peer.
- `CONSENSUS_VOTE_CAST`: Validator signed and cast an ACCEPT/REJECT vote.
- `CONSENSUS_VOTE_RECEIVED`: Peer vote verified and stored.
- `CONSENSUS_QUORUM_REACHED`: 2/3+ threshold reached for round.
- `CONSENSUS_CERTIFICATE_FORMED`: Quorum certificate assembled and validated.
- `CONSENSUS_ROUND_CHANGED`: Timeout triggered round step increase.

### 4.4 Validator & Network
- `VALIDATOR_STARTED` / `VALIDATOR_STOPPED`: Process lifecycle transitions.
- `VALIDATOR_STATUS_CHANGED`: Health status set to Online, Offline, or Degraded.
- `PEER_CONNECTED` / `PEER_DISCONNECTED`: P2P framing transport state.
- `PEER_BANNED`: Malicious or unauthorized peer disconnected and blacklisted.

### 4.5 Security & TLS
- `TLS_HANDSHAKE_SUCCEEDED` / `TLS_HANDSHAKE_FAILED`: Mutual TLS verification.
- `TLS_CERTIFICATE_RELOADED`: Hot certificate update without process restart.
- `KEY_STAGED` / `KEY_ACTIVATED` / `KEY_ROTATED`: Consensus key rotation lifecycle.

---

## 5. Finality Lifecycle Guarantee

Events maintain explicit `finalityStatus`:
1. `PENDING`: Candidate blocks or uncommitted consensus votes.
2. `COMMITTED`: State written to memory or staged journal.
3. `FINALIZED`: Verified by 2/3+ consensus quorum and committed to immutable ledger.
4. `REVERTED`: Discarded candidate or aborted transaction.

> **Zero Pre-Finality Premature Claims**: Blocks and transactions are never emitted with `FINALITY_STATUS.FINALIZED` until full cryptographic signature and hash continuity checks have succeeded.

---

## 6. Secret Redaction & Invariant Defense

The `sanitizePayload` engine recursively traverses all fields in an event payload before persistence or emission:
- Redacted fields: `privateKey`, `privKey`, `secret`, `secretKey`, `password`, `passphrase`, `keystorePassword`, `authChallenge`, `jwtToken`, `token`, `bearer`, `seed`, `seedPhrase`.
- Replaces matches with `'[REDACTED]'`.
- Rejects total payload exceeding `MAX_PAYLOAD_BYTES` (64KB).

