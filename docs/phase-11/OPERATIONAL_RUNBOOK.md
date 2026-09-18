# PDSChain Phase 11: Operational Observability & Health Runbook

## 1. Health Probe Architecture

PDSChain decouples process health into three distinct operational states:

```
                      ┌────────────────────────┐
                      │    GET /health/live    │ ◄── Process alive, event loop responsive
                      └───────────┬────────────┘
                                  │
                                  ▼
                      ┌────────────────────────┐
                      │    GET /health/ready   │ ◄── Storage, DB, and P2P sockets ready
                      └───────────┬────────────┘
                                  │
                                  ▼
                      ┌────────────────────────┐
                      │ GET /health/consensus  │ ◄── Synced to chain head, voting in FBA
                      └────────────────────────┘
```

### Probing Matrix

| Probe Endpoint | Success (200 OK) | Failure (503 Service Unavailable) | Intended Consumer |
| :--- | :--- | :--- | :--- |
| `GET /health/live` | Process is running and accepting IPC/HTTP requests. | Process is terminating (`isShuttingDown: true`) or event loop blocked. | Docker / Kubernetes Liveness Probe |
| `GET /health/ready` | SQLite DB, Storage Layout, and P2P sockets are initialized and listening. | Storage lock held, initialization failed, or socket closed. | Kubernetes Readiness Probe |
| `GET /health/consensus` | Ledger is caught up to target (`syncState.isConsensusReady() === true`). | Node is in `BOOTSTRAPPING`, `RECOVERING`, `SYNCING`, `HALTED`, or `CORRUPTED`. | Consensus Quorum Monitor / Load Balancer |

---

## 2. Version & Packaging Diagnostics

The `/version` endpoint exposes canonical runtime metadata:

```bash
curl -s http://localhost:4001/version | jq .
```

### Sample Output:
```json
{
  "application": "PDSChain Validator Runtime",
  "version": "1.0.0",
  "commitHash": "c8f7d1e0-phase-11",
  "protocolVersion": 1,
  "chainId": 1729,
  "networkId": "pdschain-mainnet",
  "runtime": {
    "node": "v20.18.0",
    "platform": "linux",
    "arch": "x64"
  },
  "timestamp": 1773739200000
}
```

---

## 3. Prometheus Metrics Scraping

Prometheus metrics are exposed at `GET /metrics` with `Accept: text/plain`:

```bash
curl -s -H "Accept: text/plain" http://localhost:4001/metrics
```

### Key Phase 11 Metrics:
- `pdschain_validator_is_live`: Gauge (1 = live, 0 = terminating).
- `pdschain_validator_is_ready`: Gauge (1 = ready, 0 = not ready).
- `pdschain_validator_is_consensus_ready`: Gauge (1 = active in FBA consensus, 0 = syncing/recovering).
- `pdschain_validator_restarts_total`: Counter tracking unexpected supervisor restarts.
- `pdschain_validator_crashes_total`: Counter tracking ungraceful crashes.
- `pdschain_block_finalization_latency_ms`: Gauge recording consensus round commit duration.

---

## 4. Troubleshooting Playbooks

### Playbook 1: Port Collision on Startup (`PORT_COLLISION`)
- **Symptom**: Process fails to boot; error log: `listenPort (5001) and apiPort (5001) cannot be identical`.
- **Resolution**: Check `validator.json` or environment variables and ensure `P2P_PORT` (default: 5001-5012) and `API_PORT` (default: 4001-4012) are different.

### Playbook 2: Storage Lock Conflict (`STORAGE_LOCK_CONFLICT`)
- **Symptom**: Process aborts on boot; error log: `Validator VAL-01 storage is already locked by running process (PID 1234)`.
- **Resolution**: Verify if another instance is already running (`ps aux | grep VAL-01`). If an earlier instance crashed ungracefully and the PID is stale, the daemon auto-cleans on subsequent boot. If the process is still running, stop it before starting a new one.

### Playbook 3: Node Alive but Not Consensus Ready (503 on `/health/consensus`)
- **Symptom**: `/health/live` returns 200, but `/health/consensus` returns 503.
- **Resolution**: Query `GET /api/ledger/status`. The node is actively catching up or recovering missing blocks. Once caught up to network target height, it transitions to `CURRENT` and `/health/consensus` will return 200.

