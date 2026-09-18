# Phase 21: Performance Reporting Specification

**Document Reference:** `docs/phase-21/PERFORMANCE_REPORTING_SPECIFICATION.md`  
**Phase:** 21 — Performance and Load Testing  
**Status:** Approved & Implemented  
**Date:** September 2026  

---

## 1. Evidence Report Schema

Every performance test run executed by `PerformanceRunner` generates a standardized JSON evidence report:

```json
{
  "performanceRunId": "perf-1726645000000-a1b2c3d4",
  "workloadId": "API-001",
  "name": "Citizen Ration & Beneficiary Lookup",
  "category": "API_PUBLIC_DISTRIBUTION",
  "seed": 12345,
  "result": "PASSED",
  "status": "COMPLETED",
  "startTime": "2026-09-18T07:00:00.000Z",
  "endTime": "2026-09-18T07:00:02.000Z",
  "durationMs": 2000,
  "targetRps": 100,
  "achievedRps": 98.5,
  "concurrency": 10,
  "totalRequests": 197,
  "successfulRequests": 197,
  "failedRequests": 0,
  "errorRate": 0.0,
  "latency": {
    "min": 2.145,
    "p50": 8.321,
    "p90": 18.450,
    "p95": 24.110,
    "p99": 41.500,
    "p999": 45.200,
    "max": 48.100,
    "mean": 9.850,
    "stdDev": 4.120
  },
  "byStatusCode": { "200": 197 },
  "byErrorType": {},
  "resources": {
    "initialHeapUsedBytes": 25410240,
    "finalHeapUsedBytes": 26840320,
    "peakHeapUsedBytes": 28110000,
    "heapDeltaBytes": 1430080,
    "sampleCount": 4
  },
  "sloResults": [
    { "target": "maxP95LatencyMs", "threshold": 100, "achieved": 24.11, "passed": true },
    { "target": "maxErrorRate", "threshold": 0.01, "achieved": 0.0, "passed": true }
  ],
  "invariantResults": [
    { "name": "LEDGER_MONOTONIC_HEIGHT", "passed": true },
    { "name": "LEDGER_IMMUTABLE_BLOCK_HASH", "passed": true },
    { "name": "SECURITY_ZERO_SECRET_LEAKAGE", "passed": true }
  ],
  "baselineComparison": null,
  "cleanedUp": true
}
```

