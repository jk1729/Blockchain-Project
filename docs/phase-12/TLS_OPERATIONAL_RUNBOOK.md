# PDSChain Phase 12: TLS/mTLS Operational Runbook & Observability

## 1. Health Monitoring & Observability Endpoints

Every validator daemon exposes real-time TLS and cryptographic health telemetry via dedicated REST endpoints.

### 1.1 `/health/tls`
Provides detailed transport security status without exposing private keys.

**Example Response:**
```json
{
  "configured": true,
  "status": "OK",
  "cn": "VAL-01",
  "san": ["127.0.0.1", "localhost"],
  "fingerprint256": "4A:22:98:4B:92:2C:B0:FD:0C:86:14:CE:B8:31:DE:37:F9:56:56:D7:E3:B5:1F:B4:85:06:FE:7B:6C:9B:45:FB",
  "issuer": "CN=PDSChain Consortium Root CA, O=PDSChain Consortium",
  "validFrom": "Sep 17 08:24:19 2026 GMT",
  "validTo": "Sep 14 08:24:19 2036 GMT",
  "daysRemaining": 3648,
  "hoursRemaining": 87570,
  "isExpired": false,
  "caConfigured": true
}
```

### 1.2 `/health/keys`
Provides key store and rotation status.

**Example Response:**
```json
{
  "validatorId": "VAL-01",
  "keyStore": {
    "validatorId": "VAL-01",
    "isUnlocked": true,
    "hasConsensusKey": true,
    "consensusAddress": "PDS1349a1f11a8c087964b38d3f18e97a38b1eb79d20",
    "consensusPublicKey": "302a300506032b65700321008d5...",
    "hasTransportKey": true,
    "hasTransportCA": true
  },
  "rotation": {
    "validatorId": "VAL-01",
    "currentPublicKey": "302a300506032b65700321008d5...",
    "currentAddress": "PDS1349a1f11a8c087964b38d3f18e97a38b1eb79d20",
    "currentStartHeight": 0,
    "hasStagedKey": false,
    "stagedActivationHeight": null,
    "rotationCount": 0,
    "historyLength": 1
  },
  "authorizations": {
    "strictMode": false,
    "totalRegistered": 12,
    "activeCount": 12,
    "suspendedCount": 0,
    "revokedCount": 0,
    "revokedCertificatesCount": 0
  }
}
```

---

## 2. Expiry Alert Tiers & Incident Actions

| Tier | Condition | Alert Level | Action Required |
| :--- | :--- | :--- | :--- |
| `OK` | > 30 days | Info | Normal operations. |
| `WARNING_30D` | <= 30 days | Warning | Request renewed certificate from Consortium CA. |
| `WARNING_14D` | <= 14 days | High | Ensure certificate is signed and staged on validator host. |
| `CRITICAL_7D` | <= 7 days | Critical | Execute `/admin/tls/reload` to swap active certificate. |
| `EMERGENCY_24H`| <= 24 hours | Urgent | Immediate operator escalation to avoid network disruption. |
| `EXPIRED` | <= 0 hours | Blocker | Node will be rejected by peers with `EXPIRED_CERTIFICATE`. |

---

## 3. Prometheus Metric Indicators

In addition to JSON endpoints, Prometheus metrics exported via `/metrics` track:
- `pdschain_p2p_active_connections` — Gauge of live authenticated peers.
- `pdschain_p2p_tls_encrypted_connections` — Gauge of active TLS connections.
- `pdschain_p2p_messages_rejected_total{code="VALIDATOR_IDENTITY_MISMATCH"}` — Counter for identity binding rejections.
- `pdschain_p2p_messages_rejected_total{code="EXPIRED_CERTIFICATE"}` — Counter for expired certificate rejections.
- `pdschain_p2p_messages_rejected_total{code="REVOKED_PEER"}` — Counter for revoked node rejections.

