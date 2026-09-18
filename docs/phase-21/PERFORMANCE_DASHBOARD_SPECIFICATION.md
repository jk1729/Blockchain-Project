# Phase 21: Performance Dashboard Specification

**Document Reference:** `docs/phase-21/PERFORMANCE_DASHBOARD_SPECIFICATION.md`  
**Phase:** 21 — Performance and Load Testing  
**Status:** Approved & Implemented  
**Date:** September 2026  

---

## 1. Executive Performance Dashboards

The load testing platform integrates with Grafana through 8 dedicated performance dashboards:

1. **Dashboard 1: API & JSON-RPC Load Overview**
   - Panels: Throughput (RPS) by route, Latency heatmap, p50/p90/p95/p99 trends, Error rate (4xx/5xx).
2. **Dashboard 2: Transaction & Mempool Dynamics**
   - Panels: Transaction admission rate (TPS), Mempool queue size, Signature verification latency, Eviction count.
3. **Dashboard 3: Consensus & Finality Throughput**
   - Panels: Blocks finalized per minute, Round duration distribution, Vote count per round, Quorum assembly latency.
4. **Dashboard 4: Database & Storage Engine**
   - Panels: Commit latency histogram, Active SQLite connections, Pool wait duration, WAL checkpoint frequency.
5. **Dashboard 5: Synchronization & Peer Mesh**
   - Panels: Catch-up block download rate, Peer message bandwidth, Reconnection duration.
6. **Dashboard 6: Runtime Resource Saturation**
   - Panels: Heap memory used vs total, RSS curve, Event-loop lag histogram, CPU core utilization.
7. **Dashboard 7: SLO Compliance & Error Budget Burn**
   - Panels: p95 latency vs SLO target line, Error budget consumption rate, Breached target alerts.
8. **Dashboard 8: Benchmark Regression Comparison**
   - Panels: Current run vs Reference baseline overlay, Latency delta percentage, Throughput delta percentage.

