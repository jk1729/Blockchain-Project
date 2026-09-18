# Phase 9 Baseline Audit: PDSChain Validator Networking & Multi-Process Architecture

**Date:** 2026-09-17  
**Project:** PDSChain — Permissioned Public Distribution System Blockchain  
**Status:** Baseline Audited & Verified (358 / 358 Passing Tests)

---

## 1. Executive Summary

This document establishes the official technical baseline for **Phase 9: Real Validator Networking, Authenticated P2P Transport & Multi-Process Consensus**.

Prior to modifying or adding any networking code, the existing repository structure, configuration, consensus execution pathways, identity binding, and testing framework were thoroughly audited.

### Test Execution Baseline
- **Backend Test Suite (Jest):** 18 test suites, 338 tests passing (`node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand --detectOpenHandles --forceExit`) in **25.8s**.
- **Solidity Smart Contract Suite (Hardhat):** 1 test suite, 20 tests passing (`npx hardhat test`) in **3s**.
- **Total Existing Passing Baseline:** **358 / 358 tests (100% pass rate)**.
- **Pre-existing Failures:** 0.

---

## 2. Existing Architecture & Entry Points

| Subsystem | Entry Point / Key Files | Current Architecture & Status |
|---|---|---|
| **Backend HTTP REST API** | `backend/src/server.js`, `backend/src/app.js` | Express application exposing beneficiary, shop, inventory, blockchain, consensus, and EVM contract routes. Listens on `config.PORT` (default: 3000). |
| **Validator Server (Legacy Prototype)** | `backend/src/validators/startValidators.js`, `backend/src/validators/validatorServer.js` | Legacy Phase 1 prototype that runs 12 Express HTTP servers inside a **single** Node.js process on ports 4001–4012 using toy SHA-256 signatures. In practice, consensus tests bypass these and use in-process simulation. |
| **Blockchain & Block Storage** | `backend/src/blockchain/Blockchain.js`, `backend/src/blockchain/Block.js`, `backend/src/blockchain/validation.js` | Sequential block ledger, Merkle tree root calculation (`calculateMerkleRoot`), block hash continuity, and consensus certificate validation (`validateBlockConsensusCertificate`). |
| **Consensus Coordinator** | `backend/src/consensus/FBAConsensus.js` | Singleton coordinator orchestrating rounds, holding `validators` map, `VoteStore`, `QuorumEngine`, `FinalityEngine`, and `ConsensusStateMachine`. |
| **Consensus State Machine** | `backend/src/consensus/ConsensusStateMachine.js`, `backend/src/consensus/ConsensusRound.js` | Discrete consensus states (`IDLE`, `PROPOSAL`, `PREVOTE`, `ACCEPTED`, `CERTIFIED`, `FINALIZED`, `REJECTED`, `TIMEOUT`, `RECOVERING`). Immutability guard on finalized heights. Canonical SHA-256 round IDs. |
| **Vote & Conflict Subsystem** | `backend/src/consensus/ValidatorVote.js`, `backend/src/consensus/VoteStore.js`, `backend/src/consensus/ConflictDetector.js` | Ed25519 signed votes binding `chainId` (1729). Multi-index lookup. Real-time trapping of identical duplicates, double-voting, and equivocations. |
| **Consensus Certificates** | `backend/src/consensus/ConsensusCertificate.js` | Canonical certificate hashing, deterministic ascending validator signature ordering, standalone verification against block and quorum slices. |
| **Identity & Cryptography** | `backend/src/blockchain/identity/keyManager.js`, `backend/src/blockchain/identity/signature.js` | Ed25519 keypairs, deterministic PDS1 addresses (`PDS1` + 40 hex chars). Separate domain tags: `PDSCHAIN_TX_V1`, `PDSCHAIN_BLOCK_V1`, `PDSCHAIN_VOTE_V1`. |
| **EVM Execution Sandbox** | `backend/src/evm/EVMRuntime.js`, `backend/src/evm/EVMStateAdapter.js`, `backend/src/evm/identityBridge.js` | Embedded `@ethereumjs/vm` (Cancun hardfork, chain ID 1729), copy-on-write state checkpoints, deterministic state-root and receipt-root commitments. |
| **Mempool & Execution** | `backend/src/blockchain/mempool/TransactionMempool.js`, `backend/src/execution/ExecutionEngine.js`, `backend/src/execution/StateManager.js` | Transaction admission, per-sender nonces, capacity limits, TTL expiration, deterministic selection. |
| **Database Persistence** | `backend/src/config/database.js`, `backend/src/models/`, `backend/src/consensus/ConsensusJournal.js` | Sequelize with SQLite default (`database/pdschain.sqlite`), WAL-based append-only consensus journal (`database/consensus_journal.jsonl`). |

---

## 3. Current Validator Startup & Message Flow

### 3.1 Current Startup Mechanism
- `npm run validators:start` launches `backend/src/validators/startValidators.js`.
- It iterates through `DEFAULT_12_VALIDATORS` in `backend/src/consensus/consensusConfig.js` and creates 12 Express apps listening on ports 4001 to 4012 within **the same single operating system process**.
- It does **not** launch separate child processes.
- It shares Node's single-threaded event loop and does not isolate memory, EVM state, or storage.

### 3.2 Current Consensus Message Flow
- In `FBAConsensus.js`:
  ```javascript
  async queryValidatorNodeHTTP(node, proposal, options = {}) {
    // Sends HTTP POST to http://127.0.0.1:400X/proposal
    // On connection error/timeout:
    req.on('error', () => {
      resolve(node.evaluateBlockProposal(proposal, options));
    });
  }
  ```
