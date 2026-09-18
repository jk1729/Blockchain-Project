# Phase 21: Capacity and Benchmark Runbook

**Document Reference:** `docs/phase-21/CAPACITY_AND_BENCHMARK_RUNBOOK.md`  
**Phase:** 21 — Performance and Load Testing  
**Status:** Approved & Implemented  
**Date:** September 2026  

---

## 1. Capacity Saturation Protocol

To establish maximum sustainable throughput before degradation:

1. **Step-Load Ramp**:
   - Begin benchmark with `API-001` or `TX-001` at 50 RPS.
   - Increment rate by 50 RPS every 30 seconds: 50 -> 100 -> 150 -> 200 -> 250 RPS.
2. **Saturation Point Identification**:
   - The saturation threshold is reached when either:
     - p95 latency exceeds 200 ms.
     - Error rate exceeds 1.0%.
     - Database pool waiting requests > 0 continuously.
     - Event loop lag exceeds 50 ms.
3. **Safe Operating Headroom**:
   - The maximum recommended production load is set to **70% of the measured saturation point**.

