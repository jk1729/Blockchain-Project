# Phase 18: Database Migration Guide

**Project**: PDSChain — Blockchain-Based Public Distribution System  
**Phase**: Phase 18 — Production Database Architecture  
**Document**: Migration Management Guide  
**Date**: September 17, 2026  
**Status**: APPROVED  

---

## 1. Migration Architecture & Safe Execution Rules

PDSChain uses a strict, version-controlled, auditable migration architecture enforced by `DatabaseMigrationManager`:

1. **Monotonic Versioning**: Every migration has an integer version ($1, 2, 3, \dots$) and a descriptive name (e.g., `001_initial_schema`, `002_add_receipts_table`).
2. **Deterministic Checksum Verification**: Every migration has a cryptographic SHA-256 checksum recorded in the `schema_migrations` table upon completion.
3. **Idempotency**: Running migrations multiple times is safe; already-applied versions are automatically skipped.
4. **Concurrency Guard**: Migration locks prevent race conditions when multiple node processes start concurrently.
5. **Dry-Run Validation**: Migrations can be evaluated in dry-run mode before applying changes to live storage.

---

## 2. Inspecting Schema Status

Check current schema version and migration history via API:
```bash
curl -s -H "Authorization: Bearer <TOKEN>" http://localhost:3000/api/v1/database/schema
```
Example response:
```json
{
  "success": true,
  "data": {
    "appliedCount": 1,
    "currentVersion": 1,
    "migrations": [
      {
        "version": 1,
        "name": "001_initial_schema",
        "checksum": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        "executionTimeMs": 42,
        "appliedBy": "SYSTEM",
        "appliedAt": "2026-09-17T23:45:00.000Z"
      }
    ]
  },
  "meta": { "finality": "FINALIZED" }
}
```

---

## 3. Applying Migrations

### Dry-Run Mode
```bash
curl -s -X POST \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"dryRun": true}' \
  http://localhost:3000/api/v1/database/migrate
```

### Live Execution
```bash
curl -s -X POST \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"dryRun": false}' \
  http://localhost:3000/api/v1/database/migrate
```

