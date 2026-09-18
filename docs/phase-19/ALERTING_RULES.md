# Phase 19: Alerting Rules & Escalation Policies

**Project**: PDSChain — Blockchain-Based Public Distribution System  
**Phase**: Phase 19 — Production Observability and Monitoring  
**Stage**: Stage I — Alert Rules  
**Date**: September 18, 2026  
**Status**: COMPLETE  

---

## Executive Summary

This document defines the production Prometheus alerting rules for PDSChain across six operational domains: API/RPC availability, blockchain consensus, database health, security operations, synchronization/replication, and system runtime.

Every alert includes a strict severity level, trigger expression, duration threshold, runbook link, recommended operator action, and notification routing (`page` or `ticket`).

---

## 1. Production Alert Rules Inventory

### 1. API & RPC Health
```yaml
- alert: HighHttp5xxRate
  expr: (sum(rate(pds_http_requests_total{status_code=~"5.."}[5m])) / sum(rate(pds_http_requests_total[5m]))) > 0.05
  for: 2m
  labels:
    severity: critical
    routing: page
  annotations:
    summary: Elevated HTTP 5xx Server Error Rate
    description: "HTTP 5xx error rate is currently {{ $value | humanizePercentage }}, exceeding the 5% threshold."
    runbook: docs/phase-19/INCIDENT_TRIAGE_RUNBOOK.md#high-http-5xx-rate

- alert: HighHttpLatency
  expr: histogram_quantile(0.95, sum(rate(pds_http_request_duration_seconds_bucket[5m])) by (le)) > 0.5
  for: 5m
  labels:
    severity: warning
    routing: ticket
  annotations:
    summary: High HTTP Request Latency
    description: "95th percentile HTTP latency is {{ $value }}s, exceeding 500ms target."
    runbook: docs/phase-19/INCIDENT_TRIAGE_RUNBOOK.md#elevated-api-latency

- alert: HighRpcErrorRate
  expr: sum(rate(pds_rpc_errors_total[5m])) > 10
  for: 2m
  labels:
    severity: critical
    routing: page
  annotations:
    summary: JSON-RPC Method Error Spike
    description: "JSON-RPC error rate exceeds 10 errors/sec over 5 minutes."
    runbook: docs/phase-19/INCIDENT_TRIAGE_RUNBOOK.md#rpc-error-spikes
```

### 2. Blockchain & Consensus Health
```yaml
- alert: ConsensusStalled
  expr: rate(pds_blockchain_blocks_finalized_total[5m]) == 0 and sum(pds_mempool_size) > 0
  for: 3m
  labels:
    severity: critical
    routing: page
  annotations:
    summary: Blockchain Consensus Engine Stalled
    description: "No new blocks finalized in the last 3 minutes despite pending mempool transactions."
    runbook: docs/phase-19/INCIDENT_TRIAGE_RUNBOOK.md#diagnosing-consensus-stalls

- alert: ConsensusRoundTimeoutsSpike
  expr: rate(pds_consensus_round_timeouts_total[5m]) > 2
  for: 2m
  labels:
    severity: warning
    routing: page
  annotations:
    summary: Consensus Round Timeout Storm
    description: "Consensus rounds are timing out at > 2/sec indicating peer latency or node crash."
    runbook: docs/phase-19/INCIDENT_TRIAGE_RUNBOOK.md#consensus-timeouts

- alert: QuorumThresholdFailure
  expr: rate(pds_consensus_quorum_failures_total[5m]) > 0
  for: 1m
  labels:
    severity: critical
    routing: page
  annotations:
    summary: FBA Quorum Threshold Failure
    description: "Node failed to construct a valid quorum slice for block finalization."
    runbook: docs/phase-19/INCIDENT_TRIAGE_RUNBOOK.md#quorum-failure

- alert: BlockchainForkDetected
  expr: rate(pds_blockchain_chain_forks_detected_total[1m]) > 0
  for: 0m
  labels:
    severity: critical
    routing: page
  annotations:
    summary: Conflicting Block Proposal or Fork Intercepted
    description: "Conflicting proposal detected at identical block height from adversarial or Byzantine peer."
    runbook: docs/phase-19/INCIDENT_TRIAGE_RUNBOOK.md#fork-detection
```

