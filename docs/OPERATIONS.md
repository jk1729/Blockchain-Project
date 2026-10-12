# PDSChain — Operations, Backups, Recovery & Monitoring Runbook

## 1. Database & Ledger Durability (`backend/src/database/`, `backend/src/storage/`)

- **SQLite WAL Mode**: In SQLite deployments, `DatabaseManager` configures `PRAGMA journal_mode = WAL;`, `PRAGMA synchronous = NORMAL;`, `PRAGMA foreign_keys = ON;`, and `PRAGMA busy_timeout = 5000;`.
- **Safe Schema Synchronization (`syncSafe`)**: `server.js` uses `defaultDatabaseManager.syncSafe({ alter: false })`. Destructive schema resets (`force: true`) are strictly blocked when `NODE_ENV=production`.
- **Startup Chain Integrity Verification**: On startup, `Blockchain.loadFromDatabase()` preserves persisted `merkleRoot` and `blockHash` values from database records and runs `validateChain()`. Any tampered block triggers a `[LEDGER INTEGRITY ALERT]` error log with the exact `brokenBlockIndex` and failure reason.

---

## 2. Backup & Snapshot Verification (`backend/src/storage/BackupManager.js`)

`BackupManager` creates verifiable snapshots of the database, event journals, and consensus checkpoints alongside a `manifest.json` containing SHA-256 file checksums.

### Creating a Verified Backup Programmatically / via CLI
```bash
cd backend
node -e "
const path = require('path');
const { StorageLayout } = require('./src/storage/StorageLayout');
const { BackupManager } = require('./src/storage/BackupManager');
const layout = new StorageLayout(path.resolve('../database'));
layout.ensureDirectories();
const mgr = new BackupManager(layout);
const res = mgr.createSnapshot('manual-backup');
console.log('Backup created:', res);
console.log('Verification:', mgr.verifySnapshot(res.backupPath));
"
```

### Restoring from a Snapshot
```bash
cd backend
node -e "
const path = require('path');
const { StorageLayout } = require('./src/storage/StorageLayout');
const { BackupManager } = require('./src/storage/BackupManager');
const layout = new StorageLayout(path.resolve('../database'));
const mgr = new BackupManager(layout);
// Replace with target snapshot directory path:
// mgr.restoreSnapshot('<path-to-snapshot>');
"
```

---

## 3. PostgreSQL Production Backup & Restore

```bash
# Backup
pg_dump -Fc -h 127.0.0.1 -U pdschain -d pdschain -f pdschain_$(date +%Y%m%d_%H%M%S).dump

# Restore
pg_restore -c -h 127.0.0.1 -U pdschain -d pdschain pdschain_backup.dump
```

---

## 4. Monitoring, Metrics & Alerting (`backend/src/observability/`)

- **Prometheus Metrics**: Scrape `http://localhost:3000/metrics` for HTTP request latencies, JSON-RPC counts, active SSE connections, block height, consensus round latency, and Node.js heap/event-loop lag.
- **Health & SLO Status**:
  - `GET /api/v1/observability/status` — Comprehensive SLO compliance, error budget burn rate, and active alert status.
- **Graceful Shutdown**: Sending `SIGINT` or `SIGTERM` to `src/server.js` marks readiness false, stops metric sampling, drains active HTTP connections, and closes database pools cleanly.

