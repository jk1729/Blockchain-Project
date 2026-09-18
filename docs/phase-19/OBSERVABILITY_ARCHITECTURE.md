# Phase 19: Observability Architecture & Data Flow

**Project**: PDSChain — Blockchain-Based Public Distribution System  
**Phase**: Phase 19 — Production Observability and Monitoring  
**Stage**: Stage B — Observability Architecture  
**Date**: September 18, 2026  
**Status**: COMPLETE  

---

## Executive Summary

This document establishes the production observability architecture for **PDSChain**. The architecture integrates six primary pillars:
1. **Structured Logging**: Context-aware, JSON-formatted logs with automatic secret redaction and log-injection protection.
2. **Prometheus Metrics**: Unified metric registry collecting application, consensus, database, security, and runtime telemetry.
3. **Distributed Tracing**: OpenTelemetry-compatible tracing supporting W3C Trace Context and asynchronous context propagation via `AsyncLocalStorage`.
4. **Health & Readiness Probes**: Kubernetes-standard liveness, readiness, startup, and observability health checks.
5. **SLOs & Error Budgets**: Measurable SLIs with real-time compliance evaluation and burn-rate tracking.
6. **Actionable Alerting & Dashboards**: Multi-tier alert rules with documented operator runbooks and Grafana dashboard specifications.

---

## 1. High-Level Architecture Diagram

```
+-----------------------------------------------------------------------------------------+
|                                    PDSCHAIN NODE                                         |
|                                                                                         |
|  +--------------------+   +-----------------------+   +------------------------------+  |
|  |   Incoming HTTP    |   |   JSON-RPC 2.0        |   |   Server-Sent Events (SSE)   |  |
|  |   REST Requests    |   |   Requests (/rpc)     |   |   Live Client Streams        |  |
|  +---------+----------+   +-----------+-----------+   +--------------+---------------+  |
|            |                          |                              |                  |
|            v                          v                              v                  |
|  +-----------------------------------------------------------------------------------+  |
|  |               RequestContext Middleware (AsyncLocalStorage)                       |  |
|  |  - Inbound X-Request-ID validation & generation                                   |  |
|  |  - W3C Trace Context extraction (traceparent: 00-{traceId}-{spanId}-{flags})      |  |
|  |  - Context propagation to async promises, consensus rounds, and DB transactions   |  |
|  +-----------------------------------------------------------------------------------+  |
|            |                          |                              |                  |
|            v                          v                              v                  |
|  +--------------------+   +-----------------------+   +------------------------------+  |
|  |  StructuredLogger  |   |    Tracer & Spans     |   |       MetricsRegistry        |  |
|  |  - JSON in prod    |   |  - Root & child spans |   |  - Counters, Gauges, Histo   |  |
|  |  - Auto-enrichment |   |  - Bounded attributes |   |  - Cardinality protection    |  |
|  |  - Secret redact   |   |  - Error recording    |   |  - Thread-safe updates       |  |
|  +---------+----------+   +-----------+-----------+   +--------------+---------------+  |
|            |                          |                              |                  |
|            v                          v                              v                  |
|     [stdout / jsonl]         [OTLP / Console / Noop]         [Prometheus Scrape]        |
|                                                              /metrics, /health          |
+-----------------------------------------------------------------------------------------+
```

---

## 2. Core Architectural Principles

### 1. Non-Blocking Telemetry Principle
Telemetry collection, formatting, and export must **never block or delay**:
- Federated Byzantine Agreement (FBA) consensus rounds or vote broadcasting.
- Cryptographic block validation or Merkle proof verification.
- Authoritative database transaction commits.
- Client API responses or WebSocket/SSE streams.

If a telemetry buffer overflows or an external exporter fails, telemetry data is safely dropped with a counter increment (`pds_observability_dropped_spans_total`) rather than applying backpressure to the blockchain core.

### 2. Zero-Leakage Privacy & Security Boundary
- All loggers, metrics collectors, and trace spans route through centralized sanitization logic (`sanitizeSecrets`).
- Sensitive patterns (private keys, mnemonics, seed phrases, passwords, authorization tokens, database connection strings, PII) are strictly replaced with `[REDACTED]`.
- Diagnostic endpoints enforce Phase 17 granular permissions (`operator:read:metrics`).

