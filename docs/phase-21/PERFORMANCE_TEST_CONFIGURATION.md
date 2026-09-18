# Phase 21: Performance Test Configuration Reference

**Document Reference:** `docs/phase-21/PERFORMANCE_TEST_CONFIGURATION.md`  
**Phase:** 21 — Performance and Load Testing  
**Status:** Approved & Implemented  
**Date:** September 2026  

---

## 1. Environment Variable Reference

| Variable | Type | Default | Required | Description |
| :--- | :--- | :--- | :--- | :--- |
| `PERFORMANCE_TEST_MODE` | Boolean | `false` | **Yes** | Master toggle enabling performance testing and `/api/v1/performance/*` endpoints. (Also enabled if `SIMULATION_MODE=true`). |
| `NODE_ENV` | String | `development`| No | If set to `production` or `prod`, performance execution is unconditionally aborted by `SafetyGuard`. |
| `PERFORMANCE_MAX_DURATION_MS` | Integer | `60000` (60s) | No | Maximum duration allowed for any single benchmark run. |
| `PERFORMANCE_MAX_RPS` | Integer | `1000` | No | Maximum permitted arrival rate cap to prevent local process starvation. |
| `PERFORMANCE_MAX_CONCURRENCY` | Integer | `50` | No | Maximum parallel workers allowed in `LoadController`. |
| `PERFORMANCE_ALLOWED_HOSTS` | String | Loopback only | No | Comma-separated allowlist of non-loopback staging hosts. Production hosts are rejected regardless. |

---

## 2. Hard Safety Limits & Bounded Budgets

```javascript
const PerformanceSafetyBounds = Object.freeze({
  MAX_DURATION_MS: 60000,          // 60 seconds
  MAX_RPS: 1000,                   // 1,000 req/sec
  MAX_CONCURRENCY: 50,             // 50 concurrent worker fibers
  MAX_PAYLOAD_BYTES: 5 * 1024 * 1024, // 5 MB payload limit
  MAX_RECORDS: 100000              // 100,000 observations per run
});
```
Attempts to launch benchmarks exceeding these limits are immediately rejected with `E_PERFORMANCE_LIMIT_EXCEEDED`.

