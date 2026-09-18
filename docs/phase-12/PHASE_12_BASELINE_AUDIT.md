# PDSChain Phase 12: Security & Transport Baseline Audit

## 1. Executive Summary

This document records the transport security and cryptographic key management audit of the PDSChain repository at the initiation of **Phase 12: TLS/mTLS and Validator Key Management**.
Phase 11 concluded with **525 / 525 passing tests** (505 backend + 20 Hardhat smart contracts), validating deployable validator nodes with isolated storage layouts, PID file locking, granular health probes, and automated disaster recovery.

Phase 12 introduces production-grade encrypted validator transport via **Mutual TLS (mTLS)** and establishes a formal **Validator Key Management Infrastructure**, while preserving 100% backward compatibility and zero regressions across all prior consensus and networking guarantees.

---

## 2. Current Transport & Identity Baseline (Pre-Phase 12)

| Subsystem | Existing Implementation | Production Security Gap | Phase 12 Target |
| :--- | :--- | :--- | :--- |
| **Transport Layer** | `TLSTransport.js` supports optional TLS but defaults to self-signed dev certs with `rejectUnauthorized: false`. | No peer certificate verification; traffic vulnerable to Man-in-the-Middle (MITM) if unpinned. | Strict mTLS with client certificate request, CA pinning, and `rejectUnauthorized: true`. |
| **Identity Model** | `PeerAuthenticator.js` performs Ed25519 challenge-response authentication. | Transport-level connection is decoupled from application identity; a compromised TLS cert could impersonate. | Cryptographic Identity Binding: TLS X.509 CN/SAN bound to Ed25519 validator identity. |
| **Consensus Signing** | Ed25519 keys generated via `IdentityProvisioner.js` and loaded into memory. | No formal consensus key rotation or historical key registry for retiring keys. | `KeyRotationManager.js` with staged rotation and historical signature verification retention. |
| **Certificate Lifecycle**| Static RSA 2048-bit dev certificate embedded in code. | No certificate expiry monitoring, renewal, or atomic reload without dropping node. | `CertificateManager.js` with X.509 parsing, expiry thresholds (30d, 14d, 7d, 24h), and reload. |
| **Peer Authorization** | Whitelist set in `NetworkConfig.authorizedValidators`. | No explicit peer revocation list (CRL) or temporary peer suspension mechanism. | `PeerAuthorizationRegistry.js` supporting active, revoked, and suspended peer states. |
| **Key Storage** | Stored in `database/validators/{id}/identity.json` with `0600` permissions. | Lack of unified abstraction for transport vs. consensus keys with secret redaction. | `KeyStore.js` managing separate transport and consensus credentials with zero secret leakage. |

---

## 3. Cryptographic Separation Axiom

Phase 12 establishes a strict distinction between three tiers of cryptographic credentials:

1. **Validator Consensus Identity (Ed25519)**:
   - Purpose: Signing block proposals, votes, quorum certificates, and application-level challenge nonces.
   - Lifetime: Long-term institutional identity.
   - Storage: `identity.json` (mode `0600`).
2. **Transport Identity (X.509 / RSA 2048+ or ECDSA P-256)**:
   - Purpose: TLS/mTLS socket encryption, peer authentication, and channel integrity.
   - Lifetime: Short-to-medium term (e.g. 90 to 365 days), renewed periodically.
   - Storage: Dedicated `tls/validator.crt` and `tls/validator.key` (mode `0600`).
3. **Operator Identity (PKI Root CA)**:
   - Purpose: Signing and issuing authorized validator transport certificates and managing the peer authorization registry.
   - Lifetime: Long-term root trust anchor.
   - Storage: Managed offline or via consortium PKI (`tls/ca.crt`).

---

## 4. Verification Baseline

- **Current Backend Test Suites**: 39 suites, 505 passing tests.
- **Current Smart Contract Suites**: 1 suite, 20 passing tests.
- **Total Passing Baseline**: 525 / 525 tests (100% green).
- **Regression Constraint**: All 525 tests must continue to pass throughout Phase 12.

