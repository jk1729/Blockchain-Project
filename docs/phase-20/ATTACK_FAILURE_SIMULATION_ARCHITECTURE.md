# Phase 20: Attack and Failure Simulation — Architecture & Safety Model

**Document Reference:** `docs/phase-20/ATTACK_FAILURE_SIMULATION_ARCHITECTURE.md`  
**Phase:** 20 — Attack and Failure Simulation  
**Status:** Approved & Implemented  
**Date:** September 2026  

---

## 1. Architectural Overview

The PDSChain Attack and Failure Simulation Platform is designed as an institutional-grade, non-destructive control plane for validating system resilience. It operates as a modular, sandboxed subsystem within `backend/src/simulation/` that orchestrates realistic adversarial attacks and infrastructure faults against local or staging instances of PDSChain.

### Core Architectural Principles
1. **Deterministic Execution**: All scenario variations and pseudo-random decisions derive from a seeded PRNG (Pseudo-Random Number Generator), guaranteeing 100% repeatability across debugging runs.
2. **Strict Isolation & Reversibility**: Mutating simulations execute inside isolated sandbox directories (`tmp-sim-*`) and against disposable test instances. Every injected fault must possess an automated recovery and rollback hook.
3. **Defense-in-Depth Safety Guard**: Multi-layer runtime guards verify environment variables, database connection strings, and network targets prior to running any scenario.
4. **End-to-End Observability Correlation**: Simulation events emit correlated logs, Prometheus metrics, distributed trace spans, and health probe status transitions, validating that Phase 19 observability detects the simulated fault.
5. **Auditable Evidence Generation**: Every run yields a structured, tamper-evident JSON evidence report summarizing pre- and post-states, invariant checks, detected anomalies, RPO, and RTO.

---

## 2. Component Architecture

```
+-----------------------------------------------------------------------------------+
|                           SIMULATION CONTROL PLANE                                |
|                                                                                   |
|  +---------------------+   +---------------------+   +-------------------------+  |
|  |     SafetyGuard     |-->|  SimulationRunner   |<--|    ScenarioRegistry     |  |
|  | (Anti-Prod / Auth)  |   | (Lifecycle Engine)  |   | (Metadata & Scenarios)  |  |
|  +---------------------+   +----------+----------+   +-------------------------+  |
|                                       |                                           |
|                  +--------------------+--------------------+                      |
|                  |                                         |                      |
|         +--------v----------+                    +---------v---------+            |
|         | SimulationContext |                    | InvariantMonitor  |            |
|         | - PRNG (Seed)     |                    | - Ledger Height   |            |
|         | - Temp Sandbox    |                    | - Hash Continuity |            |
|         | - Baseline State  |                    | - DB Atomicity    |            |
|         | - Cleanup Hooks   |                    | - Redaction Check |            |
|         +--------+----------+                    +---------+---------+            |
|                  |                                         |                      |
|  +---------------v-----------------------------------------v-------------------+  |
|  |                             SCENARIO DOMAINS                                |  |
|  |  [AUTH] [INPUT] [CONSENSUS] [NETWORK] [DATABASE] [RESOURCE] [OBS] [RECOVERY]  |  |
|  +-------------------------------------+---------------------------------------+  |
|                                        |                                          |
|  +-------------------------------------v---------------------------------------+  |
|  |                     EVIDENCE COLLECTION & TELEMETRY                         |  |
|  |    Structured Logs (simulationId) | Prometheus Metrics | Health Status      |  |
|  +-----------------------------------------------------------------------------+  |
+-----------------------------------------------------------------------------------+
```

### 2.1 Component Specifications

#### SafetyGuard (`SafetyGuard.js`)
- Enforces runtime pre-conditions before any simulation starts.
- Inspects `process.env.SIMULATION_MODE`, `process.env.NODE_ENV`, and database connection strings.
- Rejects non-loopback network targets by default.
- Implements global emergency stop (`SafetyGuard.triggerEmergencyStop()`) to abort active scenarios immediately.
- Enforces strict execution time budgets (default max: 30,000 ms).

#### SimulationContext (`SimulationContext.js`)
- Encapsulates execution state for a single scenario instance.
- Generates a cryptographically unique `simulationId` (`sim-<timestamp>-<randomHex>`).
- Initializes a deterministic pseudo-random number generator (PRNG) with an optionally supplied or auto-generated integer seed.
- Creates a dedicated sandbox filesystem directory (`tmp-sim-<simulationId>`) for temporary files, journals, and databases.
- Captures the initial baseline snapshot (ledger height, block hash, database state, metric counters).
- Maintains a registry of cleanup callbacks guaranteed to run in `finally` blocks upon completion, error, or timeout.

#### InvariantMonitor (`InvariantMonitor.js`)
- Validates system safety rules across four orthogonal dimensions:
  1. **Ledger Invariants**: Block height is strictly non-decreasing; finalized hashes are immutable; block sequence is continuous; Merkle roots and signatures are valid; duplicate transactions are rejected.
  2. **Database Invariants**: Atomic rollbacks leave zero partial records; writer fencing tokens are strictly monotonically increasing; corrupt journals are quarantined to `.corrupt` sidecars.
  3. **Security Invariants**: Default-deny access holds; unauthenticated or unauthorized calls yield HTTP 401/403; zero credentials or private keys leak into logs, errors, or evidence.
  4. **Observability Invariants**: Structured log entries contain `simulationId`; Prometheus metrics increment accurately; health probes transition to degraded/unhealthy during failure and recover afterward.

