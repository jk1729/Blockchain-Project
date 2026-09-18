# PDSChain Phase 14: API Versioning and Compatibility Guide

## 1. Versioning Architecture

PDSChain adopts an explicit multi-channel versioning and deprecation strategy to ensure seamless integration across frontend dashboards, mobile clients, external indexers, and consortium validator nodes.

```
Incoming Request
      │
      ├── Path: /api/v1/... ───────────────────► Version 1 REST Router (Canonical Envelope)
      │                                           Meta: { version: "1.0.0", requestId: "..." }
      ├── Path: /rpc or /rpc/v1 ──────────────► JSON-RPC 2.0 Engine
      │                                           { jsonrpc: "2.0", id: 1, result: ... }
      ├── Header: X-API-Version: 1.0.0 ────────► Enforced v1 Pipeline
      │
      ├── Accept: application/vnd.pdschain.v1+json ► Enforced Content Negotiation
      │
      └── Path: /api/... (Legacy Route) ──────► Legacy Compat Router + Deprecation Headers
                                                  Deprecation: true
                                                  Sunset: Fri, 01 Jan 2027 00:00:00 GMT
                                                  Link: </api/v1/...>; rel="successor-version"
```

---

## 2. Backward Compatibility Guarantees

1. **Zero Breaking Changes for Existing Clients**:
   - All pre-existing routes mounted under `/api/...` (such as `/api/health`, `/api/data`, `/api/blockchain`, `/api/transactions`, `/api/beneficiaries`) retain their exact HTTP methods, parameter names, and top-level response keys (`res.body.success`, `res.body.blocks`, `res.body.transactions`).
   - All 54 backend test suites from prior phases run against `/api/...` without modification.
2. **Deprecation Signals**:
   - Every legacy response includes standard HTTP deprecation headers:
     - `Deprecation: true`
     - `Sunset: Fri, 01 Jan 2027 00:00:00 GMT`
     - `Link: </api/v1${path}>; rel="successor-version"`
   - Operators and developers have an extended transition window until January 1, 2027.

---

## 3. The Standard Version 1 Response Envelope

Every endpoint under `/api/v1/...` returns a consistent canonical contract:

### 3.1 Success Envelope
```json
{
  "data": {
    "blockNumber": 42,
    "blockHash": "0xabc...",
    "transactions": []
  },
  "meta": {
    "version": "1.0.0",
    "requestId": "req_5f8a2b3c4d5e6f7a8b9c0d1e2f3a4b5c",
    "timestamp": "2026-09-17T18:50:00.000Z",
    "finality": "FINALIZED",
    "pagination": {
      "total": 100,
      "limit": 20,
      "cursor": "eyJvZmZzZXQiOjB9",
      "nextCursor": "eyJvZmZzZXQiOjIwfQ==",
      "hasMore": true
    }
  },
  "error": null
}
```

### 3.2 Error Envelope
```json
{
  "data": null,
  "meta": {
    "version": "1.0.0",
    "requestId": "req_5f8a2b3c4d5e6f7a8b9c0d1e2f3a4b5c",
    "timestamp": "2026-09-17T18:50:00.000Z"
  },
  "error": {
    "code": "RESOURCE_NOT_FOUND",
    "message": "Block #999 not found.",
    "details": null
  }
}
```

---

## 4. Unsupported Version Handling

When an unsupported API version is requested (e.g. `/api/v2/...` or `/api/v99/...`), PDSChain immediately halts processing and responds with `400 Bad Request`:
```json
{
  "data": null,
  "meta": {
    "version": "1.0.0",
    "timestamp": "2026-09-17T18:50:00.000Z"
  },
  "error": {
    "code": "UNSUPPORTED_API_VERSION",
    "message": "API version 'v99' is not supported. Supported versions: v1",
    "supportedVersions": ["v1"]
  }
}
```

---

## 5. Migration Checklist for Clients

| Legacy Endpoint | Recommended Version 1 Endpoint | JSON-RPC 2.0 Equivalent |
|---|---|---|
| `GET /api/health` | `GET /api/v1/health` | `pds_health` |
| `GET /api/blockchain` | `GET /api/v1/blockchain` | `pds_nodeInfo` |
| `GET /api/blockchain/blocks` | `GET /api/v1/blockchain/blocks?cursor=...` | `pds_getBlockByNumber` |
| `GET /api/blockchain/blocks/:n` | `GET /api/v1/blockchain/blocks/:n` | `pds_getBlockByNumber` |
| `GET /api/blockchain/validate` | `GET /api/v1/blockchain/validate` | `pds_validateChain` |
| `GET /api/transactions` | `GET /api/v1/transactions?cursor=...` | `pds_getTransactionByHash` |
| `GET /api/transactions/:id/receipt` | `GET /api/v1/transactions/:id/receipt` | `pds_getTransactionReceipt` |
| `POST /api/transactions` | `POST /api/v1/transactions` (`Idempotency-Key`) | `pds_sendRawTransaction` |
| `GET /api/contracts` | `GET /api/v1/contracts` | `pds_getCode` |
| `POST /api/contracts/call` | `POST /api/v1/contracts/call` | `pds_call` |
| `GET /api/consensus/status` | `GET /api/v1/consensus/status` | `pds_getConsensusStatus` |
| `GET /api/consensus/quorum` | `GET /api/v1/consensus/quorum` | `pds_getQuorum` |
| `GET /api/network/status` | `GET /api/v1/network/status` | `pds_getNetworkStatus` |
| `GET /api/network/peers` | `GET /api/v1/network/peers` | `pds_getPeers` |
| `GET /api/ledger/status` | `GET /api/v1/ledger/status` | `pds_getSyncStatus` |
| `GET /api/ledger/checkpoint` | `GET /api/v1/ledger/checkpoint` | `pds_getCheckpoint` |
| `GET /api/events` | `GET /api/v1/events?cursor=...` | `pds_getEvents` |
| `GET /api/events/:id` | `GET /api/v1/events/:id` | `pds_getEventById` |

