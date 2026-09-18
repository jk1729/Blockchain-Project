# Phase 18: Database Backup, Restore, and Disaster Recovery

**Project**: PDSChain — Blockchain-Based Public Distribution System  
**Phase**: Phase 18 — Production Database Architecture  
**Document**: Backup and Restore Guide  
**Date**: September 17, 2026  
**Status**: APPROVED  

---

## 1. Backup Philosophy & Guarantees

1. **Zero Secret Contamination**: Backups strictly exclude private keys, keystore passphrases, and decrypted session tokens.
2. **Deterministic Cryptographic Manifest**: Every backup includes a detached `manifest.json` recording:
   - `backupId`
   - `blockHeight` and `blockHash`
   - `chainId` and `networkId`
   - `rawHash`: SHA-256 digest of the database payload
   - `isEncrypted`, `authTag`, and `iv` (when AES-256-GCM encryption is enabled)
3. **Rollback Protection**: Staged restoration verifies that a backup belongs to the correct chain and network, and verifies file hashes before replacing live files.

---

## 2. Creating a Backup

### 2.1 Standard Plaintext Snapshot
```bash
curl -s -X POST \
  -H "Authorization: Bearer <OPERATOR_TOKEN>" \
  -H "Content-Type: application/json" \
  http://localhost:3000/api/v1/database/backup
```

### 2.2 Encrypted Snapshot (AES-256-GCM)
```bash
curl -s -X POST \
  -H "Authorization: Bearer <OPERATOR_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"passphrase":"super-secure-offline-passphrase-2026"}' \
  http://localhost:3000/api/v1/database/backup
```

---

## 3. Disaster Recovery Restoration Procedure

When restoring a validator from backup:

1. **Verify Integrity**:
   - `DatabaseBackupManager.verifyBackup(backupDir)` checks the manifest and verifies that the file digests match.
2. **Chain & Network Matching**:
   - Restoration fails if `manifest.chainId !== currentChainId` or `manifest.networkId !== currentNetworkId`.
3. **Staged Extraction**:
   - The backup is extracted into an isolated staging directory (`targetDir/restored/`).
   - If encrypted, decrypted using the passphrase and verified against `rawHash`.
4. **Activation & Ledger Catch-up**:
   - The node starts up in recovery mode, initializes the database, verifies ledger continuity from height 0 to the restored height, and initiates range synchronization with peers to catch up any missing blocks since the backup was generated.

