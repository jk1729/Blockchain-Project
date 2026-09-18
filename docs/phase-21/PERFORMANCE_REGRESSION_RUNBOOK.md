# Phase 21: Performance Regression Analysis Runbook

**Document Reference:** `docs/phase-21/PERFORMANCE_REGRESSION_RUNBOOK.md`  
**Phase:** 21 — Performance and Load Testing  
**Status:** Approved & Implemented  
**Date:** September 2026  

---

## 1. Automated Regression Triage

When `PerformanceReport.compare()` flags a regression (`hasRegression: true`):

1. **Verify Baseline Identity**: Ensure the reference baseline was executed on comparable hardware and environment configuration.
2. **Classify Regression Type**:
   - **Latency Regression (`latencyDeltaPct > 20%`)**: Inspect database queries, unindexed joins, cryptographic hashing, or lock wait times.
   - **Throughput Regression (`throughputDeltaPct > 15%`)**: Inspect concurrency bottlenecks, worker thread starvation, or event loop blocking.
3. **Remediation Steps**:
   - Profile Node.js CPU with `--cpu-prof` during reproduction.
   - Inspect SQLite `EXPLAIN QUERY PLAN` for any modified database schemas.
   - Re-run benchmark to rule out temporary background OS CPU spikes.

