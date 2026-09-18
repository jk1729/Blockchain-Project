# PDSChain Phase 13: Event Integrity and Audit Runbook

## 1. Subsystem Architecture & Storage Layout

The PDSChain Blockchain Events subsystem provides an append-only, durable, and cryptographically verified record of all network, consensus, contract, and ledger state transitions.

```
[Validator Node Process]
       │
       ├── EventBus (In-Memory Pub/Sub) ────► EventStreamManager (SSE Clients)
       │        ▲                                     │ (Last-Event-ID Resume)
       │        │ (Persist & Publish)                 ▼
       ├── EventStore (Storage Layer) ───────► EventController (REST APIs)
       │        │                                     │
       │        ▼ (Append-Only Write)                 ▼
       └── <dataDir>/events_journal.jsonl      Prometheus Metrics (/api/events/metrics)
```

### 1.1 Storage Files & Artifacts
Each validator maintains an isolated, independent storage directory configured via `StorageLayout`:
- **Primary Journal**: `<validator_dir>/events_journal.jsonl`
  - Append-only JSON Lines format.
  - Every line represents a single UTF-8 encoded `BlockchainEvent` JSON object followed by a newline `\n`.
  - Max payload length: 64 KB per event.
- **Corruption Quarantine**: `<validator_dir>/events_journal.corrupt.<timestamp>`
  - Generated automatically if unparseable or corrupted lines are detected during crash recovery or initialization.
  - Contains the corrupted snapshot preserving state for forensic analysis.

---

## 2. Event Integrity Guarantees

### 2.1 Deduplication & Idempotency Engine
PDSChain enforces strict idempotency across node restarts, peer ledger synchronization, and write-ahead journal replay.
- **Deduplication Key Scheme**:
  - Transaction Events: `TX:<txHash>:<type>`
  - Block Events: `BLOCK:<blockHeight>:<type>`
  - Contract Events: `CONTRACT:<contractAddress>:<txHash>:<logIndex>`
  - Explicit / Generic Events: `EVT:<eventId>`
- **Registry Mechanics**:
  - `EventStore` maintains an in-memory `Set<string>` of all observed `dedupKey`s.
  - If an incoming event matches an existing key, `EventStore.record()` discards or skips it, preventing ledger duplicate inflation.
  - During `replay()` or `recover()`, `dedupKeys` is populated line-by-line, ensuring recovery replay produces an identical in-memory index state.

### 2.2 Finality Lifecycle Transitions
Events adhere to a unidirectional finality state machine:
```
           ┌──────────────┐
           │   PENDING    │
           └──────┬───────┘
                  │ Block inclusion / Proposal
                  ▼
           ┌──────────────┐
           │  COMMITTED   │
           └──────┬───────┘
                  │ 2/3+ Quorum Certificate / 2 confirmations
                  ▼
           ┌──────────────┐
     ┌────►│  FINALIZED   │
     │     └──────────────┘
     │            
┌────┴─────────┐
│   REVERTED   │ (Consensus reorganization / transaction revert)
└──────────────┘
```
- Only blocks validated by FBA consensus and cryptographic certificates transition to `FINALIZED`.
- Reverted transactions or reorganizations emit `REVERTED` events and never transition to `FINALIZED`.

### 2.3 Strict Secret Redaction & Memory Hygiene
PDSChain guarantees zero secret leakage across event journals, API responses, SSE streams, and logs.
- **Redaction Blacklist**:
  The recursive `_sanitizePayload` filter inspects all payload keys (case-insensitive substring match):
  - `privatekey`, `private_key`
  - `seed`, `mnemonic`
  - `secret`, `passphrase`, `password`
  - `token`, `authorization`
  - `keymaterial`
- **Redaction Mask**: Any blacklisted field value is replaced with `"[REDACTED]"`.
- **Validation**: Schema tests (`tests/events-schema.test.js` and `tests/events-adversarial-security.test.js`) enforce zero secret retention even in nested structures.

---

## 3. Disaster Recovery & Operator Runbooks

### Runbook 13-A: Sudden Node Crash & Journal Recovery
**Trigger**: A validator node process terminates abruptly (power failure, SIGKILL, host crash).
**Automatic Procedure**:
1. When `validatorProcess.js` starts, it initializes `EventStore` with `recover: true`.
2. `EventStore.recover()` reads `<dataDir>/events_journal.jsonl` sequentially.
3. Valid lines are parsed and their `dedupKey`, `category`, `type`, `blockHeight`, `txHash`, and `finalityStatus` are reconstructed into memory indices.
4. If a partial/truncated write is detected at the very end of the file (e.g., interrupted disk write), the partial trailing line is trimmed safely and logged.
5. In-memory `metrics` and counters are re-aligned with the recovered journal.

