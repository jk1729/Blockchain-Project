# Phase 21: Performance SLOs, Thresholds, and Regression Analysis

**Document Reference:** `docs/phase-21/PERFORMANCE_SLOs_AND_THRESHOLDS.md`  
**Phase:** 21 — Performance and Load Testing  
**Status:** Approved & Implemented  
**Date:** September 2026  

---

## 1. Service Level Indicators & Objective Thresholds

| Component / Path | Service Level Indicator (SLI) | Target (SLO) | Warning Threshold | Page-Worthy Breached |
| :--- | :--- | :--- | :--- | :--- |
| **API Availability** | Successful requests (2xx/3xx/4xx business) / Total | **>= 99.9%** | < 99.5% | < 99.0% |
| **API Latency (Read)** | Citizen / Shop read query duration | **p95 < 100 ms** | p95 >= 150 ms | p95 >= 300 ms |
| **API Latency (Write)** | Transaction submission & admission | **p95 < 150 ms** | p95 >= 200 ms | p95 >= 500 ms |
| **JSON-RPC Latency** | `eth_*` and `pds_*` RPC execution | **p95 < 100 ms** | p95 >= 150 ms | p95 >= 300 ms |
| **Block Finalization** | Interval between finalized blocks | **<= 3.0 seconds** | > 4.0 seconds | > 6.0 seconds |
| **Consensus Round** | Round execution duration | **p95 < 1,500 ms** | p95 >= 2,500 ms | p95 >= 4,000 ms |
| **Database Commit** | Atomic transaction commit duration | **p95 < 50 ms** | p95 >= 100 ms | p95 >= 250 ms |
| **Sync Catch-Up** | Block download & Merkle verification | **>= 50 blocks/sec** | < 30 blocks/sec | < 10 blocks/sec |
| **Event Loop Lag** | Node.js event loop latency | **p95 < 25 ms** | p95 >= 50 ms | p95 >= 100 ms |
| **Memory Growth** | Heap growth over sustained 1-hour load | **< 50 MB leak** | >= 100 MB delta | >= 250 MB delta |

---

## 2. Regression Detection Engine

During CI/CD and benchmark execution, `PerformanceReport.compare()` evaluates current benchmark runs against historical baselines:

### 2.1 Regression Trigger Formulas
1. **Latency Regression**:
   $$\Delta \text{Latency} = \frac{\text{p95}_{\text{current}} - \text{p95}_{\text{baseline}}}{\text{p95}_{\text{baseline}}} \times 100\% > 20\%$$
2. **Throughput Regression**:
   $$\Delta \text{Throughput} = \frac{\text{RPS}_{\text{baseline}} - \text{RPS}_{\text{current}}}{\text{RPS}_{\text{baseline}}} \times 100\% > 15\%$$

### 2.2 Noise Immunity & Confidence Interval
- Performance runs execute with a minimum sample size of **$N \ge 100$ requests**.
- Differences of less than **5 milliseconds** are ignored as background operating system jitter regardless of percentage change.

