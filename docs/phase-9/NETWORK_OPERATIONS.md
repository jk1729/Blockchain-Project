# PDSChain Phase 9: Network Operations, Observability & Telemetry

## 1. Network Observability Endpoints

The backend API server and individual validator daemons expose real-time diagnostic and telemetry endpoints:

### Endpoints:

| Method | Path | Target | Description |
|---|---|:---:|---|
| `GET` | `/api/network/status` | Central API | Overall federation health, chain ID, active peer counts |
| `GET` | `/api/network/peers` | Central API | Active peer connections with state, latency, and uptime |
| `GET` | `/api/network/topology` | Central API | Complete 12-validator institutional mapping & quorum slices |
| `GET` | `/api/network/metrics` | Central API | Prometheus metrics or JSON performance snapshot |
| `GET` | `/health` | Validator Node | Process health, PID, node status, and uptime |
| `GET` | `/status` | Validator Node | Node metadata, block height, and active peer list |
| `POST` | `/status` | Validator Node | Fault injection endpoint to toggle status (`Online`, `Offline`, `Degraded`) |
| `GET` | `/metrics` | Validator Node | Node-specific message counters, framing errors, and latencies |
| `GET` | `/peers` | Validator Node | Connected peer list for this individual node |
| `GET` | `/blocks` | Validator Node | Blocks committed to this node's local ledger |

---

## 2. Prometheus Metrics Reference

When querying `GET /api/network/metrics` with `Accept: text/plain`, the endpoint outputs standard Prometheus metrics:

```text
# HELP pdschain_network_active_connections Number of active peer connections
# TYPE pdschain_network_active_connections gauge
pdschain_network_active_connections 11

# HELP pdschain_network_messages_sent_total Total messages sent by type
# TYPE pdschain_network_messages_sent_total counter
pdschain_network_messages_sent_total{type="PROPOSAL"} 42
pdschain_network_messages_sent_total{type="VOTE"} 504
pdschain_network_messages_sent_total{type="HEARTBEAT"} 1200

# HELP pdschain_network_messages_received_total Total messages received by type
# TYPE pdschain_network_messages_received_total counter
pdschain_network_messages_received_total{type="VOTE"} 504
pdschain_network_messages_received_total{type="HEARTBEAT"} 1200

# HELP pdschain_network_messages_rejected_total Total messages rejected by reason
# TYPE pdschain_network_messages_rejected_total counter
pdschain_network_messages_rejected_total{reason="UNAUTHORIZED_PEER"} 0
pdschain_network_messages_rejected_total{reason="MESSAGE_TAMPERED"} 0

# HELP pdschain_network_duplicates_total Total duplicate messages ignored
# TYPE pdschain_network_duplicates_total counter
pdschain_network_duplicates_total 14

# HELP pdschain_network_framing_errors_total Total stream framing errors
# TYPE pdschain_network_framing_errors_total counter
pdschain_network_framing_errors_total 0

# HELP pdschain_network_peer_latency_ms Peer latency in milliseconds
# TYPE pdschain_network_peer_latency_ms gauge
pdschain_network_peer_latency_ms{peer="VAL-02"} 3
pdschain_network_peer_latency_ms{peer="VAL-03"} 4
```

---

## 3. Operational Failure Simulations

For institutional demonstrations or academic auditing, validator nodes can be degraded or disabled via HTTP POST:

```bash
# Take VAL-05 offline
curl -X POST http://localhost:4005/status \
  -H "Content-Type: application/json" \
  -d '{"status": "Offline"}'

# Verify consensus still operates with 11 nodes (requires >= 9)
curl http://localhost:3000/api/network/status

# Restore VAL-05 back to Online
curl -X POST http://localhost:4005/status \
  -H "Content-Type: application/json" \
  -d '{"status": "Online"}'
```

