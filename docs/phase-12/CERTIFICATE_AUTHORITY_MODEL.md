# PDSChain Phase 12: Certificate Authority Model & Trust Specification

## 1. Consortium PKI Architecture

PDSChain uses a **Private Consortium Public Key Infrastructure (PKI)** trust model. Public Internet CAs (such as Let's Encrypt, DigiCert, Sectigo) are deliberately **not** trusted for validator peer transport. Only certificates cryptographically signed by the **Consortium Root CA** are admitted into the P2P network.

```
       +------------------------------------+
       |       Consortium Root CA           |
       |  (Offline Cold Storage / Hardware) |
       +-----------------+------------------+
                         |
           +-------------+-------------+
           |                           |
+----------v-----------+   +-----------v----------+
| Validator 1 Identity |   | Validator 2 Identity |
| (VAL-01 / cert / key)|   | (VAL-02 / cert / key)|
+----------------------+   +----------------------+
```

---

## 2. Certificate Profile Specification

All validator transport certificates must conform to the following X.509 v3 profile:

| Field / Extension | Required Value / Policy | Enforcement |
| :--- | :--- | :--- |
| **Version** | X.509 v3 | Strict |
| **Signature Algorithm** | SHA-256 with RSA (2048+ bit) or ECDSA (secp256r1/ed25519) | Node.js Crypto |
| **Issuer** | PDSChain Consortium Root CA | Verified against pinned CA |
| **Subject Common Name (CN)** | Official Validator Identifier (e.g. `VAL-01`, `VAL-02`) | Matched in Handshake |
| **Basic Constraints** | `critical, CA:FALSE` | End-entity certificate only |
| **Key Usage** | `digitalSignature, keyEncipherment` | TLS transport authorization |
| **Extended Key Usage (EKU)** | `serverAuth, clientAuth` | Required for bidirectional mTLS |
| **Subject Alternative Name (SAN)** | `DNS:VAL-XX, DNS:localhost, IP:127.0.0.1` | Hostname and node ID validation |
| **Validity Period** | 90 days (Production recommendation) | Expiration tracking |

---

## 3. Trust Store Pinning

Validators do not rely on the operating system's root certificate store. Instead:
1. The Consortium CA certificate (`ca.crt`) is pinned directly in validator configuration (`tlsCaPath` or `tlsOptions.ca`).
2. When accepting inbound or initiating outbound connections, the peer's certificate must be verified against this pinned CA.
3. Untrusted / alien CAs trigger immediate rejection with `UNKNOWN_ISSUER`:
   ```javascript
   const verified = cert.verify(this.caCert.publicKey);
   if (!verified) {
     throw new NetworkError(NetworkErrorCode.UNKNOWN_ISSUER, 'Certificate was not signed by Consortium CA');
   }
   ```

