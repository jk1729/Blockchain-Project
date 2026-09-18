# Phase 20: Simulation Configuration Reference

**Document Reference:** `docs/phase-20/ATTACK_FAILURE_SIMULATION_CONFIGURATION.md`  
**Phase:** 20 — Attack and Failure Simulation  
**Status:** Approved & Implemented  
**Date:** September 2026  

---

## 1. Environment Variable Reference

The simulation control plane is configured via the following environment variables:

| Variable | Type | Default | Required | Description |
| :--- | :--- | :--- | :--- | :--- |
| `SIMULATION_MODE` | Boolean (`true`/`false`) | `false` | **Yes** | Master gate enabling the simulation engine and `/api/v1/simulations/*` endpoints. If `false` or absent, all simulation operations are blocked. |
| `NODE_ENV` | String | `development` | No | If set to `production` or `prod`, `SafetyGuard` will unconditionally refuse to execute any simulation. |
| `ENVIRONMENT` | String | `development` | No | Secondary environment flag. If set to `production`, simulations are blocked. |
| `SIMULATION_MAX_DURATION_MS` | Integer | `60000` (60s) | No | Maximum permitted duration for any single scenario run before timeout abortion. |
| `SIMULATION_MAX_PAYLOAD_BYTES` | Integer | `5242880` (5MB) | No | Hard cap on simulated synthetic payload sizes to prevent memory exhaustion. |
| `SIMULATION_MAX_CONCURRENCY` | Integer | `20` | No | Maximum concurrent requests allowed during stress or load simulations. |
| `SIMULATION_ALLOWED_HOSTS` | Comma-separated | `localhost,127.0.0.1,::1,0.0.0.0` | No | Optional list of additional staging hostnames allowed as targets. Production hosts are rejected regardless. |

---

## 2. Configuration Safety Invariants

1. **Production Immunity**: Setting `SIMULATION_MODE=true` inside an environment where `NODE_ENV=production` will result in an immediate `E_SIMULATION_PROD_ENV_REFUSED` error. The production check takes absolute precedence.
2. **Database Keyword Fencing**: Any database URL containing `prod`, `production`, `mainnet`, or cloud provider hosted database domains (`rds.amazonaws.com`, etc.) will trigger `E_SIMULATION_PRODUCTION_DATABASE`.
3. **Sandbox Directory Fencing**: All file operations are restricted to directories matching `tmp-sim-*`. Attempting to target root, `/etc`, or application source code directories triggers `E_SIMULATION_UNSAFE_DIRECTORY`.

