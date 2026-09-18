# PDSChain Consensus Model: Federated Byzantine Agreement (FBA)

**Protocol Specification & Formal Model**  
**Version:** Phase 8.0  
**Target Subsystem:** `backend/src/consensus`

---

## 1. Introduction & Design Philosophy

PDSChain utilizes a **Federated Byzantine Agreement (FBA)** model tailored for an institutional, permissioned Public Distribution System. 

Unlike Proof-of-Work (PoW) or Proof-of-Stake (PoS), FBA does not rely on computational burn, native token capital, or miners. Instead, consensus is reached through **federated trust relationships**, where each institutional validator independently specifies which peers it trusts to form agreement.

### Key Architectural Tenets
1. **Zero Cryptocurrency / Zero Gas:** Consensus is not incentivized by economic tokens; validators operate as regulatory and civil supply stakeholders.
2. **Deterministic Round Progression:** Each block height progresses through discrete, cryptographically signed rounds.
3. **Dual-Condition Finality:** A block is only finalized if:
   - Every node in the agreeing set has its individual quorum slice satisfied.
   - The total number of agreeing validators meets or exceeds the global threshold ($9 / 12 = 75\%$).
4. **Decoupled EVM Execution:** Consensus coordinates agreement on canonical block proposals; execution occurs deterministically in an isolated EVM sandbox (`@ethereumjs/vm`).

---

## 2. Validator Topology & Institutional Roles

PDSChain configures **12 institutional validators** representing the cross-section of central government, state logistics, civil oversight, and technical audit bodies:

| Node ID | Institution | Institutional Role | Quorum Slice ($S_v$) | Threshold ($k_v$) |
|---|---|---|---|---|
| **VAL-01** | Ministry of Consumer Affairs | Central Government Policy & Allocation | `{VAL-01, VAL-02, VAL-03, VAL-04}` | 3 of 4 |
| **VAL-02** | National Informatics Centre (NIC) | Central Core IT & Database Infrastructure | `{VAL-02, VAL-03, VAL-05, VAL-06}` | 3 of 4 |
| **VAL-03** | State Food Commission | Statutory Regulator & Rights Enforcement | `{VAL-01, VAL-03, VAL-07, VAL-08}` | 3 of 4 |
| **VAL-04** | Civil Supplies Corporation | State Logistics & Supply Chain Handling | `{VAL-01, VAL-04, VAL-09, VAL-10}` | 3 of 4 |
| **VAL-05** | District Administration Node | District Collectorate & Grievance Cell | `{VAL-02, VAL-05, VAL-07, VAL-11}` | 3 of 4 |
| **VAL-06** | Auditor General Observer Node | Comptroller & Auditor General (CAG) | `{VAL-02, VAL-06, VAL-08, VAL-12}` | 3 of 4 |
| **VAL-07** | Public Audit & Governance Node | Independent Civil Society Audit Council | `{VAL-03, VAL-05, VAL-07, VAL-09}` | 3 of 4 |
| **VAL-08** | Regional Warehouse Authority | Civil Supplies Depots & Stock Custodians | `{VAL-03, VAL-06, VAL-08, VAL-10}` | 3 of 4 |
| **VAL-09** | Fair Price Shop Union Node | FPS Dealers & Frontline Ration Shops | `{VAL-04, VAL-07, VAL-09, VAL-11}` | 3 of 4 |
| **VAL-10** | State Monitoring Cell | Real-time Dashboard & E-Governance | `{VAL-04, VAL-08, VAL-10, VAL-12}` | 3 of 4 |
| **VAL-11** | Citizen Oversight Organisation | Civil Rights, Beneficiaries & Transparency | `{VAL-05, VAL-09, VAL-11, VAL-12}` | 3 of 4 |
| **VAL-12** | Security & Cryptography Validator | National Cryptographic Board / Certifier | `{VAL-06, VAL-10, VAL-11, VAL-12}` | 3 of 4 |

---

## 3. Mathematical Quorum & Slice Formalism