#### ScenarioRegistry (`ScenarioRegistry.js`)
- Centralized index of all available scenarios categorized by domain:
  - `AUTH`: Authentication, authorization, IDOR, brute-force, token tampering.
  - `INPUT`: Protocol abuse, malformed JSON-RPC, ReDoS patterns, prototype pollution.
  - `CONSENSUS`: Double-voting, stale rounds, validator crashes, quorum loss, writer fencing.
  - `NETWORK`: Peer disconnects, packet drops, latency/jitter, connection refusal.
  - `DATABASE`: Connection pool exhaustion, transaction rollback, journal corruption, migration checksum mismatch.
  - `RESOURCE`: Mempool saturation, worker queue flooding, event-loop lag.
  - `OBSERVABILITY`: Telemetry transport failures, scrape failures, trace corruption.
  - `RECOVERY`: Backup corruption rejection, staging restore verification, RPO/RTO measurement.

#### SimulationRunner (`SimulationRunner.js`)
- Orchestrates the standardized 11-step scenario lifecycle.
- Records all lifecycle events with nanosecond timestamps.
- Manages an in-memory execution history buffer with bounded capacity (default: 100 runs).

---

## 3. The 11-Step Scenario Lifecycle

Every scenario executed through `SimulationRunner` must transition through the following deterministic 11-step lifecycle:

```
[1. Prepare Env] ---> [2. Baseline Snapshot] ---> [3. Seed Fixtures]
        |
        v
[4. Start Telemetry] ---> [5. Inject Fault] ---> [6. Observe Behavior]
        |
        v
[7. Verify Invariants] ---> [8. Recover System] ---> [9. Compare Baseline]
        |
        v
[10. Generate Evidence] ---> [11. Cleanup Sandbox]
```

1. **Prepare Isolated Environment**: Validate safety via `SafetyGuard`. Allocate isolated sandbox directory `tmp-sim-<simulationId>`.
2. **Capture Baseline State**: Query and snapshot current system state (ledger height, tip hash, DB transaction count, baseline metric values).
3. **Seed Deterministic Fixtures**: Populate synthetic identities, deterministic mock transactions, and test validators using seeded PRNG.
4. **Start Telemetry Collection**: Initialize trace span (`simulation.run`), set `RequestContext` with `simulationId`, and capture metric counters.
5. **Inject Attack or Failure**: Invoke the scenario's reversible fault-injection routine (e.g. drop peer socket, inject duplicate vote, corrupt journal line).
6. **Observe System Behavior**: Measure system response under stress, verify rejection codes, and poll health endpoints (`/health/ready`).
7. **Verify Safety Invariants**: Execute `InvariantMonitor.verifyAll()`. If an invariant fails, immediately trigger emergency stop and fail the scenario.
8. **Recover System**: Trigger automated or operator recovery routine (e.g., reconnect peer, replay valid journal, restore backup, unblock pool).
9. **Compare Post-Recovery State with Baseline**: Confirm system has returned to a valid operational state and that finalized ledger records remain identical to baseline.
10. **Generate Evidence Report**: Compile a structured JSON artifact recording execution parameters, duration, RPO, RTO, invariant check outcomes, and telemetry deltas.
11. **Destroy Disposable Resources**: Execute all registered cleanup hooks, close temporary sockets, and delete sandbox directories.

---

## 4. Synthetic Identity & Data Model

Simulations strictly utilize synthetic identities and disposable cryptographic keys:
- **Synthetic Validators**: Deterministically generated Ed25519 or ECDSA keys prefixed with `sim-val-` (e.g. `sim-val-01`, `sim-val-02`).
- **Synthetic Beneficiaries / Clients**: Ephemeral addresses prefixed with `0x513...` (hex for "SIM") or standard deterministic test keypairs.
- **Mock Rations & Commodities**: Synthetic commodities (`SIM-WHEAT`, `SIM-RICE`) with bounded quota amounts.
- **Disposable Databases**: In-memory SQLite instances or isolated SQLite files located exclusively within the scenario's `tmp-sim-*` sandbox directory.

---

## 5. Pass/Fail Classification & Evaluation Criteria

A simulation execution is classified under one of four definitive states:

1. **PASSED**:
   - The injected fault/attack was contained and rejected as expected.
   - All safety invariants verified successfully.
   - Recovery procedure succeeded and restored healthy operation.
   - Telemetry (logs, metrics, alerts) correctly recorded the event.
   - Post-recovery state matched baseline expectations.
   - Cleanup succeeded with zero orphaned resources.

2. **FAILED_INVARIANT**:
   - An immutable safety invariant was violated (e.g. finalized block mutated, unauthorized access succeeded, stale writer committed).
   - Triggers immediate emergency stop.

3. **FAILED_RECOVERY**:
   - The attack was rejected, but the system failed to recover to a healthy state within the configured RTO budget.

4. **BLOCKED_SAFETY**:
   - The simulation refused to execute because `SafetyGuard` detected an unsafe environment (e.g., production flag, non-loopback host, missing simulation mode).

---

## 6. Zero Secret Leakage Guarantees

In strict accordance with Phase 17 and Phase 19 specifications:
- Simulation evidence documents, logs, and telemetry are sanitized through `StructuredLogger.redactSecrets()`.
- No raw private keys, authorization tokens, passwords, or seed phrases are ever serialized to disk or exposed via simulation REST APIs.
- Synthetic keypairs used in Byzantine tests are identified only by their public key hashes or validator identifiers.