- Because the HTTP servers on ports 4001–4012 are rarely running during unit/integration tests, consensus evaluation immediately falls back to in-process invocation: `node.evaluateBlockProposal(proposal, options)`.
- **Finding:** Currently, validators do not communicate over a real peer-to-peer authenticated transport. Consensus operates via local in-memory simulation.

---

## 4. Current Signature, Identity & Persistence Mechanisms

1. **Identity Representation:**  
   Validators have IDs `VAL-01` to `VAL-12`, with institutional names, Ed25519 public keys, and derived `PDS1...` addresses.
2. **Private Key Storage:**  
   Development keys are deterministically generated on-demand in `keyManager.js` using `PDSCHAIN_DEV_KEY:${entityId}:${entityType}` seed expansion. Private keys are never committed or exposed via API.
3. **Persistence Isolation:**  
   Currently, all components write to a shared SQLite database path (`database/pdschain.sqlite`) and a shared journal (`database/consensus_journal.jsonl`).  
   **Phase 9 Requirement:** Each multi-process validator must maintain its own isolated database directory (`database/validators/{validatorId}/pdschain.sqlite`) and consensus journal (`database/validators/{validatorId}/consensus_journal.jsonl`).

---

## 5. Critical Deficiencies & Gaps to Address in Phase 9

1. **No True Multi-Process Runtime:**  
   Validators do not run as isolated operating system processes with separate memory spaces, isolated database paths, and independent EVM instances.
2. **No Secure P2P Transport Layer:**  
   Validators lack an authenticated transport protocol. Proposals, votes, and certificates are evaluated via in-memory function calls rather than a framed, authenticated wire protocol.
3. **Absence of Peer Authentication & Identity Binding:**  
   No TLS/mTLS or cryptographic handshake exists to verify that an incoming connection belongs to an authorized validator before accepting consensus messages.
4. **No Chain Synchronization Protocol:**  
   If a validator disconnects, restarts, or lags behind, there is no network protocol to request, stream, and validate missed finalized blocks from peers.
5. **No Network Observability:**  
   No endpoints exist to inspect peer connection states, handshake status, network metrics, framing errors, or sync progress.

---

## 6. Files Proposed for Addition and Modification

### 6.1 New Subsystem Files (`backend/src/network/`)
- `backend/src/network/NetworkConfig.js`: Validated schema for P2P ports, peer lists, TLS settings, framing limits, timeouts.
- `backend/src/network/NetworkErrors.js`: Enumerated network error codes and classes.
- `backend/src/network/MessageEnvelope.js`: Versioned message envelope (protocolVersion, networkId, messageType, senderId, messageId, timestamp, payload).
- `backend/src/network/MessageCodec.js`: Length-prefixed framing, canonical serialization, partial read buffering, frame size bounds.
- `backend/src/network/PeerAuthenticator.js`: Cryptographic handshake challenge-response binding TLS transport to Ed25519 validator identity.
- `backend/src/network/PeerConnection.js`: Connection state machine (`DISCONNECTED`, `CONNECTING`, `AUTHENTICATING`, `CONNECTED`, `DEGRADED`, `CLOSING`), heartbeats, message sending.
- `backend/src/network/PeerManager.js`: Peer registry, outbound connection pool, inbound listener, reconnect backoff, broadcast methods.
- `backend/src/network/NetworkMetrics.js`: Operational counters (sent, received, rejected, duplicate, framing errors, latency).
- `backend/src/network/handlers/`:
  - `HandshakeHandler.js`: Protocol negotiation and identity verification.
  - `HeartbeatHandler.js`: Liveness and ping/pong processing.
  - `ProposalHandler.js`: Wire proposal validation and dispatch to consensus.
  - `VoteHandler.js`: Wire vote validation, conflict detection, and dispatch.
  - `CertificateHandler.js`: Wire certificate validation and finality engine dispatch.
  - `RoundChangeHandler.js`: Round timeout and recovery coordination.
  - `SyncHandler.js`: Finalized block range request/response and verification.

### 6.2 Validator Multi-Process Runtime (`backend/src/validators/`)
- `backend/src/validators/validatorProcess.js`: Standalone validator process entry point with isolated database, journal, EVM runtime, and P2P transport.
- `backend/src/validators/processManager.js`: Multi-process orchestrator for spawning, monitoring, and stopping real child processes.

### 6.3 Existing Files to Adapt
- `backend/src/consensus/consensusConfig.js`: Add P2P port assignments (e.g. 5001–5012) and network IDs without breaking existing configs.
- `backend/src/consensus/FBAConsensus.js`: Allow injecting network broadcast transport as alternative/complement to local evaluation.
- `backend/src/routes/networkRoutes.js`, `backend/src/controllers/networkController.js`: Expose read-only network observability APIs.
- `backend/src/app.js`: Mount `/api/network` routes.

---

## 7. Critical Architectural Safeguards

1. **Transport is Not Consensus:**  
   Messages delivered over the P2P network will **never** bypass cryptographic signature validation, quorum slice evaluation, state-machine transitions, or finality rules.
2. **Deterministic EVM Isolation:**  
   Each validator process must independently execute transactions in its own embedded `@ethereumjs/vm` instance and verify matching state roots before emitting an ACCEPT vote.
3. **No Private Key Transmission:**  
   Handshakes use challenge-response signatures. Private keys are never transmitted or logged.
4. **Safety Over Liveness:**  
   If network partition prevents achieving the 9-of-12 threshold, nodes must safely halt block creation rather than forking.

