# Phase 21: Performance and Load Testing — Architecture & Lifecycle

**Document Reference:** `docs/phase-21/PERFORMANCE_TESTING_ARCHITECTURE.md`  
**Phase:** 21 — Performance and Load Testing  
**Status:** Approved & Implemented  
**Date:** September 2026  

---

## 1. Architectural Overview

The PDSChain Performance and Load Testing Platform is engineered as a deterministic, non-destructive, and evidence-driven control plane located within `backend/src/performance/`. It orchestrates bounded, repeatable load profiles against isolated development or staging targets, measuring throughput, latency distributions, resource saturation, and recovery characteristics while enforcing strict safety enclosures.

```
+---------------------------------------------------------------------------------------+
|                             PERFORMANCE CONTROL PLANE                                 |
|                                                                                       |
|  +---------------------+   +-----------------------+   +---------------------------+  |
|  |     SafetyGuard     |-->|   PerformanceRunner   |<--|     WorkloadRegistry      |  |
|  | (Anti-Prod / Fencing|   |   (Lifecycle Engine)  |   | (Catalog of 6 Domains)    |  |
|  +---------------------+   +-----------+-----------+   +---------------------------+  |
|                                        |                                              |
|                   +--------------------+---------------------+                        |
|                   |                                          |                        |
|         +---------v----------+                     +---------v----------+             |
|         |  WorkloadContext   |                     |   LoadController   |             |
|         | - PRNG (Seed)      |                     | - Rate Pacer (RPS) |             |
|         | - Sandboxed Dirs   |                     | - Concurrency Pool |             |
|         | - Baseline State   |                     | - Warmup / Cooldown|             |
|         | - Cleanup Hooks    |                     +---------+----------+             |
|         +---------+----------+                               |                        |
|                   |                                          |                        |
|                   |        +---------------------------------+                        |
|                   |        |                                                          |
|         +---------v--------v----------+            +--------------------+             |
|         |    MeasurementCollector     |            |  InvariantMonitor  |             |
|         | - Nanosecond Timers         |            | (Ledger, DB, Auth, |             |
|         | - Exact Percentiles (p50-99)|            |  Secret Redaction) |             |
|         | - Resource Sampler (RAM/CPU)|            +---------+----------+             |
|         +--------------+--------------+                      |                        |
|                        |                                     |                        |
|         +--------------v-------------------------------------v----------+             |
|         |                      PerformanceReport                        |             |
|         | - Throughput & Latency Distributions (p50, p90, p95, p99, max)|             |
|         | - SLO & Error Budget Compliance Evaluations                   |             |
|         | - Baseline Comparison & Regression Delta Flagging             |             |
|         +---------------------------------------------------------------+             |
+---------------------------------------------------------------------------------------+
```

---

## 2. Core Architectural Components

### 2.1 LoadController (`LoadController.js`)
- **Pacing Engine**: Implements token-bucket rate limiting for open-model constant arrival rates (e.g. 50 RPS, 250 RPS) and closed-model concurrency-limited loops.
- **Concurrency Guard**: Limits in-flight workers via an asynchronous queue semaphore to prevent process starvation or thread exhaustion.
- **Phase Sequencer**: Manages transitions between `WARMUP` (ramp up load), `STEADY_STATE` (measured workload), and `COOLDOWN` (drain in-flight operations).

### 2.2 MeasurementCollector (`MeasurementCollector.js`)
- **Microsecond Precision**: Utilizes `process.hrtime.bigint()` to capture elapsed request and transaction latencies.
- **Percentile Calculation Engine**: Computes exact percentiles:
  $$\text{p50 (Median)}, \text{p90}, \text{p95}, \text{p99}, \text{p99.9}, \text{max}$$
- **Error & Status Accounting**: Categorizes responses by HTTP status code (2xx, 4xx, 5xx), JSON-RPC error codes, and business rejection reasons.
- **Runtime Resource Sampler**: Periodically samples Node.js memory (`heapUsed`, `heapTotal`, `rss`), active handles, and event-loop lag via `perf_hooks`.

### 2.3 WorkloadContext (`WorkloadContext.js`)
- Encapsulates execution state for a single benchmark run.
- Allocates an isolated filesystem sandbox (`tmp-perf-<runId>`).
- Initializes a deterministic Mulberry32 PRNG with configured or auto-generated seeds.
- Captures pre-test system baseline (ledger height, tip hash, database row count, baseline metric values).
- Manages guaranteed cleanup hooks executed in reverse order upon completion, timeout, or cancellation.

### 2.4 WorkloadRegistry (`WorkloadRegistry.js`)
- Central catalog defining standardized workload profiles across 6 operational domains:
  1. `API_PUBLIC_DISTRIBUTION`: Public read, beneficiary inquiry, shop stock checks.
  2. `BLOCKCHAIN_TRANSACTIONS`: Transaction submission, signature validation, Merkle proof queries.
  3. `CONSENSUS_FINALITY`: Block proposal, validator voting, quorum certificate assembly.
  4. `DATABASE_STORAGE`: High-frequency queries, atomic commits, pool saturation handling.
  5. `SYNC_NETWORKING`: Peer block synchronization, catch-up throughput.
  6. `RESOURCE_SATURATION`: Event loop stress, mempool backpressure, rate-limiting ramp.

