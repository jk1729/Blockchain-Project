# Phase 17: Security Baseline Audit

**Project**: PDSChain — Blockchain-Based Public Distribution System  
**Phase**: Phase 17 — Security Hardening, Permissions, and Authorization  
**Date**: September 17, 2026  
**Status**: AUDIT COMPLETED  

---

## 1. Executive Summary

This Security Baseline Audit systematically analyzes the PDSChain repository and its attack surfaces across all layers: REST APIs (legacy `/api` and `/api/v1`), JSON-RPC 2.0 (`/rpc` and `/rpc/v1`), Server-Sent Events (SSE), validator node daemons, peer-to-peer authenticated mTLS transport, cryptographic key storage, ledger persistence, Merkle proof subsystem, and frontend explorer interface.

The audit identified critical areas where implicit trust, missing granular authorization, and administrative shortcuts existed. This document defines the baseline state prior to Phase 17 hardening and specifies the precise remediation required.

---

## 2. Comprehensive Attack Surface Review

### 2.1 REST Route Handlers & Controllers
- **Legacy Routes (`/api/*`)**:
  - `roleMiddleware.js` previously contained a blanket bypass: `userRole !== 'ADMIN'`. This allowed any user with the `ADMIN` role to execute arbitrary operations even if not explicitly permitted for that action.
  - Endpoints such as `/api/blockchain/validate` and `/api/blockchain` were public without explicit rate-limiting tiers or classification.
  - Beneficiary, shop, and warehouse update routes checked role membership (`ADMIN` or `WAREHOUSE`) but lacked object-level ownership checks (e.g. verifying that a shop user only distributes rations or inspects inventory for their assigned `entityId`).
- **Versioned Routes (`/api/v1/*`)**:
  - Introduced in Phase 14 with canonical `{ data, meta, error }` envelopes and cursor pagination.
  - While rate limiting and idempotency headers were introduced, fine-grained permission identifiers (`resource:action:scope`) were not systematically bound to route middleware.

### 2.2 JSON-RPC 2.0 Methods
- `JsonRpcEngine.js` dispatched methods without verifying caller permissions against a canonical permission registry.
- Any client capable of sending HTTP POST to `/rpc` or `/rpc/v1` could invoke registered methods if parameters were syntactically valid.
- While `sanitizeSecrets()` was applied to JSON-RPC results, privileged `pds_*` methods lacked role and permission gating. Standard error code `-32005` (`UNAUTHORIZED`) must be enforced for unauthorized calls.

### 2.3 Real-Time SSE Streams & Event Subscriptions
- `/api/events/stream` and `/api/v1/events/stream` allowed arbitrary event subscriptions based on query filters (`category`, `eventType`, `validatorId`).
- Without permission enforcement, unauthenticated clients could subscribe to sensitive internal categories (`TLS`, `KEY_MANAGEMENT`, `SECURITY`, `AUDIT`, `RECOVERY`).
- Public streams must be restricted to public finalized events (`BLOCK`, `TRANSACTION`, `CONTRACT`) with `FINALIZED` status.

### 2.4 Validator Processes & P2P Networking
- In Phase 9, multi-process validator nodes were established with IPC and HTTP status ports.
- In Phase 12, mutual TLS (mTLS) with a consortium CA and Ed25519 identity bindings were established.
- `PeerAuthorizationRegistry.js` enforces strict peer whitelisting and CRL checks, but administrative operations on peers (revocation, suspension) must be gated by explicit operator permissions and logged to a tamper-evident security audit trail.

### 2.5 Keystore & Consensus Key Management
- `KeyStore.js` uses AES-256-GCM encryption with PBKDF2 key derivation.
- In-memory key destruction (`Buffer.fill(0)`) is implemented.
- `KeyRotationManager.js` supports height-based activation and historical public key resolution.
- However, the system lacked a hard distinction between system administration and key administration. Routine `ADMIN` accounts must never possess permissions to load or export raw private keys (`security:load:key`, `security:destroy:key-material`).

### 2.6 Merkle Proof Subsystem (Phase 16)
- Merkle proof generation and standalone verification correctly enforce bounds (depth ≤ 32, batch ≤ 50, 64-hex format, second-preimage attack resistance).
- The standalone verifier operates offline without database access.
- Proof generation APIs must be protected from resource exhaustion and restricted from generating proofs for unfinalized or restricted event categories unless authorized.

### 2.7 Explorer Frontend (Phase 15)
- The frontend explorer executes search queries, displays transaction and block cards, and visualizes Merkle proof trees.
- Security headers in `app.js` (`X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`) are active.
- Needed: `Content-Security-Policy` (CSP), `Permissions-Policy`, and strict `Cache-Control: no-store` on authenticated and sensitive API routes.
- Frontend controls must remain strictly presentational: all authorization must be verified server-side.

---

## 3. Vulnerability & Risk Matrix

| Risk ID | Category | Baseline Finding | Remediation in Phase 17 |
| :--- | :--- | :--- | :--- |
| **SEC-01** | Authorization | Blanket `ADMIN` bypass in `roleMiddleware.js` (`userRole !== 'ADMIN'`) | Replace with explicit `PermissionRegistry` and default-deny `AuthorizationService` |
| **SEC-02** | RPC Security | JSON-RPC engine does not check caller permissions | Implement RPC method permission map and enforce `-32005 UNAUTHORIZED` / `FORBIDDEN` |
| **SEC-03** | SSE Streaming | Unauthenticated subscribers could request internal/security event streams | Enforce category-level subscription authorization; public streams emit only finalized public events |
| **SEC-04** | IDOR / BOLA | Shop and citizen endpoints trusted client route params without verifying user `entityId` ownership | Implement object-level ownership validation in `permissionMiddleware.js` |
| **SEC-05** | Injection | Unbounded object properties and prototype pollution potential in request bodies | Add prototype pollution sanitizer (`__proto__`, `constructor.prototype`) and nesting depth limits |
| **SEC-06** | Browser Security | Missing `Content-Security-Policy` (CSP) and `Permissions-Policy` in HTTP headers | Add comprehensive CSP, Permissions-Policy, and cache-control headers in `app.js` |
| **SEC-07** | Auditability | Security events lacked tamper-evident cryptographic verification and structured export | Implement `SecurityAuditLogger.js` with SHA-256 hash chaining and secret redaction |
| **SEC-08** | Metrics | Security metrics lacked Prometheus formatting for SOC/SIEM alerting | Implement `SecurityMetrics.js` exporting standard Prometheus metrics (`pds_security_*`) |
| **SEC-09** | Separation of Duties | No clear separation between routine administration and emergency break-glass procedures | Define explicit role matrix with `BREAK_GLASS_OPERATOR` requiring justification, expiry, and dual control |
| **SEC-10** | Cryptographic Safety | Risk of administrative overrides attempting to bypass consensus or ledger validation | Enforce strict invariant: authorization checks can never bypass block, signature, or Merkle verification |

---

## 4. Audit Conclusion

The PDSChain codebase has robust cryptographic foundations (FBA consensus, Ed25519 signatures, AES-256-GCM keystore, SHA-256 Merkle trees). However, the access control layer required transformation from ad-hoc role strings to a **centralized, zero-trust, default-deny authorization engine**. Phase 17 executes this hardening without regressing existing functionality.

