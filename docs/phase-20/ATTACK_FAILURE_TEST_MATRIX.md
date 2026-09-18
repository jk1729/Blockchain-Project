# Phase 20: Attack and Failure Scenario Test Matrix

**Document Reference:** `docs/phase-20/ATTACK_FAILURE_TEST_MATRIX.md`  
**Phase:** 20 — Attack and Failure Simulation  
**Status:** Approved & Implemented  
**Date:** September 2026  

---

## 1. Scenario Catalog Overview

The PDSChain Attack and Failure Simulation catalog defines 29 deterministic, repeatable scenarios across 8 operational domains. All scenarios run in isolated development or staging sandboxes, utilize synthetic identities and keys, and are bounded by strict runtime and resource limits.

---

## 2. Complete Scenario Matrix

### 2.1 Authentication and Authorization (`AUTH-*`)

| Scenario ID | Name | Severity | Runtime Budget | Preconditions | Injection Mechanism | Expected System Response | Invariants Verified |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **AUTH-001** | Invalid Credentials & Token Structure | MEDIUM | 5,000 ms | Unregistered permission, malformed token | Inject junk bearer token & unknown permission ID | Request denied (`HTTP 401/403`, `E_FORBIDDEN`), security audit logged | `SECURITY_DEFAULT_DENY`, `SECURITY_ZERO_SECRET_LEAKAGE` |
| **AUTH-002** | Expired & Replay Tokens | MEDIUM | 5,000 ms | Token with expired `exp` timestamp | Submit expired token to protected endpoint | Token rejected with 401 Unauthorized, zero secret leakage | `SECURITY_DEFAULT_DENY`, `SECURITY_ZERO_SECRET_LEAKAGE` |
| **AUTH-003** | IDOR / BOLA Cross-Entity Access | HIGH | 5,000 ms | Shop Officer assigned to SHOP-001 | Submit ration distribution request targeting SHOP-002 | Request rejected due to entity scope mismatch | `SECURITY_DEFAULT_DENY`, `SECURITY_ZERO_SECRET_LEAKAGE` |
| **AUTH-004** | Privilege Escalation / Admin Bypass | HIGH | 5,000 ms | Citizen role credentials | Call node restore and key rotation endpoints | Denied (HTTP 403), zero privilege escalation | `SECURITY_DEFAULT_DENY`, `SECURITY_ZERO_SECRET_LEAKAGE` |
| **AUTH-005** | Brute Force & Rate Limiting | MEDIUM | 5,000 ms | Multiple requests from same IP | Burst 50 failed auth requests in <100ms | Requests throttled with HTTP 429 / 403, metric incremented | `SECURITY_DEFAULT_DENY`, `SECURITY_ZERO_SECRET_LEAKAGE` |

### 2.2 Input, Protocol, and API Abuse (`INPUT-*`)

| Scenario ID | Name | Severity | Runtime Budget | Preconditions | Injection Mechanism | Expected System Response | Invariants Verified |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **INPUT-001** | Oversized JSON Body Handling | MEDIUM | 5,000 ms | 6MB payload submitted | Transmit request exceeding 5MB limit | HTTP 413 Payload Too Large returned, memory bounded | `SECURITY_ZERO_SECRET_LEAKAGE` |
| **INPUT-002** | Prototype Pollution Containment | HIGH | 5,000 ms | Payload containing `__proto__` keys | Transmit JSON with poisoned constructor/proto | Dangerous keys stripped, `Object.prototype` unmodified | `PROTOTYPE_IMMUNITY`, `SECURITY_ZERO_SECRET_LEAKAGE` |
| **INPUT-003** | Path Traversal Sanitization | HIGH | 5,000 ms | Query containing `../../` strings | Request filesystem resource with traversal patterns | Traversal blocked, sandbox boundary preserved | `PATH_TRAVERSAL_PREVENTION`, `SECURITY_ZERO_SECRET_LEAKAGE` |
| **INPUT-004** | Malformed JSON-RPC Batch & Duplicate IDs | MEDIUM | 5,000 ms | JSON-RPC batch request | Send empty batch `[]` and batch with duplicate IDs | Spec-compliant JSON-RPC errors returned (`-32600`) | `JSON_RPC_VALIDATION`, `SECURITY_ZERO_SECRET_LEAKAGE` |