### 2.5 PerformanceReport (`PerformanceReport.js`)
- Generates structured, tamper-evident JSON evidence reports.
- Implements regression analysis comparing current benchmark results against baseline reference runs:
  $$\Delta \text{Latency} = \frac{\text{p95}_{\text{current}} - \text{p95}_{\text{baseline}}}{\text{p95}_{\text{baseline}}} \times 100\%$$
- Flags regressions when p95 latency degrades by > 20% or throughput decreases by > 15%.

### 2.6 PerformanceRunner (`PerformanceRunner.js`)
- Orchestrates the standardized 13-step execution lifecycle.
- Maintains in-memory ring-buffer history of recent benchmark runs.

---

## 3. The 13-Step Performance Lifecycle

Every performance benchmark executes through 13 sequential phases:

```
[1. Safety Gates] ---> [2. Isolated Sandbox] ---> [3. Pre-Test Baseline]
         |
         v
[4. Seed Fixtures] ---> [5. Start Telemetry] ---> [6. Warm-Up Phase]
         |
         v
[7. Steady-State Workload] ---> [8. Injected Degradation (Opt)]
         |
         v
[9. Cool-Down & Drain] ---> [10. Verify Invariants & Cleanup]
         |
         v
[11. Calculate Statistics] ---> [12. Compare Baseline & SLOs]
         |
         v
[13. Generate Evidence Report]
```

1. **Validate Safety Gates**: Inspect `process.env.PERFORMANCE_TEST_MODE`, `process.env.NODE_ENV`, database connection strings, and network targets via `SafetyGuard`.
2. **Prepare Isolated Sandbox**: Create disposable directory `tmp-perf-<runId>` for temporary databases, journals, and socket logs.
3. **Capture Pre-Test Baseline**: Snapshot starting ledger height, block hash, mempool size, and database metrics.
4. **Seed Synthetic Fixtures**: Populate synthetic beneficiary profiles, shops, and validator keys using deterministic PRNG.
5. **Start Telemetry & Resource Sampling**: Initialize high-resolution measurement buffers and periodic resource samplers (every 500ms).
6. **Warm-Up Phase**: Ramp up load gradually (default: 10% to 100% of target rate) to prime memory caches, JIT compilation, and database pools.
7. **Execute Steady-State Workload**: Run target workload at configured rate and concurrency for the duration budget.
8. **Apply Optional Bounded Degradation**: If configured, inject reversible fault conditions (e.g. 50ms peer delay, pool saturation).
9. **Cool-Down & Drain**: Halt arrival generator, allow in-flight operations to complete, and drain worker queues.
10. **Verify Invariants & Execute Cleanup**: Assert ledger height monotonicity, immutable block hashes, and zero secret leakage via `InvariantMonitor`; execute registered cleanup hooks and purge sandbox.
11. **Calculate Performance Statistics**: Compute exact throughput (RPS), latency percentiles (p50, p90, p95, p99, max), and status distributions.
12. **Compare Against Baselines & SLOs**: Evaluate metrics against configured SLO thresholds and calculate regression deltas.
13. **Generate Evidence Report**: Output structured JSON artifact detailing all metrics, resource usage, and invariant outcomes.

---

## 4. Workload Domain Modeling

### Domain 1: Public Distribution API
- **Focus**: High-concurrency read-heavy client queries.
- **Mix**: 60% Citizen Quota Query, 25% Shop Inventory Query, 15% Beneficiary Validation.
- **Target Rate**: 500 RPS | **Concurrency**: 20 workers | **Payload**: < 1 KB.

### Domain 2: Blockchain Transactions & Mempool
- **Focus**: Transaction submission, signature validation, pre-execution EVM simulation, and mempool admission.
- **Mix**: 80% Valid Ration Distribution TXs, 10% Invalid Signatures, 10% Duplicate Nonces.
- **Target Rate**: 200 TPS | **Concurrency**: 10 workers | **Payload**: ~ 2 KB.

### Domain 3: Consensus & Finality
- **Focus**: Candidate block proposal, Ed25519 vote verification, quorum certificate creation, and state finalization.
- **Cluster**: 4 isolated validators | **Block Interval**: 2,000 ms.

### Domain 4: Database & Storage Engine
- **Focus**: High-volume SQLite operations, WAL checkpoint behavior, and atomic transaction rollbacks.
- **Mix**: 70% Indexed Read Queries, 30% Atomic Multi-statement Commits.

### Domain 5: Synchronization & Peer Networking
- **Focus**: Peer message streaming, block batch downloads, and fast-sync catch-up throughput.
- **Batch Size**: 50 blocks / batch | **Throughput Target**: 100 blocks/sec.

### Domain 6: Resource Saturation & Backpressure
- **Focus**: Mempool capacity saturation, work-shedding under 95% CPU pressure, and rate-limiting enforcement.

