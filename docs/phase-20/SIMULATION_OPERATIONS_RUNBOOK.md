# Phase 20: Simulation Operations Runbook

**Document Reference:** `docs/phase-20/SIMULATION_OPERATIONS_RUNBOOK.md`  
**Phase:** 20 — Attack and Failure Simulation  
**Status:** Approved & Implemented  
**Date:** September 2026  

---

## 1. Safety Prerequisites

Before executing any simulation scenario:
1. **Target Environment**: Ensure the target is a local development or isolated staging cluster. Running simulations in production is programmatically blocked by `SafetyGuard`.
2. **Environment Variable**: Set `SIMULATION_MODE=true` in `.env` or process environment.
3. **Operator Credentials**: Authenticate with a role possessing `simulation:run:scenario` permission (`ADMIN`, `SYSTEM_ADMIN`, or authorized `OPERATOR`).

---

## 2. Executing Simulations via REST API

### 2.1 List Available Scenarios
```bash
curl -s -H "Authorization: Bearer $OPERATOR_TOKEN" \
  http://localhost:5000/api/v1/simulations/scenarios | jq .
```
Filter by domain category:
```bash
curl -s -H "Authorization: Bearer $OPERATOR_TOKEN" \
  http://localhost:5000/api/v1/simulations/scenarios?category=CONSENSUS | jq .
```

### 2.2 Run a Specific Scenario
```bash
curl -X POST \
  -H "Authorization: Bearer $OPERATOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"scenarioId": "CONSENSUS-001", "seed": 42}' \
  http://localhost:5000/api/v1/simulations/run | jq .
```

### 2.3 Query Execution Status & Evidence
Retrieve execution status:
```bash
curl -s -H "Authorization: Bearer $OPERATOR_TOKEN" \
  http://localhost:5000/api/v1/simulations/sim-1726641000000-a1b2c3d4 | jq .
```
Retrieve full evidence report:
```bash
curl -s -H "Authorization: Bearer $OPERATOR_TOKEN" \
  http://localhost:5000/api/v1/simulations/sim-1726641000000-a1b2c3d4/evidence | jq .
```

### 2.4 Query Execution History
```bash
curl -s -H "Authorization: Bearer $OPERATOR_TOKEN" \
  http://localhost:5000/api/v1/simulations/history?limit=10 | jq .
```

---

## 3. Emergency Stop Procedures

If an unexpected behavior, cluster instability, or network saturation occurs during a simulation:

### 3.1 Via REST API
Cancel a specific running simulation:
```bash
curl -X POST \
  -H "Authorization: Bearer $OPERATOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"reason": "Operator abort due to network spike"}' \
  http://localhost:5000/api/v1/simulations/sim-1726641000000-a1b2c3d4/stop
```

### 3.2 Global Programmatic Emergency Stop
In Node.js scripts or integration test runners:
```javascript
const { SafetyGuard } = require('./src/simulation');

// Trigger global stop
SafetyGuard.triggerEmergencyStop('Manual operator intervention');

// Check status
console.log('Emergency Stop active:', SafetyGuard.isEmergencyStopActive());

// Reset after cluster stabilization
SafetyGuard.resetEmergencyStop();
```

---

## 4. Post-Simulation Verification & Cleanup

1. **Verify Sandbox Cleaned Up**:
   Confirm that disposable temporary directories (`tmp-sim-*`) have been removed from the filesystem:
   ```bash
   ls -la /tmp/pdschain-simulations/
   ```
2. **Verify Cluster Health**:
   Confirm all cluster health probes return 200 OK:
   ```bash
   curl http://localhost:5000/health/ready
   ```
3. **Verify Ledger Monotonicity**:
   Confirm block height and finalized hashes are continuous:
   ```bash
   curl http://localhost:5000/api/v1/blockchain/status
   ```

