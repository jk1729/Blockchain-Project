# Phase 17: Security Architecture and Threat Model

**Project**: PDSChain — Blockchain-Based Public Distribution System  
**Phase**: Phase 17 — Security Hardening, Permissions, and Authorization  
**Date**: September 17, 2026  
**Status**: ARCHITECTURE APPROVED  

---

## 1. Threat Model & Actor Taxonomy

PDSChain operates in a federated consortium environment where actors have distinct privileges, responsibilities, and trust levels. The security architecture models the following threat actors and roles:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           Consortium Perimeter                          │
│                                                                         │
│  ┌───────────────────────┐         ┌─────────────────────────────────┐  │
│  │   Public Internet     │         │       Consortium Private Net    │  │
│  │  - Public Readers     │         │  - 12 FBA Validators (mTLS)     │  │
│  │  - Explorer Clients   │         │  - Node Operators               │  │
│  │  - External Auditors  │         │  - Security Operators           │  │
│  └───────────┬───────────┘         │  - Recovery Operators           │  │
│              │                     └────────────────┬────────────────┘  │
│              ▼                                      ▼                   │
│  ┌───────────────────────┐         ┌─────────────────────────────────┐  │
│  │  DMZ / Edge Gateway   │◄───────►│  Consensus & Core Storage       │  │
│  │  - REST APIs (v1)     │         │  - Append-Only Event Journal    │  │
│  │  - JSON-RPC 2.0       │         │  - Keystore (AES-256-GCM)       │  │
│  │  - SSE Event Stream   │         │  - Merkle Root Commitments      │  │
│  └───────────────────────┘         └─────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

### 1.1 Actor Definitions & Trust Levels
1. **Public Reader (`PUBLIC_READER`)**: Unauthenticated external actor querying finalized ledger state, blocks, transactions, receipts, and Merkle proofs. Zero write permissions.
2. **Authenticated Client (`CLIENT`, `CITIZEN`, `SHOP`, `WAREHOUSE`)**: Authenticated application user. Permissions are strictly scoped to their assigned `entityId`. Citizens can only query their own allocations and transactions; shops can only distribute rations from their assigned shop inventory.
3. **Validator Node (`VALIDATOR`)**: Core consensus participant with Ed25519 identity and mTLS certificate issued by Consortium CA. Authorized to exchange consensus proposals, votes, and certificates, and request/serve synchronization blocks.
4. **Node Operator (`VALIDATOR_OPERATOR`, `NODE_OPERATOR`)**: Manages daemon lifecycles, configuration reload, non-sensitive telemetry, and local process restarts.
5. **Security Operator (`SECURITY_OPERATOR`)**: Manages TLS certificate reload, key rotation staging, certificate revocation lists (CRL), and peer authorization. No access to mutate ledger data.
6. **Recovery Operator (`RECOVERY_OPERATOR`)**: Authorized to inspect checkpoints, replay journals, rebuild derived Merkle/proof indexes, and initiate ledger resynchronization. Cannot alter finalized blocks.
7. **System Administrator (`ADMIN`, `API_ADMIN`, `SYSTEM_ADMIN`)**: Manages users, roles, rate-limit policies, and PDS domain entities (beneficiaries, shops, warehouses). Never possesses raw private key export capabilities.
8. **Super Administrator (`SUPER_ADMIN`)**: Consortium governance actor for system policies. Subject to dual-control requirements for high-risk operations.
9. **Break-Glass Emergency Operator (`BREAK_GLASS_OPERATOR`)**: Highly audited, time-bounded role invoked strictly during critical incidents with mandatory logged justification and automated expiration.

---

## 2. Trust Boundaries

| Trust Boundary | Interacting Zones | Enforcement Mechanism | Failure Policy |
| :--- | :--- | :--- | :--- |
| **TB-1: Public API Gateway** | Public Internet ↔ Edge Services | TLS 1.2+, CSP, CORS, Rate Limiting, Input Sanitization | Reject (400/404/429), Fail-Closed |
| **TB-2: Authentication Boundary** | Edge Services ↔ Protected Controllers | JWT Signature Validation, Expire Check, Audience Verification | 401 Unauthorized |
| **TB-3: Authorization Boundary** | Authenticated User ↔ Resource Action | `AuthorizationService` (Default Deny, RoleMatrix, Scope Check) | 403 Forbidden / RPC -32005 |
| **TB-4: Inter-Validator Transport** | Validator A ↔ Validator B | Mutual TLS (mTLS), Consortium CA Pinning, Ed25519 Handshake | Disconnect / Reject Message |
| **TB-5: Keystore Isolation** | Core Runtime ↔ Cryptographic Keys | AES-256-GCM, PBKDF2, In-Memory Zeroization, Restricted File ACLs | Abort Startup / Fail-Closed |
| **TB-6: Ledger Immutability** | Operator / API ↔ Finalized Ledger | Cryptographic Hash Chaining, FBA 9/12 Quorum Verification | Reject Mutation Request |
| **TB-7: Derived vs Authoritative** | Explorer / Indexer ↔ Authoritative Ledger | Proof verification recomputes roots from cryptographic leaves | Verification Failure |

---

## 3. Protected Cryptographic Assets

1. **Consensus Private Keys**: Ed25519 keys utilized to sign block proposals, votes, and consensus certificates. Stored strictly in encrypted keystores. Zero API or RPC access.
2. **TLS Private Keys**: RSA/ECDSA private keys utilized for node-to-node mTLS. Loaded strictly at process initialization.
3. **Consortium CA Material**: Root certificate and signing keys utilized to issue node certificates. Isolated offline or within dedicated PKI services.
4. **Keystore Passphrases**: Used to derive AES-256-GCM wrapping keys. Held in memory only during key operations and zeroized immediately.
5. **Security Audit Log**: Append-only tamper-evident journal with SHA-256 hash chaining. Protected against tampering or truncation.
6. **JWT Secrets & API Keys**: Held securely in environment configuration; never echoed in responses, logs, or error traces.

---

## 4. Non-Negotiable Invariants

1. **Default Deny**: Every action without explicit affirmative permission evaluates to `DENY`.
2. **No Blanket Admin Bypass**: No role (including `ADMIN` or `SUPER_ADMIN`) possesses wildcard bypass permissions.
3. **Separation of Duties**: Operational, administrative, security, and consensus functions are partitioned into distinct roles.
4. **Finality Immutability**: No administrative or recovery permission can overwrite or delete finalized blocks.
5. **Zero Secret Leakage**: Private keys, passphrases, tokens, and keystore contents are strictly redacted from logs, metrics, errors, and responses.
6. **Fail-Closed Execution**: If any authorization check, certificate validation, or cryptographic signature check fails or errors out, execution immediately halts and denies access.

