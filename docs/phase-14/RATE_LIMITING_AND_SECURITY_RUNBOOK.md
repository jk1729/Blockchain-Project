# PDSChain Phase 14: Rate Limiting and Security Runbook

## 1. Rate Limiting Architecture

PDSChain implements an in-memory sliding-window rate limiter designed to protect validator nodes from denial-of-service (DoS), resource exhaustion, and transaction flooding while maintaining responsive access for legitimate clients.

```
Incoming Request
      │
      ├── Public Queries (e.g. GET /api/v1/blockchain/blocks) ──► Tier: Public (120 req/min)
      │
      ├── State Mutations (e.g. POST /api/v1/transactions)   ──► Tier: Mutating (30 req/min)
      │
      └── JSON-RPC (e.g. POST /rpc/v1)                       ──► Tier: RPC (180 req/min)
```

### 1.1 HTTP Rate Limit Headers
Every response from rate-limited endpoints includes:
- `X-RateLimit-Limit`: Maximum allowed requests per sliding window.
- `X-RateLimit-Remaining`: Remaining request quota for the calling IP within the active window.
- `X-RateLimit-Reset`: UTC epoch timestamp (in seconds) when the window resets.

### 1.2 Rate Limit Exceeded Behavior (HTTP 429)
When a client exceeds its quota, the node immediately terminates processing and returns:
- Status: `429 Too Many Requests`
- Header: `Retry-After: <seconds>`
- JSON Body:
  ```json
  {
    "data": null,
    "meta": {
      "timestamp": "2026-09-17T18:50:00.000Z",
      "retryAfter": 15
    },
    "error": {
      "code": "RATE_LIMIT_EXCEEDED",
      "message": "Too many requests. Maximum 120 requests per 60s.",
      "retryAfter": 15
    }
  }
  ```

---

## 2. Idempotency & Replay Protection

To prevent accidental duplicate transactions resulting from network retries, client timeouts, or load-balancer replay:
- **Header**: `Idempotency-Key: <unique_client_token>` (e.g. UUIDv4).
- **TTL**: 15 minutes (900,000 ms) in-memory retention.
- **Behavior**:
  - **First Request**: The handler processes normally. The resulting HTTP status code and response payload are stored in the `IdempotencyManager` cache.
  - **Duplicate Request**: The node detects the active key and returns the identical cached response with header `X-Idempotent-Replayed: true` without re-executing consensus or smart contract methods.

---

## 3. Secret Redaction & Sanitization

PDSChain enforces strict, zero-trust recursive secret sanitization across all responses, metadata, JSON-RPC outputs, and error details:
- **Sensitive Substring Blacklist**:
  - `privatekey`, `private_key`
  - `seed`, `mnemonic`
  - `passphrase`, `secret`, `password`
  - `keymaterial`
  - `authorization`
- **Mask**: Any blacklisted property is replaced with `"[REDACTED]"`.
- **Validation**: Enforced on every response via `sanitizeSecrets()` in [`backend/src/api/ResponseEnvelope.js`](file:///d:/Blockchain%20Project/backend/src/api/ResponseEnvelope.js).

---

## 4. Operator Incident Runbooks

### Runbook 14-A: High Request Volume / Rate Limit Storm
**Trigger**: Client or bot triggers persistent 429 errors or floods `/rpc`.
**Actions**:
1. Inspect source IPs in reverse proxy or container logs:
   ```bash
   grep "RATE_LIMIT_EXCEEDED" /var/log/pdschain/*.log | awk '{print $1}' | sort | uniq -c | sort -nr
   ```
2. If traffic is malicious, block IP at host firewall (iptables / cloud security group).
3. If traffic is a known partner/indexer needing higher quota, adjust `windowMs` or `max` in `RateLimiter.js`.

### Runbook 14-B: Secret Leakage Audit
**Verification Procedure**:
Run the adversarial privacy audit script to ensure no keys or passphrases appear in responses:
```bash
node --experimental-vm-modules node_modules/jest/bin/jest.js tests/api-adversarial-security.test.js
```

