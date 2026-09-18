# PDSChain Phase 15: Explorer Architecture

## 1. Overview

The **PDSChain Professional Blockchain Explorer** provides a comprehensive, production-grade, read-oriented window into the PDSChain immutable ledger. Built with clean separation of concerns, the explorer combines a zero-build modular frontend (`frontend/html/explorer.html`, `frontend/js/explorer.js`, `frontend/css/explorer.css`) with dedicated, high-performance REST and JSON-RPC 2.0 endpoints on the backend (`backend/src/controllers/explorerController.js`, `backend/src/routes/v1/explorerRoutes.js`).

---

## 2. Architectural Layers

```
+-----------------------------------------------------------------------------------+
|                        PDSChain Frontend User Interface                           |
|  [ Dashboard ] [ Blocks ] [ Transactions ] [ Addresses ] [ Contracts ] [ Events ] |
|  [ Validators ] [ Network Topology ] [ Sync & Recovery ] [ Universal Search Bar ] |
+-----------------------------------------+-----------------------------------------+
                                          |
                                          v
+-----------------------------------------------------------------------------------+
|                         Explorer Data Layer & API Client                          |
|   - In-memory TTL Cache (15s) with automatic invalidation on new block events     |
|   - Envelope unwrap ({ data, meta, error }), Request-ID & Correlation-ID tracking|
|   - Reconnect-capable SSE event stream consumer (Last-Event-ID, Deduplication)   |
+-----------------------------------------+-----------------------------------------+
                                          |
                         HTTP / REST & SSE Stream (/api/v1)
                                          |
                                          v
+-----------------------------------------------------------------------------------+
|                           PDSChain Backend API Layer                              |
|   - /api/v1/explorer/overview     - /api/v1/explorer/search                       |
|   - /api/v1/explorer/block/:id    - /api/v1/explorer/address/:addr                |
|   - /api/v1/blockchain/blocks     - /api/v1/transactions                          |
|   - /api/v1/contracts             - /api/v1/contracts/call (View Runner)          |
|   - /api/v1/consensus/status      - /api/v1/network/peers                         |
|   - /api/v1/ledger/status         - /api/v1/events/stream (SSE)                   |
+-----------------------------------------+-----------------------------------------+
                                          |
                                          v
+-----------------------------------------------------------------------------------+
|                   PDSChain Ledger & Execution Subsystems                          |
|   [ Blockchain Service ]  [ 12-Validator FBA Quorum ]  [ EVM Runtime & Registry ] |
|   [ LevelDB / SQLite ]    [ EventBus & Journal ]       [ TLS / mTLS Transport ]   |
+-----------------------------------------------------------------------------------+
```

---

## 3. Key Design Principles

### 3.1 Strict Finality Awareness
The explorer strictly reflects the ledger's finality lifecycle:
- **`FINALIZED`**: Blocks certified by 2/3+ (8 of 12) FBA validator quorum signatures, transactions contained within finalized blocks, and immutable state roots.
- **`COMMITTED`**: Transactions accepted into the local database awaiting multi-process consensus certification.
- **`PENDING`**: Transactions staged in the mempool awaiting candidate proposal.
- **`REVERTED`**: EVM smart contract transactions that encountered execution errors or explicit `revert()` calls.
Unverified or pending data is never deceptively labeled as finalized.

### 3.2 Read-Oriented Boundary & Zero Secret Exposure
- Public explorer views do not expose consensus mutation APIs, private key signing utilities, or administrative controls.
- Interactive contract functionality is restricted to read-only simulation calls (`POST /api/v1/contracts/call` with `isView: true`).
- Sensitive secrets (private keys, keystore passphrases, TLS certificate private keys, challenge nonces) are recursively scrubbed by `ResponseEnvelope.sanitizeSecrets()`.

### 3.3 Universal Search Classification
The search engine employs deterministic pattern matching to classify queries into appropriate categories without expensive brute-force database scans:
- **Integer string (`/^\d+$/`)**: Block height.
- **64-character hex (`/^(0x)?[0-9a-fA-F]{64}$/`)**: Cryptographic block hash or transaction hash.
- **`TXN-*` prefix**: Business grain distribution transaction ID.
- **`PDS1*` or 40-char hex**: Account, beneficiary, shop, or smart contract address.
- **`VAL-*` / `NODE-*` prefix**: Consortium validator node ID.
- **`EVT-*` or UUID**: Blockchain event journal ID.

---

## 4. State Management & Real-Time Updates

- **In-Memory Cache**: The frontend client caches immutable block headers, verified contract ABIs, and network topology with a 15-second TTL.
- **Cache Invalidation**: When the SSE stream emits a `BLOCK_FINALIZED` or `TRANSACTION_EXECUTED` event, the cache is instantly cleared via `ExplorerAPI.invalidateCache()`.
- **Deduplication**: Live streamed events are filtered through a client-side `seenEventIds` Set to guarantee no duplicate entries appear in the UI ticker or event table.
- **Bounded Buffer**: Live tables enforce an upper bound of 25-50 entries to guarantee constant browser memory utilization.

