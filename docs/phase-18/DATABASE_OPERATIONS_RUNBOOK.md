# Phase 18: Database Operations Runbook

**Project**: PDSChain — Blockchain-Based Public Distribution System  
**Phase**: Phase 18 — Production Database Architecture  
**Document**: Operations Runbook  
**Date**: September 17, 2026  
**Status**: APPROVED  

---

## 1. Routine Operational Procedures

### 1.1 Health & Connectivity Verification
Check database connectivity and WAL status via REST or CLI:
```bash
# Public Health Probe
curl -s http://localhost:3000/health/database

# Detailed Diagnostic Status (Requires operator:read:node-status token)
curl -s -H "Authorization: Bearer <TOKEN>" http://localhost:3000/api/v1/database/status
```

### 1.2 SQLite WAL Checkpointing & Compaction
SQLite in WAL mode accumulates writes in `pdschain.sqlite-wal`. Run periodic passive or checkpoint operations:
```sql
-- Passive checkpoint (does not block readers or writers)
PRAGMA wal_checkpoint(PASSIVE);

-- Truncate WAL file after low activity
PRAGMA wal_checkpoint(TRUNCATE);
```

---

## 2. Ledger Integrity Verification

To verify that block headers, Merkle roots, previousHash chains, and consensus certificates are 100% consistent across the ledger:
```bash
curl -s -X POST \
  -H "Authorization: Bearer <RECOVERY_TOKEN>" \
  http://localhost:3000/api/v1/database/verify-integrity
```
Expected response:
```json
{
  "success": true,
  "data": {
    "valid": true,
    "errors": [],
    "verifiedBlocks": 120,
    "latestHeight": 119
  },
  "meta": { "finality": "FINALIZED" }
}
```

---

## 3. Incident Response & Troubleshooting

### 3.1 Database Locked (`SQLITE_BUSY`)
- **Symptoms**: Writes timeout with `SQLITE_BUSY: database is locked`.
- **Mitigation**:
  1. Confirm `PRAGMA busy_timeout = 5000;` is configured (handled automatically by `DatabaseManager`).
  2. Verify no rogue or zombie process is holding a lock on `pdschain.sqlite`. Check `validator.pid`.
  3. Ensure multiple validator processes are NOT pointing to the same SQLite file. Each validator node must run in its dedicated directory (`database/validators/<VAL_ID>/`).

### 3.2 Corrupted Journal Line Detected
- **Symptoms**: Warning in logs from `JournalStorageManager`: `Quarantined corrupted line to <path>.corrupt`.
- **Mitigation**:
  1. Inspect `<journal>.corrupt` for malformed JSON or truncated line.
  2. Run `verifyJournalHashChain()` to verify the cryptographic SHA-256 chain of subsequent records.
  3. Replay valid events into relational tables using `replayEventsToDatabase()`.

### 3.3 Pool Exhaustion
- **Symptoms**: API requests return `DatabasePoolError: Database connection pool exhausted`.
- **Mitigation**:
  1. Inspect `GET /api/v1/database/metrics` for `pds_database_connections_active`.
  2. Increase `DB_POOL_MAX` in environment variables if traffic demands warrant it.
  3. Check for slow un-indexed queries or hanging database transactions.

