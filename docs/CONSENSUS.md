# PDSChain — Federated Byzantine Agreement (FBA) Consensus Specification

## 1. Consensus Architecture

PDSChain uses a **12-Validator Permissioned Federated Byzantine Agreement (FBA)** consensus protocol (`backend/src/consensus/FBAConsensus.js`, `ValidatorNode.js`, `ConsensusCertificate.js`).

### Consortium Validator Set (`VAL-01` – `VAL-12`)
The network is governed by 12 institutional validator identities representing distinct oversight bodies:
- `VAL-01`: Ministry of Consumer Affairs, Food & Public Distribution (Primary Proposer)
- `VAL-02`: Food Corporation of India (FCI) HQ
- `VAL-03`: State Civil Supplies Corporation — North
- `VAL-04`: State Civil Supplies Corporation — South
- `VAL-05`: State Civil Supplies Corporation — East
- `VAL-06`: State Civil Supplies Corporation — West
- `VAL-07`: Comptroller & Auditor General (CAG) Audit Node
- `VAL-08`: National Informatics Centre (NIC) Ledger Relay
- `VAL-09`: Central Vigilance Commission (CVC) Observer
- `VAL-10`: State Warehousing Corporation (SWC)
- `VAL-11`: Consumer Rights & Transparency Watchdog
- `VAL-12`: Academic & Independent Verification Node

Each validator possesses a unique Ed25519 keypair (`PDS1...` address) registered in the identity registry.

---

## 2. Quorum Rules & Byzantine Fault Tolerance

- **Total Validators ($N$)**: `12`
- **Quorum Threshold ($Q$)**: `9` ($75\%$ supermajority, i.e., $2f + 1$ with $f = 3$ Byzantine/offline fault tolerance)
- **Safety Guarantee**: Any two quorums of size $\ge 9$ out of $12$ intersect in at least $9 + 9 - 12 = 6$ validators. Even if $f = 3$ validators are equivocating or malicious, at least $6 - 3 = 3$ honest validators overlap between any two quorums, preventing conflicting block finalization in the same round.
- **Liveness Condition**: Consensus succeeds as long as at least `9` of the `12` validators are online (`Status === 'Online'`) and cast valid `ACCEPT` votes. If `4` or more validators are offline (`<= 8` active), quorum fails (`achieved: false`), and the candidate block is rejected before any database or ledger commit occurs.

---

## 3. Four-Stage Consensus Pipeline

1. **Stage 1 — Candidate Proposal & Payload Verification**:
   - The proposer (`VAL-01`) constructs a candidate block containing the transaction batch, `merkleRoot`, and predicted `stateRoot`, and signs the canonical proposal header (`proposerSignature`).
2. **Stage 2 — Independent Validator Evaluation & Ed25519 Voting**:
   - Each online `ValidatorNode` verifies:
     - Proposer identity and Ed25519 `proposerSignature`.
     - Transaction Ed25519 signatures and nonces.
     - Merkle root and state root validity.
   - Each consenting validator signs a canonical `PDSCHAIN_VOTE_V1` payload (`{ validatorId, validatorAddress, validatorPublicKey, proposalId, blockNumber, blockHash, stateRoot, round, vote: 'ACCEPT' }`).
3. **Stage 3 — Quorum Evaluation & Certificate Assembly**:
   - `ConsensusCertificate` verifies every vote signature against the validator's public key, rejects duplicate validator IDs, and checks `validApprovals.length >= 9`.
4. **Stage 4 — Atomic Block Finalization**:
   - Only when `consensusResult.achieved === true` does `transactionService` commit the SQLite/PostgreSQL transaction and append the block to the chain.

---

## 4. Operating Modes: Local Consortium Simulation vs. Multi-Process P2P Network

PDSChain supports two clearly distinguished operating modes:

1. **In-Process Consortium Simulation Mode (Default Application Server)**:
   - When running `npm start` (`src/server.js`), all 12 `ValidatorNode` instances execute in-process with real Ed25519 cryptographic signing and verification.
   - This mode allows interactive fault-tolerance demonstration via the Validator Telemetry Portal (`/html/validator/validator.html`), where operators can toggle `VAL-07` offline (`11/12` — Quorum Met) or 4 nodes offline (`8/12` — Quorum Failed).
2. **Multi-Process Distributed Validator Mode (`src/validators/validatorProcess.js` & `docker-compose.network.yml`)**:
   - Separate OS processes or Docker containers run independent `ValidatorProcess` daemons communicating over length-prefixed TCP wire framing (`WireProtocol.js`) with Ed25519 challenge-response handshakes (`PeerManager.js`).

