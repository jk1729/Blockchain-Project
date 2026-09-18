# PDSChain Phase 12: Validator Key Management & Storage Specification

## 1. Cryptographic Key Separation

PDSChain strictly decouples **consensus identity** from **network transport identity**:

| Dimension | Consensus Keypair | Transport Keypair |
| :--- | :--- | :--- |
| **Algorithm** | Ed25519 (`ed25519` SPKI DER / PKCS#8 PEM) | RSA (2048-bit) or ECDSA (`secp256r1`) |
| **Purpose** | Signing blocks, proposals, votes, quorum certificates | Authenticating TLS connections, channel encryption |
| **Identity Format** | Deterministic address: `PDS1<40-hex-sha256>` | X.509 Common Name & SAN (`VAL-XX`) |
| **Rotation Cycle** | Height-based epochs (e.g. annually or on-demand) | 60–90 days (Certificate renewal) |
| **Storage Class** | `KeyStore` (AES-256-GCM encrypted) | `KeyStore` / `CertificateManager` |

---

## 2. Keystore Encryption at Rest (AES-256-GCM + PBKDF2)

When persisted to disk, keystores are encrypted using authenticated symmetric encryption:

- **Cipher**: `AES-256-GCM` (Galois/Counter Mode provides both confidentiality and integrity authentication).
- **Key Derivation Function (KDF)**: `PBKDF2-HMAC-SHA256` with 100,000 iterations.
- **Salt**: Cryptographically secure 16-byte random salt generated via `crypto.randomBytes(16)`.
- **Initialization Vector (IV)**: 12-byte random IV (`crypto.randomBytes(12)`).
- **Authentication Tag**: 16-byte GCM authentication tag verifying ciphertext integrity.
- **Production Mode Enforcement**: If `process.env.NODE_ENV === 'production'`, saving or loading unencrypted keystores is strictly prohibited (`UNENCRYPTED_KEYSTORE_PROHIBITED`).

---

## 3. Secret Redaction Invariant

Private keys and passphrases are never revealed:
1. `toSafeObject()`, `toJSON()`, and `toString()` return sanitized diagnostic telemetry only:
   ```json
   {
     "validatorId": "VAL-01",
     "isUnlocked": true,
     "hasConsensusKey": true,
     "consensusAddress": "PDS1349a1f11a8c087964b38d3f18e97a38b1eb79d20",
     "hasTransportKey": true,
     "hasTransportCA": true
   }
   ```
2. Custom Node.js inspect methods (`util.inspect.custom`) redact internal secret references during `console.log()` or debugger sessions.
3. Explicit `destroy()` method zeroes in-memory key buffers and locks the keystore upon shutdown.

