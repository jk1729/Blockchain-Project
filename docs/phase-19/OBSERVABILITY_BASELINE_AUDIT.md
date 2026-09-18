# Phase 19: Observability Baseline Audit

**Project**: PDSChain — Blockchain-Based Public Distribution System  
**Phase**: Phase 19 — Production Observability and Monitoring  
**Stage**: Stage A — Observability Baseline Audit  
**Date**: September 18, 2026  
**Status**: COMPLETE  

---

## Executive Summary

This document performs an exhaustive audit of the telemetry, logging, metrics, tracing, health probe, and diagnostic infrastructure across the PDSChain repository prior to Phase 19 implementation.

While earlier phases implemented specialized telemetry components—including Phase 13's event metrics, Phase 14's request correlation headers, Phase 16's Merkle proof metrics, Phase 17's security metrics, and Phase 18's database metrics—these systems are fragmented across disparate modules without a unified metrics registry, central structured logger, distributed tracing engine, or standardized Kubernetes-grade health probes.

---

## 1. Existing Logging System

### Current Implementation (`backend/src/utils/logger.js`)
- **Format**: Text-based strings with timestamp prefix: `[LEVEL] [2026-09-18T...] message meta`.
- **JSON Support**: Partially supported via environment check (`process.env.LOG_FORMAT === 'json'`). When active, emits `{ timestamp, level, message, meta }`.
- **Severity Levels**: `INFO`, `WARN`, `ERROR`, `FBA-CONSENSUS`, `EXECUTION-ENGINE`, `DEBUG`.
- **Secret Redaction**: Regex-based redaction targeting RSA private keys, `"privateKey"`, `"secret"`, `"password"`, `"seed"`, and dev keys.

### Identified Gaps & Vulnerabilities
1. **Missing Correlation Context**: Log entries do not automatically capture `requestId`, `traceId`, `spanId`, `nodeId`, `validatorId`, `blockHeight`, or `txHash` from active execution contexts.
2. **Lack of Async Context Propagation**: Because Node.js asynchronous callbacks and promises do not inherit execution state without `AsyncLocalStorage`, logs emitted inside database hooks, consensus callbacks, or event listeners lose the request ID of the triggering call.
3. **Log Injection Risk**: In text mode, unsanitized user inputs containing newline characters (`\n`, `\r`) can forge fake log lines.
4. **Coarse Error Serialization**: Errors passed to `logger.error` are logged using default string conversion or omitted stack traces, preventing rapid incident triage.
5. **No Structured Event Classification**: Logs lack standardized `component`, `event`, and `errorCode` attributes.

---

## 2. Existing Metrics & Registries

### Fragmented Metrics Inventory
| Module | File Location | Metric Format | Export Endpoint |
| :--- | :--- | :--- | :--- |
| **Database Metrics** | `backend/src/database/DatabaseMetrics.js` | Prometheus 0.0.4 text | `GET /api/v1/database/metrics` |
| **Security Metrics** | `backend/src/security/permissions/SecurityMetrics.js` | Prometheus 0.0.4 text | `GET /api/v1/security/metrics` |
| **Event Metrics** | `backend/src/events/EventMetrics.js` | Prometheus 0.0.4 text | Internal snapshot / stream |
| **Network Metrics** | `backend/src/network/NetworkMetrics.js` | Prometheus 0.0.4 text | Internal snapshot / daemon |
| **Proof Metrics** | `backend/src/blockchain/merkle/ProofMetrics.js` | Prometheus 0.0.4 text | Internal snapshot |

### Identified Gaps
1. **No Unified `/metrics` Endpoint**: Prometheus scrapers must query multiple individual endpoints rather than a single unified root `/metrics` or `/api/v1/observability/metrics`.
2. **Missing HTTP Application Metrics**: No histograms for HTTP request latency (`pds_http_request_duration_seconds`), in-flight request gauges, or response size tracking across REST routes.
3. **Missing JSON-RPC Telemetry**: JSON-RPC 2.0 requests at `/rpc` lack method-level duration histograms and error code counters.
4. **Missing Node.js Runtime Telemetry**: No tracking of event-loop lag, active asynchronous handles, heap usage, garbage collection pauses, or process CPU consumption.
5. **Cardinality Management**: Custom maps used in `EventMetrics` and `NetworkMetrics` do not enforce strict label cardinality bounds.

