# Phase 19: Production Dashboard Specifications

**Project**: PDSChain — Blockchain-Based Public Distribution System  
**Phase**: Phase 19 — Production Observability and Monitoring  
**Stage**: Stage J — Dashboard Specifications  
**Date**: September 18, 2026  
**Status**: COMPLETE  

---

## Executive Summary

This document specifies eight operational and executive Grafana dashboard layouts for PDSChain. Every dashboard focuses on high-signal, actionable telemetry and adheres to zero-secret visualization rules.

---

## 1. Dashboard 1: Executive System Overview
- **Purpose**: At-a-glance high-level consortium health, block production, and system reliability.
- **Audience**: Executive leadership, consortium regulators, operations leads.
- **Key Panels**:
  1. *Authoritative Block Height*: Stat panel showing `pds_blockchain_block_height` with sparkline.
  2. *Active Consortium Validators Online*: Stat panel showing connected validators vs total.
  3. *Overall API Availability (30d)*: Gauge showing current availability SLI vs 99.9% target.
  4. *Transactions Processed per Minute*: Timeseries graph of `rate(pds_transactions_executed_total[1m]) * 60`.
  5. *Consensus Health Status*: Single stat displaying `OPERATIONAL`, `DEGRADED`, or `HALTED`.
  6. *Security Incidents / Break-Glass Status*: Alert badge showing any active critical alerts.

---

## 2. Dashboard 2: API & RPC Performance
- **Purpose**: Deep performance analysis of HTTP REST routes and JSON-RPC 2.0 methods.
- **Audience**: Backend engineers, API consumers, on-call SREs.
- **Key Panels**:
  1. *Request Rate by Method & Route*: Stacked timeseries showing `rate(pds_http_requests_total[1m])` by route.
  2. *HTTP Latency Quantiles (p50, p90, p95, p99)*: Multi-quantile heatmap from `pds_http_request_duration_seconds`.
  3. *HTTP Error Breakdown (4xx vs 5xx)*: Timeseries comparing status classes.
  4. *Requests in Flight*: Real-time gauge of `pds_http_requests_in_flight`.
  5. *JSON-RPC Calls by Method*: Bar gauge of `pds_rpc_requests_total` by method.
  6. *JSON-RPC Latency by Method*: Timeseries of `pds_rpc_duration_seconds` (p95).
  7. *Rate Limit Rejections*: Timeseries of `rate(pds_rate_limit_rejections_total[1m])`.

---

## 3. Dashboard 3: Blockchain & Consensus Health
- **Purpose**: Monitoring the 12-validator Federated Byzantine Agreement (FBA) engine.
- **Audience**: Consensus engineers, validator node operators.
- **Key Panels**:
  1. *Block Finalization Interval*: Duration between finalized blocks (`pds_consensus_block_finalization_seconds`).
  2. *Consensus Round Duration*: Latency from proposal to certificate quorum.
  3. *Consensus Round Timeouts*: Step chart of `pds_consensus_round_timeouts_total`.
  4. *Vote Distribution by Result*: Stacked chart (`ACCEPT`, `REJECT`, `ABSTAIN`).
  5. *Quorum Slices Formed vs Failed*: Gauge & timeseries comparing successful quorums to failures.
  6. *Mempool Depth & Queue Age*: Line graph of `pds_mempool_size`.
  7. *Chain Continuity & Fork Detections*: Counter displaying `pds_blockchain_chain_forks_detected_total`.

---

## 4. Dashboard 4: Database & Storage Health
- **Purpose**: Monitoring SQLite WAL mode / PostgreSQL connection pool, multi-table transactions, and disk I/O.
- **Audience**: Database administrators, infrastructure engineers.
- **Key Panels**:
  1. *Connection Pool Utilization*: Active vs max connections (`pds_database_connections_active` / `pds_database_connections_max`).
  2. *Transaction Commits vs Rollbacks*: Timeseries comparison of commits and rollbacks.
  3. *Database Query Latency*: Timeseries of average and p95 query durations.
  4. *Deadlock Interceptions*: Instant counter showing `pds_database_deadlocks_total`.
  5. *Ledger Integrity Audits*: History of periodic cryptographic verification results.
  6. *WAL Journal Size & Checkpoint Frequency*: Storage growth tracking.

---

## 5. Dashboard 5: Synchronization & Peer Mesh
- **Purpose**: Tracking peer-to-peer transport, mutual TLS handshakes, and node synchronization.
- **Audience**: Network engineers, node operators.
- **Key Panels**:
  1. *Active Peer Connections*: Real-time mesh connection topology status.
  2. *Peer Latency Matrix*: Heatmap of ping/pong latency across all 12 consortium nodes.
  3. *Synchronization Throughput*: Block download rate during catch-up (`pdschain_sync_blocks_accepted_total`).
  4. *Replica Lag Histogram*: Current block lag of replica nodes behind the primary writer.
  5. *Framing & Reconnect Errors*: Timeseries tracking network anomalies.

---

## 6. Dashboard 6: Security & Authorization Activity
- **Purpose**: Audit visibility into zero-trust permissions, authentication, and key lifecycles.
- **Audience**: Security operations (SecOps), compliance auditors.
- **Key Panels**:
  1. *Authentication Failures by Reason*: Timeseries of `pds_security_auth_failures_total`.
  2. *Authorization Denials by Target Resource*: Bar chart of `pds_security_authz_denials_total`.
  3. *Privileged Admin Actions Executed*: Log table of sensitive administrative operations.
  4. *Object-Level IDOR / BOLA Attempts*: Counter displaying blocked cross-tenant attempts.
  5. *Break-Glass Activations*: Status indicator and audit trail of emergency overrides.
  6. *TLS & Consensus Key Events*: Key rotation and certificate reload tracking.

---

## 7. Dashboard 7: Node Runtime & Capacity
- **Purpose**: System resource consumption, V8 memory, garbage collection, and event loop metrics.
- **Audience**: SREs, systems engineers.
- **Key Panels**:
  1. *Process Uptime*: Gauge showing uptime in days/hours.
  2. *V8 Heap Memory (Used vs Total vs RSS)*: Stacked area chart showing memory consumption.
  3. *CPU Consumption (User vs System)*: Timeseries showing core CPU utilization.
  4. *Event-Loop Lag*: Line graph of delay in seconds (`pds_runtime_event_loop_lag_seconds`).
  5. *Active Asynchronous Handles & Requests*: Gauges showing libuv handles.

---

## 8. Dashboard 8: Backup, Migration & Disaster Recovery
- **Purpose**: Tracking database snapshots, encryption verification, and schema migration states.
- **Audience**: Platform operators, disaster recovery teams.
- **Key Panels**:
  1. *Latest Backup Status & Age*: Time since last verified AES-256-GCM snapshot.
  2. *Backup Checksum Verification*: Indicator of manifest SHA-256 integrity audits.
  3. *Schema Migration Version*: Current applied database schema version.
  4. *Disaster Recovery Staged Restore Drills*: Results and latencies of test restorations.

