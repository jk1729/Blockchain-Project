# Phase 20: Attack and Failure Simulation — Baseline Audit

**Document Reference:** `docs/phase-20/ATTACK_FAILURE_BASELINE_AUDIT.md`  
**Phase:** 20 — Attack and Failure Simulation  
**Status:** Approved & Implemented  
**Date:** September 2026  

---

## 1. Executive Summary

This document establishes the comprehensive baseline audit for **Phase 20: Attack and Failure Simulation** of the PDSChain blockchain platform. PDSChain is an institutional-grade, Byzantine-fault-tolerant, EVM-compatible consortium blockchain orchestrating India's Public Distribution System.

Before introducing simulation capabilities, an exhaustive audit was conducted across all architectural layers established in prior phases—specifically **Phase 17 (Security Hardening, Permissions, Authorization)**, **Phase 18 (Production Database Architecture)**, and **Phase 19 (Production Observability and Monitoring)**. This audit maps existing defense-in-depth mechanisms, failure recovery hooks, invariant validation routines, observability telemetry, and safety constraints to define a safe, deterministic, and non-destructive simulation framework.

---

## 2. Audit of Existing Defense and Recovery Subsystems

### 2.1 Security Controls (Phase 17)
- **Default-Deny Authorization Engine**: Enforced by `AuthorizationService.js` and `permissionMiddleware.js`. Any request lacking explicit role permission mapping evaluates to denial (`HTTP 403 Forbidden` / `E_FORBIDDEN`).
- **Canonical Permission & Role Registry**:
  - Over 40 discrete permissions formalized in `PermissionRegistry.js` following `resource:action:scope`.
  - 16 least-privilege roles defined in `RoleMatrix.js` (e.g., `CITIZEN`, `SHOP_OFFICER`, `WAREHOUSE_MANAGER`, `AUDITOR`, `VALIDATOR`, `OPERATOR`, `SECURITY_ADMIN`, `SYSTEM_ADMIN`).
  - No wildcard permissions or super-admin shortcuts. Private key export is strictly forbidden for all roles.
- **Object-Level IDOR / BOLA Protections**: Enforced by `ScopeType.ENTITY` and `ScopeType.USER` validations verifying tenancy and entity ownership before granting resource access.
- **Tamper-Evident Security Audit Logger**: Structured audit events (`SecurityAuditLogger.js`) capture actor, IP, timestamp, action, outcome, and resource identifier.
- **Secret Redaction**: Embedded redaction rules strip private keys, mnemonics, passwords, JWTs, and API keys before persistence or logging.

### 2.2 Production Database Architecture (Phase 18)
- **Database Integrity Enforcement**: Handled by `DatabaseIntegrityManager.js`. Verifies monotonic block height increases, cryptographic parent-hash chaining (`previousHash`), and Merkle root correctness.
- **Journal Storage & Quarantine**: `JournalStorageManager.js` logs consensus and execution entries. Corrupt journal lines are automatically isolated into `.corrupt` sidecar files without halting validator operations.
- **HA Writer Fencing**: `DatabaseHAManager.js` assigns strictly increasing fencing tokens to active writers. Any write attempt using a stale or unpromoted fencing token is rejected (`E_WRITER_FENCING_REJECTED`).
- **Encrypted Backup & Staging Restore**: `DatabaseBackupManager.js` produces AES-256-GCM encrypted backup bundles with signed cryptographic manifests. Restores are staged in temporary sandboxes and verified before hot promotion.
- **Migration Versioning**: Migration engine enforces sequential migration execution and SHA-256 checksum verification. Mismatches abort startup.

### 2.3 Production Observability & Telemetry (Phase 19)
- **Structured JSON Logging**: `StructuredLogger.js` provides centralized JSON formatting, multi-layer recursive secret redaction, and log-injection defenses.
- **Request & Trace Correlation**: `RequestContext.js` leverages Node.js `AsyncLocalStorage` to propagate `requestId`, `traceId`, `spanId`, and execution contexts across HTTP, RPC, SSE, and consensus threads.
- **Prometheus Metrics Engine**: Central `MetricsRegistry.js` enforces bounded label dimensions across `ApplicationMetrics.js`, `ConsensusMetrics.js`, and `RuntimeMetrics.js`.
- **OpenTelemetry-Compatible Tracing**: `Tracer.js` and `Span.js` parse and propagate W3C `traceparent` headers without external dependencies.
- **Kubernetes Health Probes**: `/health/live`, `/health/ready`, `/health/startup`, `/health/observability`, and `/health/database` distinguish liveness, traffic readiness, and subsystem degradation.
- **SLO Engine & Alert Evaluator**: `SloEngine.js` calculates error budgets across 11 SLIs; `AlertManager.js` evaluates 20+ alert conditions (e.g., consensus stalls, DB connection pool exhaustion, elevated HTTP 5xx errors).

---

## 3. Inventory of Existing Failure-Injection & Adversarial Tests

