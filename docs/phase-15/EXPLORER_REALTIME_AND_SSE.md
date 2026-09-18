# PDSChain Phase 15: Explorer Real-Time Activity and SSE Updates

## 1. Overview

The PDSChain Explorer integrates real-time event streaming powered by the Phase 13 `EventBus` and `EventStore` at `/api/v1/events/stream`. Rather than polling the server aggressively and degrading node performance, the explorer maintains a single, resilient Server-Sent Events (SSE) connection that delivers instant updates when blocks are finalized, transactions execute, or consensus rounds progress.

---

## 2. Streaming Protocol & Headers

### 2.1 Connection Establishment
- **Endpoint**: `GET /api/v1/events/stream`
- **Headers**:
  - `Content-Type: text/event-stream`
  - `Cache-Control: no-cache, no-transform`
  - `Connection: keep-alive`
  - `X-Accel-Buffering: no`

### 2.2 Event Envelope Format
Events arrive as standard SSE messages formatted with `id:`, `event:`, and `data:` fields:
```text
id: EVT-1729000000000-01
event: BLOCK_FINALIZED
data: {"eventId":"EVT-1729000000000-01","eventType":"BLOCK_FINALIZED","category":"BLOCKCHAIN","severity":"INFO","finalityStatus":"FINALIZED","blockHeight":5,"blockHash":"0x...","timestamp":"2026-09-17T21:30:00.000Z","payload":{"txCount":1}}
```

---

## 3. Resilience, Reconnection, and Resume

1. **Automatic Reconnection**:
   - The browser's native `EventSource` automatically retries connection upon network interruption.
   - The UI displays an amber reconnection indicator while reconnecting, transitioning to green immediately upon `onopen`.
2. **`Last-Event-ID` Resume**:
   - When reconnecting, the client transmits the `Last-Event-ID` header.
   - The backend `EventStore` replays missed events from the append-only journal so no finalized blocks or transactions are missed during brief dropouts.
3. **Client-Side Deduplication**:
   - Events are checked against a client-side `seenEventIds = new Set()` before updating the UI ticker or table.
   - Any replayed event that was already displayed is silently ignored, preventing flickering or duplicate rows.
4. **Buffer Bounding**:
   - The real-time table caps its maximum rendered length at 25 items (`tbody.removeChild(tbody.lastChild)`), ensuring constant DOM memory usage over long-running dashboard sessions.
5. **Cache Invalidation**:
   - Whenever a `BLOCK_FINALIZED` or `TRANSACTION_EXECUTED` event is received, `ExplorerAPI.invalidateCache()` is invoked immediately, ensuring subsequent REST clicks always fetch fresh block and balance records.

