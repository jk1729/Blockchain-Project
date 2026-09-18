# PDSChain Phase 11: Validator Identity & Key Management Guide

## 1. Cryptographic Principles

PDSChain uses **Ed25519** (Edwards-curve Digital Signature Algorithm over Curve25519) for consensus voting, proposal generation, and peer transport authentication:
- **Private Key**: 32-byte seed / PKCS#8 PEM string held exclusively in validator local memory.
- **Public Key**: 32-byte raw public key / 44-byte DER SubjectPublicKeyInfo (SPKI) representation.
- **PDSChain Address**: `PDS1` followed by the first 40 hex characters of `SHA-256("PDSCHAIN_ADDR:" + publicKeyHex)`.

---

## 2. Generating a Production Validator Identity

In production environments, deterministic development keys are strictly prohibited (`NODE_ENV=production` triggers hard failure if dev keys are detected).

To provision a fresh identity securely using the CLI utility:

```bash
# Basic provisioning for VAL-01
node backend/src/scripts/provisionIdentity.js \
  --id VAL-01 \
  --out /var/lib/pdschain/VAL-01/identity.json \
  --institution "Ministry of Consumer Affairs" \
  --operator "NIC Team"
```

### Generated Schema (`identity.json`)

```json
{
  "validatorId": "VAL-01",
  "address": "PDS17f83b1657ff1fc53b92dc18148a1d65dfc2d4b1f",
  "publicKey": "302a300506032b6570032100a1b2c3d4e5f6...",
  "privateKey": "-----BEGIN PRIVATE KEY-----\nMC4CAQAwBQYDK2VwBCIEIK...\n-----END PRIVATE KEY-----\n",
  "createdAt": 1773739200000,
  "metadata": {
    "institution": "Ministry of Consumer Affairs",
    "operator": "NIC Team",
    "version": 1
  }
}
```

---

## 3. Storage Permissions & Protection

On POSIX operating systems, `IdentityProvisioner` enforces strict filesystem permissions:
- Parent directory mode: `0700` (`rwx------`).
- Identity file mode: `0600` (`rw-------`).

### Accidental Replacement Safeguard
`IdentityProvisioner.saveToFile()` will refuse to overwrite an existing identity file unless the `--force` flag is explicitly provided. This prevents catastrophic key replacement during routine maintenance.

---

## 4. Operational Key Rotation Procedures

To rotate an operational validator's identity keypair:
1. **Generate Staged Identity**:
   ```bash
   node backend/src/scripts/provisionIdentity.js --id VAL-01 --out /var/lib/pdschain/VAL-01/identity.new.json
   ```
2. **Publish Public Identity**:
   Extract the public profile (`node -e "console.log(require('./src/blockchain/identity/IdentityProvisioner').IdentityProvisioner.getPublicProfile(require('/var/lib/pdschain/VAL-01/identity.new.json')))"`) and submit it to consortium operators for inclusion in the authorized validator set.
3. **Quiesce Consensus**:
   Wait for an epoch boundary or quiescent round.
4. **Swap and Restart**:
   ```bash
   mv /var/lib/pdschain/VAL-01/identity.new.json /var/lib/pdschain/VAL-01/identity.json
   systemctl restart pdschain-validator@VAL-01
   ```
5. **Verify Readiness**:
   ```bash
   curl -s http://localhost:4001/health/ready | jq .
   ```