### 2.3 Consensus and Byzantine Faults (`CONSENSUS-*`)

| Scenario ID | Name | Severity | Runtime Budget | Preconditions | Injection Mechanism | Expected System Response | Invariants Verified |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **CONSENSUS-001**| Double-Voting Equivocator Detection | CRITICAL| 5,000 ms | 2 votes for different proposals in same round | Submit two conflicting votes from same validator | Second vote rejected, conflict logged as equivocation | `BYZANTINE_DOUBLE_VOTE_CONTAINMENT`, `LEDGER_MONOTONIC_HEIGHT` |
| **CONSENSUS-002**| Stale Round Message Rejection | MEDIUM | 5,000 ms | Active round is 5 | Transmit vote carrying round 2 | Message discarded without affecting active round | `STALE_ROUND_DEFENSE`, `LEDGER_MONOTONIC_HEIGHT` |
| **CONSENSUS-003**| Validator Crash, Quorum Loss & Recovery | HIGH | 5,000 ms | 4-validator cluster (quorum = 3) | Halt 2 validators, observe stall, return 1 validator | Finalization pauses during fault, resumes on recovery | `LEDGER_MONOTONIC_HEIGHT`, `LEDGER_SEQUENCE_CONTINUITY` |
| **CONSENSUS-004**| Stale Writer Fencing Rejection | CRITICAL| 5,000 ms | Active token = 10, stale token = 9 | Attempt write using stale token 9 | Write rejected, candidate token 11 accepted | `DATABASE_WRITER_FENCING`, `LEDGER_IMMUTABLE_BLOCK_HASH` |

### 2.4 Networking and Peer Failures (`NETWORK-*`)

| Scenario ID | Name | Severity | Runtime Budget | Preconditions | Injection Mechanism | Expected System Response | Invariants Verified |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **NETWORK-001** | Peer Disconnect & Reconnect Recovery | MEDIUM | 5,000 ms | Connected peer mesh | Force peer socket disconnect, run reconnect loop | State transitions DISCONNECTED -> RECONNECTING -> CONNECTED | `PEER_MESH_RECOVERY`, `SECURITY_ZERO_SECRET_LEAKAGE` |
| **NETWORK-002** | Packet Delay & Jitter Handling | LOW | 5,000 ms | Streaming sequence of packets | Transmit packets out of order (102, 101, 103) | Jitter buffer reorders sequence without data loss | `NETWORK_JITTER_RESILIENCE`, `LEDGER_SEQUENCE_CONTINUITY` |
| **NETWORK-003** | Unauthenticated Peer Handshake Rejection | HIGH | 5,000 ms | Rogue peer with invalid cert | Untrusted peer attempts TLS handshake | Handshake rejected, connection closed | `SECURITY_DEFAULT_DENY`, `SECURITY_ZERO_SECRET_LEAKAGE` |

### 2.5 Database and Storage Failures (`DATABASE-*`)

| Scenario ID | Name | Severity | Runtime Budget | Preconditions | Injection Mechanism | Expected System Response | Invariants Verified |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **DATABASE-001**| Transaction Rollback Atomicity | HIGH | 5,000 ms | In-flight multi-statement transaction | Inject constraint violation during commit | Full rollback, pre-transaction count exactly preserved | `DATABASE_ATOMIC_ROLLBACK` |
| **DATABASE-002**| Corrupt Journal Line Quarantine | HIGH | 5,000 ms | Consensus journal stream | Inject unparseable binary garbage line | Corrupt line quarantined to `.corrupt`, valid lines parsed | `JOURNAL_QUARANTINE_ISOLATION`, `SECURITY_ZERO_SECRET_LEAKAGE`|
| **DATABASE-003**| Connection Pool Exhaustion Handling | HIGH | 5,000 ms | Max pool size = 5 connections | Acquire 5 connections, submit 6th query | Backpressure applied, connection released, queue drained | `POOL_EXHAUSTION_BACKPRESSURE`, `SECURITY_ZERO_SECRET_LEAKAGE` |
| **DATABASE-004**| Migration Checksum Mismatch Abortion | HIGH | 5,000 ms | Schema migration checksum registry | Provide altered migration file with mismatched hash | Database startup aborted immediately | `MIGRATION_INTEGRITY_CHECK`, `SECURITY_ZERO_SECRET_LEAKAGE` |