### 3. Metric Cardinality Bounding
- Metric labels are strictly bounded to finite enumerations:
  - `method`: `GET`, `POST`, `PUT`, `DELETE`, `OPTIONS`.
  - `route`: Normalized path templates (e.g. `/api/v1/blocks/:height` instead of `/api/v1/blocks/1054`).
  - `status_code`: Normalized HTTP status codes or status classes (`2xx`, `4xx`, `5xx`).
  - `error_code`: Known application error codes (e.g. `INVALID_SIGNATURE`, `POOL_EXHAUSTED`).
- User identifiers, raw hashes, transaction payloads, and arbitrary query parameters are **strictly prohibited** from metric labels.

---

## 3. Data Flow & Component Interactions

### 1. Inbound Request Life Cycle
1. **Extraction**: `RequestContext` middleware receives HTTP/RPC request, inspects `X-Request-ID` and `traceparent` headers.
2. **Context Creation**: If headers exist and pass validation, they are adopted; otherwise, fresh UUIDv4/hex identifiers are generated.
3. **Async Storage Entry**: `RequestContext.run()` binds the context to the current asynchronous execution tree.
4. **Root Span Start**: `Tracer` creates an active root HTTP span (`HTTP {method} {route}`) recording start time.
5. **In-Flight Metrics**: `ApplicationMetrics.requestsInFlight` is incremented.
6. **Execution**: Handler executes (invoking database managers, blockchain services, consensus engines). Child spans and log calls automatically inherit the active `requestId` and `traceId`.
7. **Completion**: Response headers (`X-Request-ID`, `X-Correlation-ID`) are set. Duration histogram and status code counters are recorded. The root span is ended. `requestsInFlight` is decremented.

### 2. Database Operation Tracing & Metrics
1. `DatabaseManager` and `DatabaseTransactionManager` open child spans (`DB {operation}`).
2. Query duration is recorded in `pds_database_query_duration_seconds`.
3. Commits and rollbacks increment `pds_database_commits_total` or `pds_database_rollbacks_total`.

### 3. Consensus Round Tracing & Metrics
1. `ConsensusRound` initializes with a child trace linked to the proposed block hash.
2. Voting events record duration in `pds_consensus_round_duration_seconds`.
3. Block finalization records duration in `pds_consensus_block_finalization_seconds`.

---

## 4. Health Probe Hierarchy

The health monitoring architecture distinguishes four distinct states:
1. **Liveness (`GET /health/live`)**: Answers "Is the Node.js process alive and responding?" Used by container orchestrators to trigger process restart on deadlocks.
2. **Readiness (`GET /health/ready`)**: Answers "Is the node capable of serving client and network traffic?" Verifies database connectivity, memory thresholds, and validator readiness.
3. **Startup (`GET /health/startup`)**: Answers "Has initial bootstrapping completed?" Verifies database migrations and genesis/ledger initialization before readiness checks begin.
4. **Observability (`GET /health/observability`)**: Answers "Are the logging, metrics, and tracing pipelines healthy?" Checks metric registry integrity and exporter status.
5. **Aggregate (`GET /health`)**: Unified health payload with comprehensive status classification: `HEALTHY`, `DEGRADED`, or `UNHEALTHY`.

---

## 5. Retention, Sampling & Failure Policies

| Pillar | Default Storage Target | Production Retention | Sampling Policy | Failure Fallback |
| :--- | :--- | :--- | :--- | :--- |
| **Logs** | `stdout` / JSONL file | 30 days (via logrotate) | 100% of `INFO`, `WARN`, `ERROR` | Write to `stderr` |
| **Metrics** | In-Memory Registry | 15s scrape interval | 100% aggregation | In-memory counter preservation |
| **Traces** | OTLP / Console / None | 7 days (in trace store) | 10% head sampling (100% errors) | Drop span silently |
| **Health** | Live memory probe | Ephemeral | On-demand polling | Return 503 with error |
| **Audits** | `database/security_audit.jsonl` | 365 days (immutable) | 100% tamper-evident chained | Fail transaction |

