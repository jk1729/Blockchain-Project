# PDSChain — Security Architecture, Threat Model & Controls

## 1. Threat Model

PDSChain defends against five primary threat actors in a public ration distribution system:
1. **Malicious Fair Price Shop (FPS) Operators**: Attempting to record phantom distributions, exceed citizen monthly quotas, or disburse stock not physically present in inventory.
2. **Malicious Warehouse Managers**: Attempting negative inventory transfers, duplicate dispatches, or unrecorded stock deductions.
3. **Unauthenticated / Unauthorized External Users**: Attempting privilege escalation (e.g., self-registering as `ADMIN`), cross-citizen record access, or unauthenticated ledger mutations.
4. **Database / Ledger Tampering Insiders**: Attempting direct modification of historical SQLite/PostgreSQL transaction or block rows after commitment.
5. **Byzantine / Offline Consortium Validators**: Up to $f = 3$ out of 12 validators going offline, delaying votes, or submitting forged signatures.

---

## 2. Authentication, Password Hashing & Session Security

- **Password Storage**: Passwords are hashed using `bcryptjs` (10–12 salt rounds). Plaintext passwords are never stored or logged.
- **JWT Authentication**: Stateless JSON Web Tokens (`HS256`) signed with `JWT_SECRET`.
- **Production Configuration Guard (`backend/src/config/env.js`)**:
  - In `NODE_ENV=production`, startup immediately aborts if `JWT_SECRET` is unset, matches the development default, or is shorter than 32 characters.
  - Wildcard `CORS_ORIGIN=*` is strictly rejected in `NODE_ENV=production`.
- **Privilege Escalation Prevention (`AuthController` & `AuthService`)**:
  - Public registration (`POST /api/auth/register`) unconditionally sets `isAdminCreated = false` unless the caller holds a verified `ADMIN` JWT. Any attempt to pass `role: "ADMIN"`, `"VALIDATOR"`, `"SHOP"`, or `"WAREHOUSE"` without admin authorization is downgraded to `"CITIZEN"`.
- **Universal Frontend Route Guard & Logout (`frontend/js/main.js`)**:
  - `enforcePageAuth()` runs immediately on page load and on `pageshow` (defending against browser `bfcache` back navigation after logout).
  - `window.pdsLogout()` purges all `localStorage` and `sessionStorage` tokens and notifies `POST /api/auth/logout`.

---

## 3. Role-Based Access Control (RBAC) & Zero-Trust Permissions

Every mutating API route is protected by `authMiddleware` and fine-grained permission checks (`backend/src/security/permissions/`):
- `ADMIN`: Beneficiary CRUD, shop/warehouse registration, validator status simulation, system audit inspection.
- `WAREHOUSE`: Stock transfer initiation (`POST /api/warehouses/transfers`).
- `SHOP` / `ADMIN`: Ration distribution (`POST /api/transactions`).
- `VALIDATOR` (`V1..V12` / `VAL-01..VAL-12`): Authenticated consensus voting (`POST /api/consensus/proposals/:id/vote`). Strict identity binding enforces that a validator logged in as `V1` (`VAL-01`) cannot cast a vote on behalf of `V2` (`403 VALIDATOR_IDENTITY_MISMATCH`), non-validators cannot vote (`403 FORBIDDEN_ROLE`), duplicate votes are rejected (`409 DUPLICATE_VOTE`), conflicting votes are flagged as equivocation (`409 CONFLICTING_VOTE`), and forged Ed25519 signatures are rejected (`400 INVALID_VOTE_SIGNATURE`).
- `CITIZEN`: Read-only access to personal entitlement and public transaction verification.
- All authorization decisions (`ALLOW` / `DENY`) are recorded in the tamper-evident security audit journal (`database/security_audit.jsonl`).

---

## 4. On-Chain Privacy & PII Protection

- **Zero Sensitive PII On-Chain**: Neither the native PDS blockchain nor the Solidity `PDSBeneficiaryRegistry` contract stores Aadhaar numbers, biometric templates, phone numbers, or residential addresses on-chain.
- On-chain transactions reference pseudonymous identifiers (`BEN-1024`, `FPS-102`, `WH-003`) and cryptographic hashes (`identityHash`).

---

## 5. Multi-Layer Secret Redaction (`backend/src/observability/`)

- The structured logger automatically redacts `password`, `passwordHash`, `privateKey`, `secret`, `token`, `authorization`, and PEM key blocks before emitting logs to stdout or files.
- Newline injection in log messages is escaped to prevent log forging.

