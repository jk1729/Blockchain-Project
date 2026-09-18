# Phase 18: Database Schema & Data Model Specification

**Project**: PDSChain — Blockchain-Based Public Distribution System  
**Phase**: Phase 18 — Production Database Architecture  
**Stage**: Stage C — Schema and Data Model Design  
**Date**: September 17, 2026  
**Status**: COMPLETE  

---

## 1. Design Conventions & Data Typing Rules

1. **Explicit Primary Keys**: Every table uses an explicit, unambiguous primary key (`id` INTEGER AUTOINCREMENT or canonical UUID/string hash).
2. **Numeric Precision**:
   - Quantities and balances use `BIGINT` (in smallest atomic unit, e.g., milligrams/wei) or `DECIMAL(18, 4)`. Floating-point storage (`FLOAT`, `DOUBLE`) is prohibited for ledger values.
   - Heights, nonces, rounds, and counts use unsigned `BIGINT` or `INTEGER`.
3. **Hexadecimal String Limits**:
   - Hashes (`blockHash`, `txHash`, `merkleRoot`, `stateRoot`, `receiptsRoot`): `VARCHAR(66)` with regex constraint `^0x[0-9a-fA-F]{64}$` or `^[0-9a-fA-F]{64}$`.
   - Addresses: `VARCHAR(42)` (EVM) or `VARCHAR(64)` (PDS1).
4. **Time Representation**: All timestamps are formatted as ISO-8601 UTC strings (`YYYY-MM-DDTHH:mm:ss.sssZ`) or UNIX epoch milliseconds in `BIGINT`.
5. **Secret Segregation**: No table contains private keys, keystore passphrases, raw tokens, or seed phrases.

---

## 2. Table Schemas

### 2.1 `blocks` (Authoritative Block Records)
```sql
CREATE TABLE IF NOT EXISTS blocks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  version INTEGER NOT NULL DEFAULT 1,
  blockNumber BIGINT NOT NULL UNIQUE,
  blockHash VARCHAR(66) NOT NULL UNIQUE,
  previousHash VARCHAR(66) NOT NULL,
  timestamp VARCHAR(32) NOT NULL,
  transactions JSON NOT NULL DEFAULT '[]',
  txCount INTEGER NOT NULL DEFAULT 0,
  nonce BIGINT NOT NULL DEFAULT 0,
  merkleRoot VARCHAR(66) NOT NULL,
  stateRoot VARCHAR(66) NULL,
  receiptsRoot VARCHAR(66) NULL,
  proposerId VARCHAR(32) NOT NULL,
  proposerAddress VARCHAR(64) NULL,
  proposerSignature TEXT NULL,
  proposalId VARCHAR(66) NULL,
  round INTEGER NOT NULL DEFAULT 0,
  consensusStatus VARCHAR(20) NOT NULL DEFAULT 'FINALIZED',
  consensusCertificate JSON NULL,
  validatorSignatures JSON NOT NULL DEFAULT '[]',
  createdAt DATETIME NOT NULL,
  updatedAt DATETIME NOT NULL
);

CREATE INDEX idx_blocks_blockNumber ON blocks(blockNumber);
CREATE INDEX idx_blocks_blockHash ON blocks(blockHash);
CREATE INDEX idx_blocks_proposerId ON blocks(proposerId);
CREATE INDEX idx_blocks_timestamp ON blocks(timestamp);
CREATE INDEX idx_blocks_status ON blocks(consensusStatus);
```

### 2.2 `receipts` (Authoritative Execution Receipts)
```sql
CREATE TABLE IF NOT EXISTS receipts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transactionHash VARCHAR(66) NOT NULL UNIQUE,
  transactionId VARCHAR(64) NOT NULL,
  blockNumber BIGINT NOT NULL,
  blockHash VARCHAR(66) NOT NULL,
  transactionIndex INTEGER NOT NULL,
  contractAddress VARCHAR(42) NULL,
  status VARCHAR(20) NOT NULL, -- 'SUCCESS', 'REVERTED', 'FAILED'
  gasUsed BIGINT NOT NULL DEFAULT 0,
  cumulativeGasUsed BIGINT NOT NULL DEFAULT 0,
  logs JSON NOT NULL DEFAULT '[]',
  logsBloom VARCHAR(514) NULL,
  receiptHash VARCHAR(66) NOT NULL,
  revertReason TEXT NULL,
  createdAt DATETIME NOT NULL,
  updatedAt DATETIME NOT NULL,
  FOREIGN KEY (blockNumber) REFERENCES blocks(blockNumber) ON DELETE RESTRICT
);

CREATE INDEX idx_receipts_txHash ON receipts(transactionHash);
CREATE INDEX idx_receipts_blockNumber ON receipts(blockNumber);
CREATE INDEX idx_receipts_contractAddress ON receipts(contractAddress);
```