Prior to Phase 20, several isolated adversarial test suites were implemented:
1. `backend/tests/security-adversarial-invariants.test.js`: Validates tamper resistance of audit logs, authorization bypass attempts, and role boundary violations.
2. `backend/tests/consensus-adversarial.test.js`: Validates double-voting rejection (`ConflictDetector.js`), stale round rejection, and invalid block proposal discarding.
3. `backend/tests/sync-adversarial.test.js`: Tests ledger synchronization resilience against malicious peers feeding invalid forks.
4. `backend/tests/network-adversarial.test.js`: Tests message flooding, oversized payload drops, and malformed peer messages.
5. `backend/tests/database-integrity.test.js`: Validates atomic rollbacks, gap detection, and journal quarantine.

### Gaps Identified in Existing Adversarial Testing:
- **Absence of Unified Control Plane**: Existing tests run bespoke ad-hoc mocks without standardized scenario lifecycle hooks, baseline snapshots, or repeatable random seeds.
- **Lack of Correlation with Observability**: Previous tests verified that code threw errors, but did not systematically assert that Phase 19 metrics incremented, structured logs recorded incident IDs, alerts fired, or health probes transitioned from healthy to degraded.
- **No Production Safety Gate**: Tests relied solely on Jest harness isolation without runtime environment safety guards (`SIMULATION_MODE=true`, anti-production URL validation, emergency stop).
- **No Standardized Evidence Reports**: Previous runs did not generate auditable post-simulation evidence artifacts detailing RPO, RTO, detection latency, or invariant assertions.

---

## 4. Testable Attack & Failure Surfaces

The baseline audit categorizes testable surfaces into eight operational domains:

| Domain | Testable Failure / Attack Surfaces | Existing Defense Mechanism | Instrumentation Point |
| :--- | :--- | :--- | :--- |
| **AUTH** | Expired tokens, brute-force attempts, IDOR/BOLA cross-tenant access, privilege escalation, malformed headers | `AuthorizationService`, `RoleMatrix`, `rateLimiter` | `pds_security_auth_failures_total`, audit logs |
| **INPUT** | Deeply nested JSON, prototype pollution keys, path traversal, ReDoS, malformed JSON-RPC batches | Express parsers, input validators, JSON-RPC schema guards | `pds_http_errors_total`, `pds_rpc_errors_total` |
| **CONSENSUS** | Double voting, stale rounds, validator crashes, quorum loss, split-brain writer attempts | `ConflictDetector`, `BFTConsensusEngine`, `DatabaseHAManager` | `pds_consensus_round_timeouts_total`, `pds_consensus_quorum_failures_total` |
| **NETWORK** | Peer disconnects, packet drops, high latency/jitter, connection refusal, peer floods | `PeerConnectionManager`, message size limits, rate limits | `pds_peer_disconnects_total`, network metrics |
| **DATABASE** | Pool exhaustion, atomic rollback, journal corruption, migration checksum mismatch, stale fencing | `DatabaseTransactionManager`, `JournalStorageManager`, `DatabaseIntegrityManager` | `pds_db_pool_waiting_requests`, `/health/ready` |
| **RESOURCE** | Mempool saturation, burst transaction submission, worker queue lag, event loop delays | Mempool bounded capacity, priority shedding | `pds_mempool_size`, `pds_runtime_event_loop_lag_seconds` |
| **OBSERVABILITY** | Logger transport failure, metric registry collision, corrupted trace context, scrape timeout | Error isolation, fallback console logging, non-blocking telemetry | Fallback diagnostics, `/health/observability` |
| **RECOVERY** | Corrupted encrypted backup, checksum mismatch, restore to wrong chain ID, node crash recovery | `DatabaseBackupManager`, staging verification, manifest signatures | RPO/RTO metrics, recovery event logs |

---

## 5. Unacceptable Destructive Behaviors (Safety Boundaries)

To protect the development, staging, and production environments, the simulation platform strictly forbids:
1. **Targeting Production Hosts**: Execution against any non-loopback or unallowlisted domain is unconditionally aborted.
2. **Authoritative Ledger Destruction**: Finalized blocks and production database files (`pdschain.db`) must never be modified or deleted. All mutating simulations must execute within isolated sandbox directories (`tmp-sim-*`).
3. **Arbitrary Code or Command Execution**: Scenarios must use hardcoded, vetted scenario definitions. No dynamic execution (`eval`, `child_process.exec` with arbitrary strings) is permitted.
4. **Secret Generation or Leakage**: Private keys, seed phrases, passwords, and tokens must never appear in simulation parameters, evidence files, or telemetry output.
5. **Permanent System State Changes**: Every scenario must have a guaranteed cleanup hook registered with `SimulationContext` that resets mocked state, closes open socket handles, and removes sandbox directories.

---

## 6. Conclusion & Readiness

The PDSChain codebase possesses mature security, database, consensus, and observability foundations. The implementation of Phase 20 will introduce a formalized control plane (`backend/src/simulation/`) that orchestrates deterministic scenarios across these subsystems, measuring detection latencies and validating recovery procedures while enforcing strict anti-production safety guards.

