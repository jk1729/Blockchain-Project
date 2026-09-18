# Phase 19: Incident Triage & Response Runbook

**Project**: PDSChain — Blockchain-Based Public Distribution System  
**Phase**: Phase 19 — Production Observability and Monitoring  
**Stage**: Stage N — Operational Runbooks  
**Date**: September 18, 2026  
**Status**: COMPLETE  

---

## Executive Summary

This runbook guides on-call engineers, security responders, and cluster operators during live production alerts. Each section maps directly to Prometheus alert rules defined in `docs/phase-19/ALERTING_RULES.md`.

---

## 1. Elevated API Latency or HTTP 5xx Errors (`HighHttp5xxRate`, `HighHttpLatency`)

### Symptoms
- PagerDuty alert `HighHttp5xxRate` or `HighHttpLatency`.
- Elevated values on `pds_http_requests_total{status_code=~"5.."}`.

### Triage Steps
1. **Identify Failing Routes & Error Codes**:
   ```bash
   curl -s http://localhost:3000/api/v1/observability/metrics | grep "pds_http_errors_total"
   ```
2. **Correlate with Recent Logs using Request & Trace IDs**:
   Extract recent error logs matching the failing route:
   ```bash
   tail -n 500 /var/log/pdschain/backend.log | grep '"level":"ERROR"' | jq '{requestId, traceId, message, errorCode, error}'
   ```
3. **Inspect Active Connection Pool**:
   Check if database exhaustion is causing request queuing:
   ```bash
   curl -s http://localhost:3000/api/v1/database/status -H "Authorization: Bearer <OPERATOR_TOKEN>"
   ```
4. **Remediation**:
   - If database pool is saturated: see Section 4 (Database Pool Exhaustion).
   - If application is experiencing memory pressure or event-loop lag: initiate graceful rolling restart.

---

## 2. Diagnosing Consensus Stalls (`ConsensusStalled`, `ConsensusRoundTimeoutsSpike`)

### Symptoms
- Block height `pds_blockchain_block_height` not advancing.
- Mempool transactions accumulating without block proposal.
- Alert `ConsensusStalled` firing.

### Triage Steps
1. **Check Consensus Round State**:
   ```bash
   curl -s http://localhost:3000/api/v1/consensus/status
   ```
2. **Verify Connected Peer Mesh**:
   Verify how many validators are online in the FBA cluster:
   ```bash
   curl -s http://localhost:3000/api/v1/network/peers
   ```
   *Quorum Threshold*: At least 9 of 12 consortium validators must be reachable and voting.
3. **Inspect Consensus Timeouts & Rejections**:
   ```bash
   curl -s http://localhost:3000/api/v1/observability/metrics | grep "pds_consensus_round_timeouts"
   ```
4. **Remediation**:
   - If fewer than 9 validators online: contact offline validator institutions; verify network firewalls and TLS certificate validity.
   - If node is split from network: verify local network gateway and restart validator process.

---

## 3. Investigating Synchronization & Replica Lag (`ReplicaLagExceeded`)

### Symptoms
- Replica validator lag exceeds 5 blocks behind primary writer.
- Alert `ReplicaLagExceeded` firing.

### Triage Steps
1. **Check Sync Pipeline Status**:
   ```bash
   curl -s http://localhost:3000/api/v1/ledger/sync-status -H "Authorization: Bearer <OPERATOR_TOKEN>"
   ```
2. **Trigger Catch-Up Sync**:
   ```bash
   curl -s -X POST http://localhost:3000/api/v1/ledger/sync -H "Authorization: Bearer <OPERATOR_TOKEN>"
   ```

---

## 4. Handling Database Pool Exhaustion (`DatabasePoolExhausted`, `DatabaseDeadlocksDetected`)

### Symptoms
- `pds_database_connections_active` equals `pds_database_connections_max`.
- Queries returning `POOL_EXHAUSTED` or database deadlocks detected.

### Triage Steps
1. **Inspect Pool Metrics**:
   ```bash
   curl -s http://localhost:3000/api/v1/database/metrics | grep "pds_database_connections"
   ```
2. **Verify WAL Mode & Storage Target**:
   ```bash
   curl -s http://localhost:3000/health/database
   ```
3. **Remediation**:
   - Verify that all database transactions close cleanly with explicit `commit()` or `rollback()`.
   - If running SQLite, ensure `PRAGMA busy_timeout=5000` is active and no external process holds an exclusive lock on `pdschain.sqlite`.

---

## 5. Investigating Security & Audit Event Spikes (`SecurityAuthFailureSpike`, `AuditLogAppendFailure`)

### Symptoms
- `pds_security_auth_failures_total` spiking rapidly.
- Alert `AuditLogAppendFailure` firing (P0 Emergency).

### Triage Steps
1. **Inspect Failed Auth Reasons**:
   ```bash
   curl -s http://localhost:3000/api/v1/security/metrics | grep "pds_security_auth_failures_total"
   ```
2. **Audit Append Failure Response**:
   - If `AuditLogAppendFailure` is firing, inspect disk permissions and filesystem space for `database/security_audit.jsonl`.
   - Under PDSChain security invariants, if the audit journal cannot be written, mutative security actions fail closed. Restore disk space or fix permissions immediately.

