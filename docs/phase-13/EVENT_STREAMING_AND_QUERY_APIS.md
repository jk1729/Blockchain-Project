# PDSChain Phase 13: Event Streaming and Query APIs

## 1. REST Query API

The events query API is mounted at `/api/events` (and `/events` on isolated validator daemons).

### 1.1 Query Parameters (`GET /api/events`)

| Parameter | Type | Default | Description |
|---|---|---|---|
| `category` | string | `null` | Filter by `EVENT_CATEGORIES` (e.g. `CONTRACT`, `BLOCKCHAIN`) |
| `type` / `eventType` | string | `null` | Filter by `EVENT_TYPES` (e.g. `BLOCK_FINALIZED`) |
| `severity` | string | `null` | Filter by `DEBUG`, `INFO`, `WARNING`, `ERROR`, `CRITICAL` |
| `finalityStatus` | string | `null` | Filter by `PENDING`, `COMMITTED`, `FINALIZED`, `REVERTED` |
| `fromBlock` | number | `null` | Minimum block height (inclusive) |
| `toBlock` | number | `null` | Maximum block height (inclusive) |
| `blockHash` | string | `null` | Filter by 32-byte block hash |
| `txHash` | string | `null` | Filter by transaction hash |
| `contractAddress` | string | `null` | Filter by 20-byte EVM contract address |
| `since` / `fromTime`| ISO8601 | `null` | Filter events after timestamp |
| `until` / `toTime` | ISO8601 | `null` | Filter events before timestamp |
| `limit` | number | `50` | Maximum items per page (1 to 100) |
| `cursor` / `offset`| number | `0` | Cursor offset for next page |
| `q` | string | `null` | Free-text search matching ID, blockHash, txHash, contractAddress |

### 1.2 Response Format

```json
{
  "success": true,
  "schemaVersion": 1,
  "events": [ ... ],
  "total": 1420,
  "limit": 25,
  "offset": 0,
  "nextCursor": 25,
  "hasMore": true
}
```

---

## 2. Resource-Specific Endpoints

- `GET /api/events/:eventId`: Retrieve single event by UUID/ID.
- `GET /api/events/blocks/:heightOrHash`: Events associated with a specific block number or hash.
- `GET /api/events/transactions/:txHash`: Events associated with a specific transaction.
- `GET /api/events/contracts/:address`: Events emitted by a smart contract address.

---

## 3. Server-Sent Events (SSE) Streaming (`GET /api/events/stream`)

Enables real-time push streaming over standard HTTP.

### 3.1 Headers
```http
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
```

### 3.2 SSE Frame Format
```http
id: evt_41e0fd8831d24a56368979f34e9d32a4
event: BLOCK_FINALIZED
data: {"eventId":"evt_41e0fd8831d24a56368979f34e9d32a4","category":"BLOCKCHAIN","type":"BLOCK_FINALIZED",...}
```

### 3.3 Resume Protocol (`Last-Event-ID`)
When a network interruption occurs, the client reconnects passing the header:
```http
Last-Event-ID: evt_41e0fd8831d24a56368979f34e9d32a4
```
`EventStreamManager` immediately replays all missed events stored in `EventStore` before resuming the live stream.

### 3.4 Heartbeats & Backpressure
- 15-second keepalive frames (`: heartbeat\n\n`) prevent proxy disconnects.
- Slow-consumer eviction protects validator memory if client buffers exceed 500 queued messages.

---

## 4. Prometheus Telemetry (`GET /api/events/metrics`)

Returns Prometheus format when `Accept: text/plain` is provided:
- `pdschain_events_emitted_total`: Total events published.
- `pdschain_events_persisted_total`: Total events written to journal.
- `pdschain_events_query_total`: Total queries handled.
- `pdschain_events_streamed_total`: Total events delivered over SSE.
- `pdschain_events_stream_active_clients`: Current active SSE connections.
- `pdschain_events_queue_depth`: EventBus in-memory queue depth.
- `pdschain_events_dropped_total`: Backpressure dropped count.
- `pdschain_events_deduplicated_total`: Suppressed duplicates.

