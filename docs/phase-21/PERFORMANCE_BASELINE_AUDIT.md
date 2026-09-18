# Phase 21: Performance and Load Testing — Baseline Audit

**Document Reference:** `docs/phase-21/PERFORMANCE_BASELINE_AUDIT.md`  
**Phase:** 21 — Performance and Load Testing  
**Status:** Approved & Implemented  
**Date:** September 2026  

---

## 1. Executive Summary

This audit establishes the performance baseline for **PDSChain**, an enterprise-grade, Byzantine-fault-tolerant, EVM-compatible consortium blockchain orchestrating India's Public Distribution System.

Following the hardening of security and permissions in Phase 17, the production database architecture in Phase 18, the observability platform in Phase 19, and the attack/failure simulation framework in Phase 20, Phase 21 evaluates system performance, throughput, latency profiles, resource utilization, capacity limits, and degradation behavior under realistic, deterministic workloads.

---

## 2. Audit of Existing Subsystems & Performance-Sensitive Paths

### 2.1 API, JSON-RPC, and SSE Request Pipelines
- **REST APIs (`/api/v1/*`)**:
  - Express.js middleware pipeline: CORS -> JSON body parser (100KB limit) -> `RequestContext` propagation -> OpenTelemetry tracing middleware -> HTTP metrics collector (`pds_http_request_duration_seconds`) -> Rate limiter -> Authentication (`authMiddleware`) -> Authorization (`permissionMiddleware`).
  - *Bottlenecks*: JSON deserialization on large payloads, cryptographic signature verification on transaction endpoints, and synchronous password hashing if auth endpoints are saturated.
- **JSON-RPC Engine (`/api/v1/rpc`)**:
  - Handles single and batched RPC calls (`eth_blockNumber`, `eth_chainId`, `eth_getBlockByNumber`, `eth_sendRawTransaction`, etc.).
  - *Bottlenecks*: Batch request parsing, duplicate ID deduplication, and recursive EVM state queries.
- **Server-Sent Events (`/api/v1/events/stream`)**:
  - Real-time event broadcasting to subscribed clients.
  - *Bottlenecks*: Unbounded memory consumption if clients are slow consumers and buffers accumulate undelivered events.

### 2.2 Transaction Processing & Mempool Subsystem
- **Transaction Submission Pipeline**:
  - `transactionService.submitTransaction()`:
    1. Schema and field format validation.
    2. ECDSA secp256k1 signature recovery and address derivation.
    3. Nonce continuity and account balance verification against state.
    4. EVM isolated pre-execution simulation to verify gas and state roots.
    5. Admission into in-memory mempool.
  - *Bottlenecks*: Cryptographic signature recovery (`secp256k1`), isolated EVM state checkpoints, and mutex locking around nonce sequences.

### 2.3 Consensus & Finality Subsystem
- **Federated Byzantine Agreement (FBA) / PBFT Engine**:
  - Consensus rounds transition through `PROPOSE` -> `PREPARE` -> `COMMIT` -> `FINALIZE`.
  - Quorum certificate generation requires $2f + 1$ Ed25519/ECDSA validator signatures.
  - *Bottlenecks*: Asynchronous vote network broadcasts, signature verification overhead per vote, and disk serialization of consensus journal logs.

### 2.4 Database & Storage Engine
- **SQLite with WAL & Memory Cache**:
  - `DatabaseTransactionManager.js` wraps block commits in immediate transactions.
  - `JournalStorageManager.js` writes append-only consensus events with checksums.
  - `DatabaseHAManager.js` enforces writer fencing tokens.
  - *Bottlenecks*: Single-writer SQLite lock contention during heavy concurrent write loads, WAL checkpoint stalls, and unindexed filter queries on large historical datasets.

