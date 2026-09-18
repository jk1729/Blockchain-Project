# Phase 17: Security Configuration Manual

**Project**: PDSChain — Blockchain-Based Public Distribution System  
**Phase**: Phase 17 — Security Hardening, Permissions, and Authorization  
**Date**: September 17, 2026  
**Status**: REFERENCE MANUAL  

---

## 1. Environment Security Settings

| Variable Name | Default Value | Recommended Production Value | Description |
| :--- | :--- | :--- | :--- |
| `NODE_ENV` | `development` | `production` | Enables production security guards and suppresses stack traces in error envelopes. |
| `PORT` | `5000` | `5000` | HTTP API and JSON-RPC listener port. |
| `JWT_SECRET` | `dev_secret_key` | `[64+ byte cryptographically random hex]` | HMAC-SHA256 secret for client session tokens. |
| `CORS_ORIGIN` | `*` | `https://explorer.pdschain.gov.in` | Strict domain allowlist for Cross-Origin Resource Sharing. |
| `SECURITY_AUDIT_FILE` | `database/security_audit.jsonl` | `/var/log/pdschain/security_audit.jsonl` | Append-only path for tamper-evident security audit log. |
| `KEYSTORE_PASSPHRASE` | *(prompted)* | *(injected via KMS or HSM)* | Master passphrase deriving AES-256-GCM keystore wrapping keys. |
| `USE_TLS` | `true` | `true` | Enforces mutual TLS (mTLS) for all inter-validator communications. |

---

## 2. HTTP Security Headers Configuration

All edge API responses automatically include the following hardened headers configured in `backend/src/app.js`:

```http
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
X-XSS-Protection: 1; mode=block
Referrer-Policy: strict-origin-when-cross-origin
Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'self'
Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()
Cache-Control: no-store, no-cache, must-revalidate, private
Pragma: no-cache
```

---

## 3. Cryptographic Storage & Key Zeroization

- **Keystore Format**: Encrypted JSON containing version, salt, IV, ciphertext, and GCM authentication tag.
- **Key Derivation**: PBKDF2 with SHA-512, 100,000 iterations.
- **Cipher**: AES-256-GCM with 12-byte random IV and 16-byte authentication tag.
- **In-Memory Zeroization**: Secret buffers are scrubbed immediately after cryptographic signing or key loading:
  ```javascript
  privateKeyBuffer.fill(0);
  passphraseBuffer.fill(0);
  ```

---

## 4. Audit Log Integrity & Retention

- **Journal Path**: `database/security_audit.jsonl`.
- **Integrity Guarantee**: Every record incorporates the SHA-256 digest of the preceding record:
  $$\text{entryHash}_i = \text{SHA256}(\text{entryHash}_{i-1} \parallel \text{JSON}(\text{payload}_i))$$
- **Verification Endpoint**:
  `GET /api/v1/security/audit/verify` returns `{ valid: true, count: N }` or pinpoints the exact line index if a record was altered or truncated.
- **Metrics Telemetry**:
  `GET /api/v1/security/metrics` exposes live Prometheus counters for SOC / Grafana monitoring.

