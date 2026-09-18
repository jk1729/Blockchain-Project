# PDSChain Phase 9: Network Architecture & Topology

## Executive Summary

Phase 9 transforms PDSChain from an in-process validator simulation into a production-grade, authenticated peer-to-peer network where each institutional validator runs as an isolated operating-system process with dedicated filesystem storage, state databases, EVM runtime, write-ahead journals, and length-prefixed streaming sockets.

---

## 1. Dual-Layer Networking Architecture

PDSChain decouples network transport security from cryptographic validator consensus identity through two orthogonal protection layers:

```text
+-------------------------------------------------------------------------+
| Layer 1: Transport Layer Security (TLS / mTLS)                         |
| - TCP socket encryption with optional mutual certificate authentication  |
| - Protects against passive eavesdropping, wire sniffing, and MITM       |
| - Length-prefixed 4-byte BE streaming frame codec                       |
+-------------------------------------------------------------------------+
                                    |
                                    v
+-------------------------------------------------------------------------+
| Layer 2: Mutual Ed25519 Identity Authentication Handshake               |
| - Dynamic 32-byte cryptographic challenge-response nonces               |
| - Ed25519 signature verified against institutional keystore             |
| - Single-use replay protection & 10-second challenge TTL                |
| - Zero-knowledge of private keys (never transmitted over wire)          |
+-------------------------------------------------------------------------+
                                    |
                                    v
+-------------------------------------------------------------------------+
| Layer 3: PDSChain Application & Consensus Layer (FBA)                   |
| - Federated Byzantine Agreement (3-of-4 slices, 9-of-12 threshold)     |
| - Independent cryptographic vote & proposal verification                |
| - Deterministic EVM execution & Merkle state-root generation            |
+-------------------------------------------------------------------------+
```

---

## 2. Federation Topology & Deterministic Port Allocation

The 12 institutional validators in PDSChain have deterministic port assignments for both their external HTTP management API and their authenticated internal P2P streaming transport:

| Validator ID | Institutional Entity | HTTP API Port | P2P Transport Port | Quorum Slice | Slice Threshold |
|---|---|:---:|:---:|:---:|:---:|
| `VAL-01` | Ministry of Consumer Affairs | 4001 | 5001 | `['VAL-01', 'VAL-02', 'VAL-03', 'VAL-04']` | 3 of 4 |
| `VAL-02` | National Informatics Centre | 4002 | 5002 | `['VAL-02', 'VAL-03', 'VAL-05', 'VAL-06']` | 3 of 4 |
| `VAL-03` | State Food Commission | 4003 | 5003 | `['VAL-01', 'VAL-03', 'VAL-07', 'VAL-08']` | 3 of 4 |
| `VAL-04` | Civil Supplies Corporation | 4004 | 5004 | `['VAL-01', 'VAL-04', 'VAL-09', 'VAL-10']` | 3 of 4 |
| `VAL-05` | District Administration Node | 4005 | 5005 | `['VAL-02', 'VAL-05', 'VAL-07', 'VAL-11']` | 3 of 4 |
| `VAL-06` | Auditor General Observer | 4006 | 5006 | `['VAL-02', 'VAL-06', 'VAL-08', 'VAL-12']` | 3 of 4 |
| `VAL-07` | Public Audit & Governance | 4007 | 5007 | `['VAL-03', 'VAL-05', 'VAL-07', 'VAL-09']` | 3 of 4 |
| `VAL-08` | Regional Warehouse Authority | 4008 | 5008 | `['VAL-03', 'VAL-06', 'VAL-08', 'VAL-10']` | 3 of 4 |
| `VAL-09` | Fair Price Shop Union | 4009 | 5009 | `['VAL-04', 'VAL-07', 'VAL-09', 'VAL-11']` | 3 of 4 |
| `VAL-10` | State Monitoring Cell | 4010 | 5010 | `['VAL-04', 'VAL-08', 'VAL-10', 'VAL-12']` | 3 of 4 |
| `VAL-11` | Citizen Oversight Organisation | 4011 | 5011 | `['VAL-05', 'VAL-09', 'VAL-11', 'VAL-12']` | 3 of 4 |
| `VAL-12` | Security & Cryptography Validator | 4012 | 5012 | `['VAL-06', 'VAL-10', 'VAL-11', 'VAL-12']` | 3 of 4 |

---

## 3. Streaming Framing & Message Serialization

Over the wire, all network communication is framed using a 4-byte big-endian length prefix followed by UTF-8 encoded canonical JSON:

```text
+-------------------+-----------------------------------------------+
| Length (4 Bytes)  | Message Payload (N Bytes UTF-8 JSON)          |
| Big-Endian UInt32 | {"version":1,"networkId":"...","type":"..."}  |
+-------------------+-----------------------------------------------+
```

### Safety Guards:
1. **Oversized Frame Guard**: Frames with length $> 4\text{ MB}$ (or configured `maxFrameSizeBytes`) are immediately rejected before buffer allocation to prevent denial-of-service memory exhaustion.
2. **Partial Stream Accumulation**: The `StreamDecoder` buffers partial TCP chunks and emits frames only upon complete length-prefix ingestion.
3. **Concatenated Frame Splitting**: When multiple frames arrive in a single TCP socket packet, the decoder sequentially processes each complete frame in the chunk.

---

## 4. Separation of Transport from Consensus Authority

A fundamental architectural rule of PDSChain is that **the network transport is never a consensus authority**:
- Receiving an envelope over a valid TCP/TLS connection does NOT make its content trustworthy.
- Every candidate block proposal must independently verify the proposer's Ed25519 signature and state-root transition.
- Every vote received over the network must be independently verified via `ValidatorVote.verifySignature()` and checked against `ConflictDetector` to prevent double-voting/equivocation.
- Every consensus certificate must verify that at least 9 valid validator approvals exist, satisfying institutional quorum slices.