### 3. Database & Storage Health
```yaml
- alert: DatabasePoolExhausted
  expr: pds_database_connections_active >= pds_database_connections_max
  for: 30s
  labels:
    severity: critical
    routing: page
  annotations:
    summary: Database Connection Pool Exhausted
    description: "Active database connections have reached pool capacity ({{ $value }})."
    runbook: docs/phase-19/INCIDENT_TRIAGE_RUNBOOK.md#database-pool-exhaustion

- alert: DatabaseDeadlocksDetected
  expr: rate(pds_database_deadlocks_total[5m]) > 0
  for: 1m
  labels:
    severity: warning
    routing: ticket
  annotations:
    summary: Database Transaction Deadlocks Caught
    description: "Database deadlock detected during multi-table ledger or receipt commit."
    runbook: docs/phase-19/INCIDENT_TRIAGE_RUNBOOK.md#database-deadlocks

- alert: DatabaseIntegrityFailure
  expr: pds_database_integrity_errors_total > 0
  for: 0m
  labels:
    severity: critical
    routing: page
  annotations:
    summary: Ledger Integrity Verification Failed
    description: "Cryptographic hash discontinuity, height regression, or Merkle root tampering caught."
    runbook: docs/phase-19/INCIDENT_TRIAGE_RUNBOOK.md#ledger-integrity-failure

- alert: WriterFencingRejection
  expr: rate(pds_database_writer_fencing_rejections_total[2m]) > 0
  for: 0m
  labels:
    severity: critical
    routing: page
  annotations:
    summary: Writer Fencing Token Stale / Split-Brain Intercepted
    description: "A database write was rejected because the writer held a stale fencing token."
    runbook: docs/phase-19/INCIDENT_TRIAGE_RUNBOOK.md#writer-fencing-split-brain
```

### 4. Security & Audit Operations
```yaml
- alert: AuditLogAppendFailure
  expr: rate(pds_security_audit_failures_total[1m]) > 0
  for: 0m
  labels:
    severity: critical
    routing: page
  annotations:
    summary: Security Audit Journal Append Failure
    description: "Audit logger failed to append an entry or compute cryptographic hash-chain."
    runbook: docs/phase-19/INCIDENT_TRIAGE_RUNBOOK.md#audit-log-failure

- alert: BreakGlassEmergencyActivated
  expr: rate(pds_security_break_glass_total[1m]) > 0
  for: 0m
  labels:
    severity: critical
    routing: page
  annotations:
    summary: Break-Glass Emergency Operator Override Activated
    description: "An operator triggered emergency break-glass privileges."
    runbook: docs/phase-19/INCIDENT_TRIAGE_RUNBOOK.md#break-glass-activation

- alert: SecurityAuthFailureSpike
  expr: rate(pds_security_auth_failures_total[5m]) > 20
  for: 2m
  labels:
    severity: warning
    routing: ticket
  annotations:
    summary: Credential Stuffing / Auth Failure Spike
    description: "Authentication failures exceed 20/sec, indicating potential brute-force attack."
    runbook: docs/phase-19/INCIDENT_TRIAGE_RUNBOOK.md#auth-failure-spike
```

### 5. Runtime & Capacity
```yaml
- alert: NodeMemoryPressure
  expr: (pds_runtime_heap_used_bytes / pds_runtime_heap_total_bytes) > 0.90
  for: 3m
  labels:
    severity: warning
    routing: ticket
  annotations:
    summary: Node.js V8 Heap Memory Pressure
    description: "V8 Heap usage exceeds 90% of allocated total."
    runbook: docs/phase-19/INCIDENT_TRIAGE_RUNBOOK.md#node-memory-pressure

- alert: EventLoopLagElevated
  expr: pds_runtime_event_loop_lag_seconds > 0.1
  for: 2m
  labels:
    severity: warning
    routing: ticket
  annotations:
    summary: Elevated Node.js Event Loop Lag
    description: "Event-loop delay exceeds 100ms, indicating synchronous computation blocking."
    runbook: docs/phase-19/INCIDENT_TRIAGE_RUNBOOK.md#event-loop-lag
```

