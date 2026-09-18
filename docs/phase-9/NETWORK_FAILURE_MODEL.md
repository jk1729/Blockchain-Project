# PDSChain Phase 9: Network Failure Model, Partitions & Adversarial Resilience

## 1. Threat Model & Assumptions

PDSChain operates under a partially synchronous network model with a Byzantine adversary:
- Network messages may be delayed, duplicated, reordered, or temporarily dropped by network unreliability or adversarial tampering.
- Adversarial validators may send arbitrary, forged, or conflicting statements (equivocation/double-voting).
- Up to $f = 3$ validators out of $N = 12$ may be Byzantine, crash, or collude without compromising safety.
- Global agreement requires at least $2f + 1 = 9$ validators agreeing across intersecting institutional quorum slices.

---

## 2. Network Partitions & Split-Brain Prevention

A key property verified in Phase 9 is safety under complete network partition:

```text
               +-------------------------------------------+
               |        12-Validator FBA Federation        |
               +-------------------------------------------+
                                     |
                       [ Complete Network Partition ]
                                     |
                +--------------------+--------------------+
                |                                         |
                v                                         v
     +--------------------+                    +--------------------+
     |   Partition Alpha  |                    |   Partition Beta   |
     |   VAL-01 .. VAL-06 |                    |   VAL-07 .. VAL-12 |
     |      (6 Nodes)     |                    |      (6 Nodes)     |
     +--------------------+                    +--------------------+
                |                                         |
         Max Agreement = 6                         Max Agreement = 6
        Threshold = 9 (FAIL)                      Threshold = 9 (FAIL)
                |                                         |
                +--------------------+--------------------+
                                     v
                  +-------------------------------------+
                  |   NO BLOCKS CAN BE FINALIZED ON     |
                  |     EITHER SIDE OF THE PARTITION    |
                  |   (SAFETY & CONSISTENCY PRESERVED)  |
                  +-------------------------------------+
```

Because global agreement requires at least 9 validators and each institutional quorum slice requires 3-of-4 trusted peers:
1. No single partition with $\le 8$ nodes can achieve finality.
2. Divergent chain forks are mathematically impossible.
3. The chain safely pauses progress (prioritizing consistency over availability in accordance with the CAP theorem) until partition healing occurs.

---

## 3. Handled Adversarial Scenarios

| Attack / Failure Vector | Detection & Defense Mechanism |
|---|---|
| **Handshake Replay** | Challenge nonces are single-use (`consumeChallenge`) and expire after 10 seconds. |
| **Impersonation** | Message sender ID must match authenticated socket peer ID and cryptographic signature. |
| **Framing Overflow** | Packets claiming length $> 4\text{ MB}$ trigger immediate connection termination before memory allocation. |
| **Partial Stream Starvation** | `StreamDecoder` buffers partial frames; inactivity watchdog closes dead connections. |
| **Equivocation (Double-Voting)** | `ConflictDetector` intercepts and rejects multiple conflicting votes from the same validator for competing blocks in the same round. |
| **Tampered Wire Content** | `MessageEnvelope.isTampered()` verifies that the deterministic message ID matches the canonical payload hash. |
| **Message Floods / Replays** | `MessageRouter` deduplication sliding cache filters out duplicate message IDs within a 60-second window. |
| **Forged Block Proposal** | Evaluated via Ed25519 public key verification of `candidateBlock.proposerSignature`. |
| **Out-of-Order Block Sync** | `SyncHandler` rejects non-contiguous block heights (`height != latest + 1`) and parent hash mismatches. |
| **Fake Consensus Certificate** | `ConsensusCertificate.verify()` independently checks cryptographic signatures of all approvals and confirms $\ge 9$ valid validator signatures. |