### 2.5 Ledger Synchronization & Peer Mesh
- **Peer-to-Peer Catch-up**:
  - TCP-based frame streaming (`MessageCodec`, `StreamDecoder`) with length-prefixed binary frames.
  - Fast block sync streams batches of 50 blocks.
  - *Bottlenecks*: Network latency, socket buffer saturation, and sequential validation of block Merkle trees during catch-up.

---

## 3. Inventory of Existing Observability & Measurement Telemetry

The performance platform reuses Phase 19 Prometheus metrics without duplicate telemetry:
- **Application & HTTP**:
  - `pds_http_requests_total{method, route, status_code}`
  - `pds_http_request_duration_seconds` (Prometheus histogram buckets: 5ms, 10ms, 25ms, 50ms, 100ms, 250ms, 500ms, 1s, 2.5s, 5s)
  - `pds_http_requests_in_flight`
  - `pds_rpc_requests_total`, `pds_rpc_duration_seconds`
  - `pds_sse_connections_active`, `pds_sse_events_delivered_total`
- **Blockchain & Consensus**:
  - `pds_blockchain_block_height`
  - `pds_blockchain_blocks_finalized_total`
  - `pds_consensus_round_duration_seconds`
  - `pds_consensus_round_timeouts_total`
  - `pds_consensus_votes_total`
  - `pds_mempool_size`, `pds_mempool_rejections_total`
- **Database & HA**:
  - `pds_db_pool_active_connections`, `pds_db_pool_waiting_requests`
  - `pds_db_transactions_committed_total`, `pds_db_transactions_rolled_back_total`
  - `pds_db_query_duration_seconds`
- **Runtime System**:
  - `pds_process_uptime_seconds`
  - `pds_runtime_event_loop_lag_seconds`
  - `pds_runtime_heap_used_bytes`, `pds_runtime_rss_bytes`
  - `pds_runtime_cpu_user_seconds_total`, `pds_runtime_cpu_system_seconds_total`

---

## 4. Critical User Journeys & Workload Shapes

| User Journey | Key Operations | Expected Workload Shape | Performance Target |
| :--- | :--- | :--- | :--- |
| **Citizen Ration Inquiry** | Auth -> Beneficiary profile lookup -> Quota query | High concurrency, read-heavy, low payload (<1KB) | p95 < 50ms, 500 RPS |
| **Shop Commodity Distribution** | Auth -> Inventory check -> Sign transaction -> Submit tx -> Await receipt | Moderate concurrency, write-intensive, payload ~2KB | p95 < 200ms, 250 TPS |
| **Consensus Round Progress** | Candidate block proposal -> Vote validation -> Quorum commit -> Ledger write | High throughput internal network, bounded batch | 1 block / 2-3s, 0 stalls |
| **Ledger Catch-Up Sync** | Peer handshake -> Request block headers -> Batch download -> Merkle verify | Sustained streaming, high bandwidth | 50 blocks/sec catch-up |
| **Auditor Explorer Query** | Block height lookup -> Merkle proof generation -> Transaction history | Low concurrency, heavy read, complex joins | p95 < 100ms, 50 RPS |

---

## 5. Performance Measurement Risks & Anti-Production Safeguards

1. **Risk: False High Latency from Telemetry Overhead**:
   - *Mitigation*: Benchmark runs are sampled with telemetry enabled and disabled to isolate instrumentation cost. High-resolution timestamps use `process.hrtime.bigint()` rather than heavy logging.
2. **Risk: Uncontrolled Resource Starvation in Dev Environment**:
   - *Mitigation*: Hard limits on duration (default 60s), concurrency (max 50 workers), and rate (max 1,000 req/s).
3. **Risk: Inaccurate Percentiles from Coarse Binning**:
   - *Mitigation*: Exact sorting of latency arrays for datasets up to 100,000 requests, producing accurate p50, p90, p95, p99, and max values.
4. **Risk: Accidental Production Targeting**:
   - *Mitigation*: `SafetyGuard.validateExecutionSafety()` verifies `PERFORMANCE_TEST_MODE=true` and rejects non-loopback hosts and production keywords.