---

## 3. Existing Health & Readiness Probes

### Current Probes Inventory
| Endpoint | Scope / Location | Behavior |
| :--- | :--- | :--- |
| `GET /health/database` | Root web server (`app.js`) | Checks `defaultDatabaseManager.testConnection()`; returns 200 `UP` or 503 `DOWN`. |
| `GET /api/health` | Legacy router (`routes/index.js`) | Returns 200 with blockchain validation & validator counts. |
| `GET /api/v1/health` | v1 router (`routes/v1/healthRoutes.js`) | Returns 200 with FBA consensus status & chain validation. |
| `GET /health/live` | Validator daemon (`validatorProcess.js:583`) | Liveness probe for individual validator child process. |
| `GET /health/ready` | Validator daemon (`validatorProcess.js:596`) | Readiness probe checking daemon storage, chain, and p2p. |
| `GET /health/consensus`| Validator daemon (`validatorProcess.js:622`) | Checks whether validator daemon is consensus-ready. |

### Identified Gaps
1. **Lack of Standard Root Kubernetes Probes**: The main web application lacks standard `GET /health/live`, `GET /health/ready`, and `GET /health/startup` probes.
2. **Expensive Health Logic**: Legacy `/api/health` runs `blockchainService.validateChain()`, iterating over historical blocks on every probe request, creating CPU spikes under frequent polling.
3. **No Observability Pipeline Health**: No endpoint exists to verify that the logging, metrics, and tracing pipelines are functioning properly without silent dropouts.

---

## 4. Request Correlation & Distributed Tracing

### Current Implementation (`backend/src/api/RequestTracing.js`)
- Express middleware extracts `X-Request-ID` or `X-Correlation-ID` header or generates a pseudo-random hex string.
- Attaches `req.requestId` and mirrors to response headers.
- Built-in `ResponseEnvelope.js` adds `meta.requestId` to API responses.

### Identified Gaps
1. **No W3C Trace Context**: Does not parse or emit W3C standard `traceparent` (`00-{traceId}-{spanId}-{flags}`) or `tracestate` headers.
2. **No Distributed Tracing Abstraction**: No OpenTelemetry-compatible `Tracer`, `Span`, or exporter abstraction exists.
3. **No Span Propagation Across Boundaries**: Database transactions, consensus rounds, background sync batches, and SSE streams do not generate or propagate child spans.
4. **No Trace-to-Log Correlation**: Log entries cannot correlate directly to trace identifiers.

---

## 5. Security, Secrets & Privacy Audit

### Findings
1. **Header Sanitization**: `ResponseEnvelope.sanitizeSecrets` strips sensitive keys (`privatekey`, `seed`, `password`, `secret`, `passphrase`, `authorization`), but does not cover nested error objects or raw database query strings.
2. **Metrics Labels**: `SecurityMetrics` bounds labels safely, but other telemetry classes lack parameter whitelisting.
3. **Access Controls**: `/health/database` and `/api/v1/database/metrics` are public. Detailed administrative diagnostics in Phase 18 enforce `authMiddleware` and `requirePermission('operator:read:node-status')`. Phase 19 observability diagnostics must enforce matching permissions.

---

## 6. Baseline Compatibility Requirements for Phase 19

1. **Preserve All Existing Metrics**:
   - `pds_database_*` (Phase 18)
   - `pds_security_*` (Phase 17)
   - `pdschain_events_*` (Phase 13)
   - `pdschain_network_*` (Phase 9–12)
   - `pds_proof_*` (Phase 16)
2. **Preserve All Existing Endpoints**:
   - `/health/database` must remain functional and return `{ status, dialect, storageTarget, timestamp }`.
   - `/api/health` and `/api/v1/health` must remain functional.
   - `/api/v1/database/metrics` and `/api/v1/security/metrics` must remain functional.
3. **Non-Blocking Telemetry**:
   - Failure of telemetry collectors, log formatters, or trace exporters must never interrupt consensus rounds, transaction validation, or database commits.

