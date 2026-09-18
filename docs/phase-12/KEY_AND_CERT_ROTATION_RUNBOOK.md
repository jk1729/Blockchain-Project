# PDSChain Phase 12: Key and Certificate Rotation Operational Runbook

## 1. Overview

This runbook outlines standard operating procedures (SOP) for:
1. **Planned Ed25519 Consensus Key Rotation** (Height-triggered epoch transition).
2. **Zero-Downtime TLS Transport Certificate Renewal** (Hot atomic reload).
3. **Emergency Key Compromise Procedure**.

---

## 2. Procedure A: Ed25519 Consensus Key Rotation

To rotate a validator's consensus signing key without triggering a chain reorganization or fork, PDSChain uses deterministic epoch/height-based key rotation managed by `KeyRotationManager`.

### Step 1: Generate Staged Keypair
Generate a new secure Ed25519 keypair for the validator:
```bash
node -e "const { generateKeyPair } = require('./src/blockchain/identity/keyManager'); console.log(generateKeyPair());"
```

### Step 2: Stage the Key in `KeyRotationManager`
Determine the planned activation block height (e.g. Current Height + 10,000 blocks):
```javascript
const activationHeight = currentBlockHeight + 10000;
keyRotationManager.stageKey(newKeyPair, activationHeight);
```

### Step 3: Broadcast Signed Rotation Announcement
Generate and gossip a cryptographic rotation announcement signed with the currently active key:
```javascript
const announcement = keyRotationManager.createRotationAnnouncement(currentBlockHeight);
// Broadcast announcement across consortium peers
```

### Step 4: Automatic Height Transition
When the blockchain reaches `activationHeight`:
1. `checkAndActivate(height)` promotes the staged key to active.
2. The previous key is archived in history: `history[0].endHeight = activationHeight - 1`.
3. Historical blocks and quorum certificates prior to `activationHeight` continue to be validated using `getPublicKeyForHeight(h)`.

---

## 3. Procedure B: Zero-Downtime TLS Certificate Renewal

Transport certificates must be rotated before expiration (e.g., every 60–90 days). The daemon does not need to be restarted.

### Step 1: Request New Certificate from Consortium CA
Submit a CSR to the Consortium CA signed with a fresh transport key.

### Step 2: Place New Files on Disk
Save the renewed certificate and private key in the validator's secure directory:
- `certs/val-XX.crt`
- `certs/val-XX.key`

### Step 3: Trigger Hot Reload via Admin API or CLI
Send a POST request to `/admin/tls/reload`:
```bash
curl -X POST http://127.0.0.1:4001/admin/tls/reload \
  -H "Content-Type: application/json" \
  -d '{"certPath": "certs/val-01.crt", "keyPath": "certs/val-01.key"}'
```

### Step 4: Verify Reload Status
Query `/health/tls` to verify the new fingerprint and expiration date:
```bash
curl http://127.0.0.1:4001/health/tls
```

---

## 4. Procedure C: Emergency Compromise Incident Response

In the event of an adversary compromising a validator's transport or consensus key:
1. **Consortium Immediate Action**:
   Consortium admins execute peer revocation in `PeerAuthorizationRegistry`:
   ```javascript
   peerRegistry.revokePeer('VAL-02', 'Private key compromised in security incident');
   peerRegistry.revokeCertificate(compromisedFingerprint, 'Compromised key');
   ```
2. **Network Response**:
   All active connections to the compromised node are immediately terminated. Inbound connection attempts are rejected with `REVOKED_PEER`.
3. **Provisioning Replacement**:
   Generate a completely new validator node ID or new credentials after audit.