### 3.1 Quorum Slices
For each validator $v \in V$, let $S_v \subset V$ denote the set of trusted peers configured for $v$. Node $v$ requires agreement from at least $k_v$ members of $S_v$ (where $k_v = 3$ and $|S_v| = 4$).

A set of nodes $U \subseteq V$ **satisfies** validator $v$'s quorum slice if:
$$|S_v \cap U| \ge k_v$$

### 3.2 Quorum Definition
A non-empty subset $U \subseteq V$ is an **FBA Quorum** if and only if:
$$\forall v \in U, \quad |S_v \cap U| \ge k_v$$

In other words, a quorum is a self-sustaining agreement cluster where every participating member has its individual trust slice satisfied by other members within the cluster.

### 3.3 Network Agreement Threshold
To ensure global network agreement across overlapping regional and ministerial jurisdictions, PDSChain imposes a **global agreement threshold**:
$$\text{Threshold} = 9 \quad (\ge 75\% \text{ of } 12 \text{ nodes})$$

Thus, candidate block approval requires:
1. $U$ is a valid FBA Quorum.
2. $|U| \ge 9$.

---

## 4. Quorum Intersection & Fault Tolerance Analysis

### 4.1 Quorum Intersection
Consensus safety depends on **quorum intersection**: any two quorums $Q_1, Q_2 \subseteq V$ must share at least one honest validator to prevent network partitions and conflicting blocks (forks).

In the PDSChain 12-validator configuration with threshold $k=9$:
- Let $Q_1$ and $Q_2$ be any two valid quorums.
- $|Q_1| \ge 9$ and $|Q_2| \ge 9$.
- By the Pigeonhole Principle:
  $$|Q_1 \cap Q_2| = |Q_1| + |Q_2| - |Q_1 \cup Q_2| \ge 9 + 9 - 12 = 6$$

Every pair of valid quorums intersects in **at least 6 nodes**.

### 4.2 Byzantine Fault Tolerance Limit
- If up to $f = 3$ validators are Byzantine (malicious, colluding, or compromised), the intersection of any two quorums contains at least:
  $$|Q_1 \cap Q_2| - f \ge 6 - 3 = 3 \text{ honest nodes}$$
- Since honest nodes never double-vote for conflicting blocks in the same round, no two conflicting candidate blocks can both gather 9 signatures.
- **Safety is guaranteed for up to $f \le 3$ Byzantine nodes** (equivalent to standard $3f + 1 \le 12 \implies f = 3$).

### 4.3 Crash Fault Tolerance (Liveness)
- If up to 3 validators crash or disconnect, $12 - 3 = 9$ nodes remain online.
- Because the slices are interconnected with $k_v = 3$, the remaining 9 nodes can still satisfy quorum conditions and finalize blocks.
- If 4 or more validators go offline, $|U| < 9$, and the network safely halts block production rather than risking an unsafe split.

---

## 5. Distinction from Stellar Consensus Protocol (SCP)

It is critical to distinguish PDSChain's FBA protocol from the full Stellar Consensus Protocol (SCP):

| Feature | Stellar Consensus Protocol (SCP) | PDSChain FBA Protocol |
|---|---|---|
| **Consensus Structure** | Asynchronous Federated Byzantine Agreement | Synchronous / Round-based FBA with explicit proposer |
| **Phases per Slot** | Nomination Phase + Balloting Phase (PREPARE, COMMIT, EXTERNALIZE) | 4-Phase Deterministic Pipeline (PROPOSAL, PREVOTE, ACCEPT, FINALIZE) |
| **Liveness Mechanism** | Dynamic timer-driven nomination convergence | Proposer round-robin + round timeout advancement |
| **Consensus Payload** | Transaction sets | Candidate Block with Merkle Root, EVM State Root, and Receipt Root |
| **Proof of Finality** | Stellar ledger close metadata | Self-contained `ConsensusCertificate` with threshold Ed25519 signatures |
| **Target Scale** | Open, permissionless federated global payment network | Permissioned 12-institution public food distribution infrastructure |

PDSChain adapts the core mathematical principles of FBA (slices, quorums, and intersection) to a clean, deterministic, auditable system suitable for public governance.

