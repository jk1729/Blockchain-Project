# Phase 17: Security Incident Response Runbook

**Project**: PDSChain — Blockchain-Based Public Distribution System  
**Phase**: Phase 17 — Security Hardening, Permissions, and Authorization  
**Date**: September 17, 2026  
**Status**: ACTIVE OPERATIONAL RUNBOOK  

---

## 1. Overview & Response Severity Levels

This runbook defines operational procedures for detecting, containing, mitigating, and recovering from security incidents within the PDSChain federated consortium network.

| Severity | Definition | Target SLA | Notifications |
| :--- | :--- | :--- | :--- |
| **SEV-1 (Critical)** | Active consensus private key compromise, CA compromise, or consortium network partition. | Immediate (< 15 min) | All Consortium Operators, Security Leads |
| **SEV-2 (High)** | Node TLS certificate compromise, administrative credential leak, or repeated IDOR bypass attempts. | < 1 hour | Affected Validator Operator, Security Team |
| **SEV-3 (Moderate)** | API key leak, high rate-limit violations, non-critical process halt. | < 4 hours | Platform Administrator |
| **SEV-4 (Low)** | Informational security event, routine certificate rotation, minor log anomaly. | Next Business Day | Internal Security Audit Log |

---

## 2. Playbook 1: Validator Consensus Key Compromise (SEV-1)

### Symptoms
- Unauthorized block proposal or double-vote observed with a validator's Ed25519 signature.
- Accidental exposure of encrypted keystore file and passphrase.

### Execution Procedure
1. **Immediate Revocation**:
   - Security Operator invokes `POST /api/v1/security/peers/:validatorId/revoke` to immediately block the compromised peer from all network communication.
2. **Quorum Assessment**:
   - Assess active validator count. FBA requires 9 of 12 agreeing nodes. With 1 validator suspended (11 remaining), quorum remains healthy.
3. **Emergency Key Rotation**:
   - Generate new Ed25519 keypair in an isolated, secure environment.
   - Invoke `POST /api/v1/security/keys/stage` with activation height $H = \text{CurrentHeight} + 5$.
   - Broadcast signed key rotation announcement across honest peers.
4. **Historical Audit**:
   - Inspect blocks and audit log (`GET /api/v1/security/audit?actorId=VAL-XX`) to identify any signed malicious candidates.
   - If candidate was not certified by 9 honest nodes, discard candidate state.

---

## 3. Playbook 2: Node TLS Certificate Compromise (SEV-2)

### Symptoms
- TLS private key found in public repository or unencrypted backup.
- Unrecognized client connecting via mTLS with valid consortium certificate.

### Execution Procedure
1. **CRL Fingerprint Addition**:
   - Compute SHA-256 fingerprint of compromised certificate.
   - Invoke `POST /api/v1/security/certificates/revoke` with fingerprint and reason `KEY_COMPROMISE`.
   - `PeerAuthorizationRegistry` automatically rejects all mTLS handshakes matching the fingerprint.
2. **Issue New Node Certificate**:
   - Re-issue certificate from Consortium CA.
   - Deploy new certificate and key to validator host.
   - Invoke `POST /api/v1/security/certificates/reload` to trigger zero-downtime hot-reload.
3. **Verify Connection**:
   - Check `GET /api/v1/network/peers` and `GET /api/v1/security/metrics` to confirm clean connection under new fingerprint.

---

## 4. Playbook 3: API Key or Administrative Token Leak (SEV-3)

### Symptoms
- API key observed in client-side code, external logs, or unauthorized IP addresses making calls.

### Execution Procedure
1. **Immediate Revocation**:
   - Invoke `DELETE /api/v1/security/api-keys/:keyId` with reason `Compromised credentials`.
2. **Issue Replacement**:
   - Invoke `POST /api/v1/security/api-keys` with same role and entityId scope.
   - Securely communicate new secret to authorized integrator.
3. **Audit Log Inspection**:
   - Run `GET /api/v1/security/audit?actorId=apikey_xxx` to review all transactions and queries executed during the window of exposure.

---

## 5. Playbook 4: Emergency Break-Glass Activation

### Purpose
Temporary escalation of operator privileges during an active disaster recovery incident when routine consensus or administrative controls are blocked.

### Rules & Restrictions
- Maximum duration: 24 hours (default: 1 hour).
- Mandatory documented justification reason.
- Dual approval (must be activated by a Super Admin or System Admin).
- Every single action performed during Break-Glass is logged with flag `isBreakGlass: true` and incremented in Prometheus metrics.

### Step-by-Step Procedure
1. **Activation**:
   ```bash
   POST /api/v1/security/break-glass/activate
   Headers: Authorization: Bearer <SuperAdminToken>
   Body:
   {
     "operatorId": "op_alice",
     "reason": "Consensus stall on node crash; repairing non-finalized journal state",
     "durationSeconds": 1800
   }
   ```
2. **Execution**:
   - Operator `op_alice` executes emergency recovery actions (`recovery:halt:validator`, `recovery:repair:derived-state`).
3. **Deactivation**:
   ```bash
   POST /api/v1/security/break-glass/revoke
   Headers: Authorization: Bearer <SuperAdminToken>
   Body:
   {
     "operatorId": "op_alice",
     "reason": "Node successfully resumed and synchronized"
   }
   ```
4. **Post-Mortem Verification**:
   - Export audit log: `GET /api/v1/security/audit/export`.
   - Verify cryptographic hash chain integrity: `GET /api/v1/security/audit/verify`.

