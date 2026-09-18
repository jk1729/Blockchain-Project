# PDSChain Phase 11: Storage Layout & Disaster Recovery Guide

## 1. Storage Isolation Architecture

Each validator daemon maintains a completely isolated storage hierarchy managed by `StorageLayout` (`backend/src/storage/StorageLayout.js`):

```
<DATA_DIR>/
├── database/
│   ├── pdschain.sqlite          # Primary SQLite relational store (WAL mode)
│   ├── pdschain.sqlite-wal      # Write-Ahead Log
│   └── pdschain.sqlite-shm      # Shared memory index
├── journal/
│   ├── consensus_journal.jsonl  # Append-only consensus write-ahead log
│   └── *.corrupt.*              # Quarantined malformed journal records
├── checkpoints/
│   ├── checkpoint.json          # Canonical disk checkpoint snapshot
│   └── checkpoint.json.tmp      # Staged atomic write buffer
├── evm/                         # State trie cache & receipts
├── logs/                        # Node execution logs
├── backups/                     # Atomic snapshot archives
├── tmp/                         # Synchronization buffers
├── identity.json                # Protected Ed25519 keypair (0600 mode)
└── validator.pid                # Active process locking file
```

---

## 2. Directory Traversal & Multi-Instance Guards

### Path Traversal Prevention
`storageLayout.isPathContained(path)` enforces that all database, journal, checkpoint, and temporary paths reside strictly within the validator's assigned data root. Attempts to mount paths outside the root throw `SecurityError`.

### Single-Instance PID Locking
Before starting consensus or network listeners, the daemon executes:
```javascript
storageLayout.acquirePidLock();
```
- If an existing `validator.pid` exists and references a live OS process, the startup sequence immediately aborts with `StorageLockError (DUPLICATE_INSTANCE)`.
- If the PID is stale (dead process from previous ungraceful abort), the lockfile is cleanly reclaimed.

---

## 3. Disaster Recovery & Automated Backups

Backups are orchestrated via `BackupManager` (`backend/src/storage/BackupManager.js`).

### Backup Creation
```javascript
const { backupPath, manifest } = BackupManager.createBackup({
  storageLayout,
  blockHeight: currentHeight,
  blockHash: latestHash,
  networkId: 'pdschain-mainnet',
  chainId: 1729
});
```

### Invariants & Guarantees:
1. **Private Key Exclusion**: Automated backups strictly prohibit including `identity.json`. If an identity file is found in the backup staging area, `BackupManager` throws `PRIVATE_KEY_LEAK` and wipes the staging buffer.
2. **SHA-256 Manifest**: Every backed-up file (`pdschain.sqlite`, `consensus_journal.jsonl`, `checkpoint.json`) is checksummed with SHA-256 and registered in `manifest.json`.
3. **Integrity Verification**: `BackupManager.verifyBackup(backupDir)` recalculates all file digests against the manifest before allowing restoration.

### Restoring from Backup
```javascript
BackupManager.restoreBackup(backupDir, targetStorageLayout, {
  expectedNetworkId: 'pdschain-mainnet',
  expectedChainId: 1729,
  allowRollback: false // Rejects accidental rollback of finalized heights
});
```
- **Staging Area**: Files are unpacked into `tmp/restore-staging-<timestamp>` and validated before replacing live database files.
- **Cross-Chain Protection**: Prevents restoring backups across different network IDs or chain IDs.

