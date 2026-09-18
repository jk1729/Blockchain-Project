# PDSChain Phase 14: OpenAPI 3.0 Specification Guide

## 1. Overview

PDSChain provides an OpenAPI 3.0.3 specification describing all REST resources, parameters, request bodies, and standardized response envelopes.

The raw JSON definition is available at runtime via:
- `GET /api/v1/docs`
- `GET /api/v1/docs/openapi.json`
- Source file: [`backend/src/docs/openapi.json`](file:///d:/Blockchain%20Project/backend/src/docs/openapi.json)

---

## 2. API Contract Schemas

### 2.1 `ResponseEnvelope`
Every v1 endpoint returns a standard top-level JSON object:
```json
{
  "type": "object",
  "properties": {
    "data": { "type": "object", "nullable": true },
    "meta": {
      "type": "object",
      "properties": {
        "version": { "type": "string", "example": "1.0.0" },
        "requestId": { "type": "string", "example": "req_5f8a2b3c4d5e6f7a" },
        "timestamp": { "type": "string", "format": "date-time" },
        "finality": { "type": "string", "enum": ["PENDING", "COMMITTED", "FINALIZED", "REVERTED"] },
        "pagination": {
          "type": "object",
          "properties": {
            "total": { "type": "integer" },
            "limit": { "type": "integer" },
            "offset": { "type": "integer" },
            "cursor": { "type": "string", "nullable": true },
            "nextCursor": { "type": "string", "nullable": true },
            "prevCursor": { "type": "string", "nullable": true },
            "hasMore": { "type": "boolean" }
          }
        }
      },
      "required": ["version", "timestamp"]
    },
    "error": {
      "type": "object",
      "nullable": true,
      "properties": {
        "code": { "type": "string" },
        "message": { "type": "string" },
        "details": { "type": "object", "nullable": true }
      }
    }
  },
  "required": ["data", "meta", "error"]
}
```

---

## 3. Key Endpoint Mappings

| Tag | Endpoint | Method | Summary |
|---|---|---|---|
| **System** | `/health` | `GET` | Subsystem health, consensus model, and database status |
| **System** | `/docs` | `GET` | OpenAPI 3.0 specification document |
| **Blockchain** | `/blockchain` | `GET` | Chain summary, total blocks, and latest state root |
| **Blockchain** | `/blockchain/blocks` | `GET` | Paginated block stream with cursor support |
| **Blockchain** | `/blockchain/blocks/{n}` | `GET` | Block lookup by height |
| **Blockchain** | `/blockchain/blocks/{n}/consensus` | `GET` | Quorum certificate and validator vote signatures |
| **Blockchain** | `/blockchain/validate` | `GET` | Cryptographic integrity verification |
| **Transactions**| `/transactions` | `GET` | List transactions with filters and cursor pagination |
| **Transactions**| `/transactions/{id}` | `GET` | Transaction status and block inclusion |
| **Transactions**| `/transactions/{id}/receipt` | `GET` | EVM receipt, gas used, logs, return data |
| **Transactions**| `/transactions` | `POST` | Submit ration distribution (requires `Idempotency-Key`) |
| **Contracts** | `/contracts` | `GET` | List deployed contracts and EVM state root |
| **Contracts** | `/contracts/{address}` | `GET` | Contract metadata, code hash, and ABI |
| **Contracts** | `/contracts/call` | `POST` | Execute view method or submit contract transaction |
| **Consensus** | `/consensus/status` | `GET` | FBA consensus round, state, and quorum metrics |
| **Network** | `/network/status` | `GET` | P2P transport status, TLS details, and peer counts |
| **Events** | `/events` | `GET` | Filter canonical events by category, block, or tx |
| **Events** | `/events/stream` | `GET` | Server-Sent Events stream with `Last-Event-ID` resume |
| **JSON-RPC** | `/rpc` | `POST` | JSON-RPC 2.0 batch and single method execution |