**Verification Step**:
```bash
# Check recovery logs in validator daemon output
grep "EventStore: Recovered" logs/validator-*.log
# Query event count via REST API
curl -s http://127.0.0.1:8545/api/events/stats
```

---

### Runbook 13-B: Journal Corruption & Quarantine Handling
**Trigger**: Malformed or non-JSON content introduced inside `events_journal.jsonl` (e.g. disk sector corruption or unauthorized manual tampering).
**Automated Recovery Behavior**:
1. `EventStore.recover()` encounters an invalid JSON line midway through the file.
2. The corrupt file is immediately copied to `<dataDir>/events_journal.corrupt.<timestamp>`.
3. All valid preceding events are retained; subsequent valid lines are salvaged.
4. The cleaned event journal is rewritten to `events_journal.jsonl`.
5. An alarm event (`EVENT_ERROR` / `RECOVERY_COMPLETED`) is published to the `EventBus`.

**Operator Action**:
1. Inspect quarantine file:
   ```bash
   diff -u <dataDir>/events_journal.jsonl <dataDir>/events_journal.corrupt.*
   ```
2. Verify if missing events need to be backfilled from peers:
   ```bash
   curl -X POST http://127.0.0.1:8545/api/sync/trigger
   ```
3. Run index rebuild:
   ```bash
   # Rebuilds internal indices without restarting the node
   curl -X POST http://127.0.0.1:8545/api/events/reindex
   ```

---

### Runbook 13-C: Slow-Consumer Eviction on SSE Stream
**Trigger**: A client listening to `/api/events/stream` or `/events/stream` stops reading from the socket or suffers high network latency, causing buffered events to exceed `CLIENT_MAX_BUFFER` (500 events).
**Behavior**:
1. `EventStreamManager` detects client queue size > 500.
2. The client is immediately evicted, the HTTP connection is closed with an eviction log, and buffer memory is freed.
3. System counter `slowConsumersEvicted` is incremented.

**Operator & Client Remediation**:
1. The frontend (`frontend/js/events.js`) catches the `EventSource.onerror` event.
2. The client initiates an exponential backoff reconnect with the HTTP header `Last-Event-ID: <last_seen_id>`.
3. `EventStreamManager` automatically queries `EventStore` for missed events since `last_seen_id` and backfills them to the reconnected client before resuming live stream events.

---

### Runbook 13-D: Large Payload / Flooding Attack Mitigation
**Trigger**: Malicious peer or contract generates oversized event payloads or emits an excessive burst of events.
**Enforcement**:
1. **Size Bound**: `BlockchainEvent.create()` and constructor validate payload size (`JSON.stringify(payload).length <= 64 * 1024`). Payloads exceeding 64KB throw `Event payload exceeds maximum allowed size (64KB)` and are discarded.
2. **Queue Bound**: `EventBus` has a bounded in-memory queue of 5,000 events. If backpressure occurs, new events trigger queue-overflow protections.
3. **Recursion Limit**: Event listeners that emit secondary events are limited to a max recursion depth of 5, preventing recursive cascading stack overflow.

---

## 4. Forensic Audit & Compliance Verification

### 4.1 Audit Checklist for Operators
| Check Item | Validation Command / Method | Expected Result |
|---|---|---|
| **No Plaintext Private Keys** | `grep -i -E "privateKey|seed|secret|passphrase" events_journal.jsonl` | Only occurrences should be `"[REDACTED]"` |
| **Journal Monotonicity** | Verify `timestamp` ordering in `events_journal.jsonl` | Strictly ascending ISO-8601 timestamps |
| **Deduplication Integrity** | Run `tests/events-persistence-replay.test.js` | Zero duplicate events recorded on replay |
| **Receipt Log Topic Integrity** | Compare EVM receipt logs with Solidity contract ABI | Indexed topics correctly format 32-byte hex words |
| **Stream Backpressure** | Inspect `/api/events/metrics` for `pdschain_events_slow_consumers_evicted` | Monitored gauge within normal operational limits |

### 4.2 Replaying Events to External Systems
To stream historical events into external SIEM, ELK, or compliance data warehouses:
```javascript
import { EventStore } from './src/events/EventStore.js';

const store = new EventStore({ storagePath: './data/events_journal.jsonl' });
await store.initialize();

await store.replay({
  fromBlock: 0,
  toBlock: 100000,
  category: 'CONTRACT'
}, async (event) => {
  await forwardToExternalSIEM(event);
});
```

---

## 5. Summary & Sign-Off

The PDSChain Event Integrity and Audit mechanisms guarantee:
- **Durable Zero-Loss Persistence**: Fully recoverable append-only JSON Lines journal.
- **Idempotency**: Strict deduplication keys prevent ghost events or duplicate replays.
- **Tamper & Corruption Resilience**: Automatic quarantine and partial recovery protect operational continuity.
- **Privacy & Security**: Zero secret leakage across storage, streams, and APIs.