### 2.6 Mempool, Queue, and Resource Exhaustion (`RESOURCE-*`)

| Scenario ID | Name | Severity | Runtime Budget | Preconditions | Injection Mechanism | Expected System Response | Invariants Verified |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **RESOURCE-001**| Mempool Saturation Backpressure | HIGH | 5,000 ms | Mempool capacity = 100 txs | Submit 150 transactions rapidly | First 100 accepted, 50 rejected with backpressure code | `MEMPOOL_CAPACITY_BOUND`, `SECURITY_ZERO_SECRET_LEAKAGE` |
| **RESOURCE-002**| Low-Priority Work Shedding | MEDIUM | 5,000 ms | High system load (95% CPU) | Mix of consensus votes and analytics queries | Optional analytics shed, consensus votes processed | `LOAD_SHEDDING_PROTECTION`, `LEDGER_MONOTONIC_HEIGHT` |
| **RESOURCE-003**| Event Loop Lag & Load Recovery | LOW | 5,000 ms | Heavy synchronous computation | Trigger 10ms compute burst | Event loop recovers normal latency within budget | `EVENT_LOOP_RESPONSIVENESS`, `SECURITY_ZERO_SECRET_LEAKAGE` |

### 2.7 Observability and Monitoring Failures (`OBSERVABILITY-*`)

| Scenario ID | Name | Severity | Runtime Budget | Preconditions | Injection Mechanism | Expected System Response | Invariants Verified |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **OBSERVABILITY-001**| Logger Transport Failure Isolation | MEDIUM | 5,000 ms | Primary logging transport | Simulate disk write failure in logger stream | Logger fails safely, consensus transaction completes | `LOG_FAILURE_NONBLOCKING_ISOLATION`, `LEDGER_MONOTONIC_HEIGHT` |
| **OBSERVABILITY-002**| Health Probe Status Degradation | MEDIUM | 5,000 ms | Node with failing database probe | Inject database probe failure | `/health/ready` returns 503, `/health/live` remains 200 | `HEALTH_PROBE_GRANULARITY`, `SECURITY_ZERO_SECRET_LEAKAGE` |
| **OBSERVABILITY-003**| Metrics Scrape Resilience & Fallback | LOW | 5,000 ms | Prometheus metrics renderer | Inject formatting error during scrape | Scraper catches error, returns minimal fallback metric | `METRICS_SCRAPE_ISOLATION`, `SECURITY_ZERO_SECRET_LEAKAGE` |

### 2.8 Backup, Disaster Recovery, and Restore (`RECOVERY-*`)

| Scenario ID | Name | Severity | Runtime Budget | Preconditions | Injection Mechanism | Expected System Response | Invariants Verified |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **RECOVERY-001**| Corrupted Backup Rejection | CRITICAL| 5,000 ms | AES-256-GCM encrypted backup bundle | Flip 1 byte in ciphertext, attempt restore | Decryption authentication fails, restore aborted | `BACKUP_TAMPER_REJECTION`, `LEDGER_MONOTONIC_HEIGHT` |
| **RECOVERY-002**| Staging Restore & Manifest Integrity | HIGH | 5,000 ms | Staging directory for database restore | Verify SHA-256 manifest before live promotion | Manifest verified in sandbox before hot promotion | `STAGING_RESTORE_INTEGRITY`, `LEDGER_SEQUENCE_CONTINUITY` |
| **RECOVERY-003**| Disaster Recovery RPO & RTO Measurement| HIGH | 5,000 ms | Simulated node crash at height 105 | Perform cold recovery from synchronized snapshot | Recovered at height 105; RPO = 0 blocks, RTO measured | `ZERO_RPO_GUARANTEE`, `LEDGER_MONOTONIC_HEIGHT` |

