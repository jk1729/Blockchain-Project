# Phase 18: Database Security & Access Control

**Project**: PDSChain — Blockchain-Based Public Distribution System  
**Phase**: Phase 18 — Production Database Architecture  
**Document**: Database Security & Permissions Guide  
**Date**: September 17, 2026  
**Status**: APPROVED  

---

## 1. Zero-Trust Access & Least Privilege

Direct SQL access to PDSChain databases is strictly restricted to the internal application engine. All external interactions occur via authenticated REST and JSON-RPC APIs protected by Phase 17 granular permissions:

| Endpoint | Method | Required Permission | Allowed Roles | Description |
| :--- | :--- | :--- | :--- | :--- |
| `/health/database` | `GET` | *(Public)* | Anyone | Lightweight connectivity & WAL probe |
| `/api/v1/database/status` | `GET` | `operator:read:node-status` | `NODE_OPERATOR`, `VALIDATOR_OPERATOR`, `ADMIN`, `SUPER_ADMIN` | Diagnostic pool & storage status |
| `/api/v1/database/schema` | `GET` | `operator:read:node-status` | `NODE_OPERATOR`, `VALIDATOR_OPERATOR`, `ADMIN`, `SUPER_ADMIN` | Migration history & schema versions |
| `/api/v1/database/migrate` | `POST` | `operator:manage:configuration` | `NODE_OPERATOR`, `CONSORTIUM_OPERATOR`, `SUPER_ADMIN` | Execute pending migrations |
| `/api/v1/database/backup` | `POST` | `operator:trigger:backup` | `NODE_OPERATOR`, `RECOVERY_OPERATOR`, `ADMIN`, `SUPER_ADMIN` | Create atomic verified backup |
| `/api/v1/database/verify-integrity`| `POST` | `recovery:verify:checkpoint` | `RECOVERY_OPERATOR`, `AUDITOR`, `SUPER_ADMIN` | Verify ledger Merkle roots and continuity |
| `/api/v1/database/metrics` | `GET` | *(Public)* | Anyone | Prometheus database metrics |

---

## 2. Invariants & Data Protection

1. **No Raw SQL Execution**: Untrusted clients and API consumers cannot submit raw SQL queries.
2. **Credential Redaction**: Diagnostics endpoints and logs never output passwords, connection strings with credentials, or private keys.
3. **Database-Level Immutability**:
   - `Block` model lifecycle hooks (`beforeUpdate`, `beforeDestroy`) block modifications to `FINALIZED` blocks.
   - `Receipt` model hooks reject updates and deletions.
   - `Transaction` model hooks prevent mutating `Verified` transactions.
   - `DatabaseAuditRecord` model hooks enforce immutable audit logs.
4. **Encryption at Rest**:
   - Validator keystores use AES-256-GCM.
   - Backups support AES-256-GCM encryption with PBKDF2 key derivation and detached authentication tags.