### 2.3 `transactions` (Indexed Transaction Ledger)
```sql
CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transactionId VARCHAR(64) NOT NULL UNIQUE,
  hash VARCHAR(66) NULL,
  beneficiaryId VARCHAR(64) NOT NULL,
  beneficiaryName VARCHAR(128) NULL,
  shopId VARCHAR(64) NOT NULL,
  commodity VARCHAR(64) NOT NULL,
  quantity DECIMAL(18, 4) NOT NULL,
  unit VARCHAR(16) NOT NULL DEFAULT 'KG',
  blockNumber BIGINT NULL,
  blockHash VARCHAR(66) NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'Pending', -- 'Pending', 'Verified', 'Rejected'
  fbaValidators INTEGER NOT NULL DEFAULT 12,
  fbaConsensus BOOLEAN NOT NULL DEFAULT 1,
  timestamp VARCHAR(32) NOT NULL,
  remarks TEXT NULL,
  createdAt DATETIME NOT NULL,
  updatedAt DATETIME NOT NULL
);

CREATE INDEX idx_tx_beneficiary_created ON transactions(beneficiaryId, createdAt);
CREATE INDEX idx_tx_shop_created ON transactions(shopId, createdAt);
CREATE INDEX idx_tx_blockNumber ON transactions(blockNumber);
CREATE INDEX idx_tx_hash ON transactions(hash);
CREATE INDEX idx_tx_status ON transactions(status);
```

### 2.4 `event_records` (Derived Query Event Log)
```sql
CREATE TABLE IF NOT EXISTS event_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  eventId VARCHAR(64) NOT NULL UNIQUE,
  eventType VARCHAR(64) NOT NULL,
  category VARCHAR(32) NOT NULL,
  severity VARCHAR(16) NOT NULL DEFAULT 'INFO',
  finalityStatus VARCHAR(20) NOT NULL DEFAULT 'FINALIZED',
  blockNumber BIGINT NULL,
  blockHash VARCHAR(66) NULL,
  transactionHash VARCHAR(66) NULL,
  deduplicationKey VARCHAR(128) NOT NULL UNIQUE,
  payload JSON NOT NULL,
  timestamp VARCHAR(32) NOT NULL,
  createdAt DATETIME NOT NULL
);

CREATE INDEX idx_events_type ON event_records(eventType);
CREATE INDEX idx_events_category ON event_records(category);
CREATE INDEX idx_events_blockNumber ON event_records(blockNumber);
CREATE INDEX idx_events_txHash ON event_records(transactionHash);
CREATE INDEX idx_events_timestamp ON event_records(timestamp);
```

### 2.5 `checkpoint_records` (Cryptographic State Checkpoints)
```sql
CREATE TABLE IF NOT EXISTS checkpoint_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  checkpointHeight BIGINT NOT NULL UNIQUE,
  checkpointHash VARCHAR(66) NOT NULL,
  blockHash VARCHAR(66) NOT NULL,
  stateRoot VARCHAR(66) NOT NULL,
  certificateHash VARCHAR(66) NOT NULL,
  approvingValidators JSON NOT NULL DEFAULT '[]',
  validatorCount INTEGER NOT NULL DEFAULT 12,
  isCommitted BOOLEAN NOT NULL DEFAULT 1,
  createdAt DATETIME NOT NULL
);

CREATE INDEX idx_checkpoints_height ON checkpoint_records(checkpointHeight);
```

### 2.6 `schema_migrations` (Versioned Migration Registry)
```sql
CREATE TABLE IF NOT EXISTS schema_migrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  version INTEGER NOT NULL UNIQUE,
  name VARCHAR(128) NOT NULL,
  checksum VARCHAR(64) NOT NULL,
  executionTimeMs INTEGER NOT NULL,
  appliedBy VARCHAR(64) NOT NULL DEFAULT 'SYSTEM',
  appliedAt DATETIME NOT NULL
);
```

### 2.7 `database_audit_records` (Relational Forensic Security Log)
```sql
CREATE TABLE IF NOT EXISTS database_audit_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sequence BIGINT NOT NULL UNIQUE,
  eventType VARCHAR(64) NOT NULL,
  actorId VARCHAR(64) NULL,
  actorRole VARCHAR(32) NULL,
  action VARCHAR(64) NOT NULL,
  targetEntity VARCHAR(64) NULL,
  status VARCHAR(16) NOT NULL, -- 'ALLOWED', 'DENIED', 'ERROR'
  details JSON NOT NULL,
  previousEntryHash VARCHAR(64) NOT NULL,
  entryHash VARCHAR(64) NOT NULL UNIQUE,
  timestamp VARCHAR(32) NOT NULL,
  createdAt DATETIME NOT NULL
);

CREATE INDEX idx_audit_eventType ON database_audit_records(eventType);
CREATE INDEX idx_audit_actor ON database_audit_records(actorId);
CREATE INDEX idx_audit_status ON database_audit_records(status);
```

