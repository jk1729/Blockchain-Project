# Phase 21: Performance Operations Runbook

**Document Reference:** `docs/phase-21/PERFORMANCE_OPERATIONS_RUNBOOK.md`  
**Phase:** 21 — Performance and Load Testing  
**Status:** Approved & Implemented  
**Date:** September 2026  

---

## 1. Prerequisites for Running Benchmarks

1. **Environment Gate**: Verify that `PERFORMANCE_TEST_MODE=true` is set.
2. **Safety Confirmation**: Ensure the target environment is a disposable development or staging cluster. Execution against production is programmatically blocked.
3. **Operator Authentication**: Obtain an authorized operator JWT token possessing `performance:run:workload`.

---

## 2. Executing Load Tests via REST API

### 2.1 List Available Workloads
```bash
curl -s -H "Authorization: Bearer $OPERATOR_TOKEN" \
  http://localhost:5000/api/v1/performance/workloads | jq .
```

### 2.2 Launch a Benchmark Run
```bash
curl -X POST \
  -H "Authorization: Bearer $OPERATOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "workloadId": "API-001",
    "seed": 42,
    "targetRps": 100,
    "concurrency": 10,
    "durationMs": 5000
  }' \
  http://localhost:5000/api/v1/performance/runs | jq .
```

### 2.3 Monitor and Retrieve Evidence
```bash
# Retrieve status and metrics
curl -s -H "Authorization: Bearer $OPERATOR_TOKEN" \
  http://localhost:5000/api/v1/performance/runs/perf-1726645000000-a1b2c3d4 | jq .

# Retrieve full evidence report
curl -s -H "Authorization: Bearer $OPERATOR_TOKEN" \
  http://localhost:5000/api/v1/performance/runs/perf-1726645000000-a1b2c3d4/evidence | jq .
```

### 2.4 Emergency Stop Active Load Run
```bash
curl -X POST \
  -H "Authorization: Bearer $OPERATOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"reason": "Manual operator abort"}' \
  http://localhost:5000/api/v1/performance/runs/perf-1726645000000-a1b2c3d4/stop
```

