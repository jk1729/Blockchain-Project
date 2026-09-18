# PDSChain Phase 13: Event Persistence, Journal Replay & Crash Recovery

## 1. Overview

The EventStore persistence architecture guarantees that events emitted across all validator lifecycle stages are durably stored on disk, queryable in memory, and recoverable without duplicates following node restarts, crashes, or partition syncs.

---

## 2. Storage Layout & File Format

The append-only journal file is stored at:
```
<dataDir>/events_journal.jsonl
```

For isolated validator daemons (e.g. `VAL-01`, `VAL-02`), this maps to:
```
database/validators/VAL-01/events_journal.jsonl
database/validators/VAL-02/events_journal.jsonl
```

### 2.1 File Format
The journal is formatted as strict JSON Lines (`.jsonl`), where each newline-terminated line contains a single serialized `BlockchainEvent` JSON object:

```json
{"eventId":"evt_625c276bc38a2e1d743a123f81e05a8b","schemaVersion":1,"category":"BLOCKCHAIN","type":"BLOCK_FINALIZED","severity":"INFO","finalityStatus":"FINALIZED","blockHeight":1,"blockHash":"0x88c2...","dedupKey":"BLOCK:1:BLOCK_FINALIZED:FINALIZED","payload":{"txCount":2},"timestamp":"2026-09-17T13:10:00.000Z"}
```

---

## 3. Deduplication & Idempotency Invariants

Replay operations, synchronization catches, and consensus recovery must never generate duplicate events.

### 3.1 Composite Deduplication Key Scheme
Every event defines a deterministic composite key:
- **Block Events**: `BLOCK:<blockHeight>:<eventType>:<finalityStatus>`
- **Transaction Events**: `TX:<txHash>:<eventType>:<blockHeight>`
- **Contract Logs**: `LOG:<blockHeight>:<txIndex>:<logIndex>:<eventType>`
- **Consensus Events**: `CONSENSUS:<validatorId>:<round>:<eventType>:<blockHeight>`
- **Generic Events**: `eventId`

### 3.2 Deduplication Key Registry
The `EventStore` maintains an in-memory Map:
```javascript
this.dedupKeys = new Map(); // dedupKey -> eventId
```
When `eventStore.record(event)` is called:
1. The deduplication key is calculated.
2. If `this.dedupKeys.has(dedupKey)` returns true, recording is aborted and returns `false`.
3. The journal file is not appended to, preserving disk space and index uniqueness.

---

## 4. Crash Recovery & Journal Replay

Upon validator startup or daemon recovery:
1. `EventStore.initialize()` is called.
2. `EventStore.recover()` opens `events_journal.jsonl`.
3. Each line is parsed and validated against `BlockchainEvent`.
4. Corrupted lines (e.g., partial writes from sudden power cutoff) are quarantined and logged with a warning, allowing remaining valid events to be parsed without failure.
5. In-memory indexes (`eventsById`, `dedupKeys`) are fully reconstructed in memory.

---

## 5. Ledger Rebuild Tooling

When a node synchronizes from a snapshot or needs to rebuild events from scratch:
```javascript
eventStore.rebuildFromBlockchain(blockchain, evmRuntime);
```
Iterates through all confirmed blocks in the `Blockchain` ledger:
1. Emits `BLOCK_FINALIZED` for each block.
2. Emits `TRANSACTION_EXECUTED` for each confirmed transaction.
3. If EVM receipts are present, decodes logs and emits `CONTRACT_EVENT_EMITTED`.

