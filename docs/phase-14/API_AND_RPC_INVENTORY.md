# PDSChain Phase 14: Existing API and RPC Inventory

## 1. Overview

This document catalogs all endpoints exposed across the PDSChain backend API and validator daemon services. It serves as the baseline for Phase 14 versioning, contract standardization, JSON-RPC 2.0 method mapping, rate limiting, and deprecation planning.

---

## 2. API Endpoint Inventory

| HTTP Method | Route | Controller / Handler | Purpose | Auth Required | Mutability | Finality Semantics | Pagination | Rate Limit Class | Status |
|---|---|---|---|---|---|---|---|---|---|
| `GET` | `/api/health` | Inline / Health | Service health check | None | Read-Only | N/A | None | Public (120/m) | Active (Legacy) |
| `GET` | `/api/data` | Inline / Data | Full dataset snapshot bootstrap | None | Read-Only | Read-Committed | None | Public (60/m) | Active (Legacy) |
| `POST` | `/api/auth/register` | `authController.register` | User registration | None | Mutating | DB-Committed | None | Auth (30/m) | Active (Legacy) |
| `POST` | `/api/auth/login` | `authController.login` | User login / JWT issuance | None | Mutating | DB-Committed | None | Auth (30/m) | Active (Legacy) |
| `GET` | `/api/auth/me` | `authController.getMe` | Get authenticated user profile | Bearer JWT | Read-Only | DB-Committed | None | Authenticated | Active (Legacy) |
| `GET` | `/api/beneficiaries` | `beneficiaryController.getAll` | Query beneficiaries | Optional JWT | Read-Only | DB-Committed | Query limit | Public (120/m) | Active (Legacy) |
| `GET` | `/api/beneficiaries/:id` | `beneficiaryController.getById` | Get beneficiary by ID | Optional JWT | Read-Only | DB-Committed | None | Public (120/m) | Active (Legacy) |
| `POST` | `/api/beneficiaries` | `beneficiaryController.create` | Register beneficiary | ADMIN | Mutating | DB-Committed | None | Mutating (30/m) | Active (Legacy) |
| `PUT` | `/api/beneficiaries/:id` | `beneficiaryController.update` | Update beneficiary | ADMIN | Mutating | DB-Committed | None | Mutating (30/m) | Active (Legacy) |
| `GET` | `/api/shops` | `shopController.getAll` | Query Fair Price Shops | Optional JWT | Read-Only | DB-Committed | None | Public (120/m) | Active (Legacy) |
| `GET` | `/api/shops/:id` | `shopController.getById` | Get shop by ID | Optional JWT | Read-Only | DB-Committed | None | Public (120/m) | Active (Legacy) |
| `POST` | `/api/shops` | `shopController.create` | Register new shop | ADMIN | Mutating | DB-Committed | None | Mutating (30/m) | Active (Legacy) |
| `PUT` | `/api/shops/:id` | `shopController.update` | Update shop details | ADMIN | Mutating | DB-Committed | None | Mutating (30/m) | Active (Legacy) |
| `GET` | `/api/shops/:id/inventory` | `inventoryController.getByShop` | Get shop stock balances | Optional JWT | Read-Only | DB-Committed | None | Public (120/m) | Active (Legacy) |
| `POST` | `/api/shops/:id/inventory` | `inventoryController.addOrUpdate` | Update shop stock | SHOP/ADMIN | Mutating | DB-Committed | None | Mutating (30/m) | Active (Legacy) |
| `GET` | `/api/shops/:id/transactions` | `transactionController.getByShop` | Query transactions by shop | Optional JWT | Read-Only | Read-Committed | Query limit | Public (120/m) | Active (Legacy) |
| `GET` | `/api/warehouses` | `warehouseController.getAll` | Query warehouses | Optional JWT | Read-Only | DB-Committed | None | Public (120/m) | Active (Legacy) |
| `GET` | `/api/warehouses/:id` | `warehouseController.getById` | Get warehouse by ID | Optional JWT | Read-Only | DB-Committed | None | Public (120/m) | Active (Legacy) |
| `POST` | `/api/warehouses` | `warehouseController.create` | Create warehouse | ADMIN | Mutating | DB-Committed | None | Mutating (30/m) | Active (Legacy) |
| `PUT` | `/api/warehouses/:id` | `warehouseController.update` | Update warehouse | ADMIN | Mutating | DB-Committed | None | Mutating (30/m) | Active (Legacy) |
| `GET` | `/api/warehouses/:id/inventory` | `inventoryController.getByWarehouse` | Warehouse inventory | Optional JWT | Read-Only | DB-Committed | None | Public (120/m) | Active (Legacy) |
| `POST` | `/api/warehouses/:id/dispatch` | `warehouseController.dispatch` | Dispatch stock to shop | WAREHOUSE/ADMIN | Mutating | DB-Committed | None | Mutating (30/m) | Active (Legacy) |
| `GET` | `/api/transactions` | `transactionController.getAll` | List transactions | Optional JWT | Read-Only | Read-Committed | Query limit | Public (120/m) | Active (Legacy) |
| `GET` | `/api/transactions/:id` | `transactionController.getById` | Get transaction by ID | Optional JWT | Read-Only | Read-Committed | None | Public (120/m) | Active (Legacy) |
| `GET` | `/api/transactions/:id/receipt` | `contractController.getTransactionReceipt` | Get execution receipt | None | Read-Only | FINALIZED | None | Public (120/m) | Active (Legacy) |
| `POST` | `/api/transactions` | `transactionController.create` | Submit ration distribution tx | SHOP/ADMIN | Mutating | PENDING -> COMMITTED | None | Mutating (30/m) | Active (Legacy) |
| `GET` | `/api/blockchain` | `blockchainController.getBlockchain` | Full blockchain overview | None | Read-Only | FINALIZED | None | Public (120/m) | Active (Legacy) |
| `GET` | `/api/blockchain/blocks` | `blockchainController.getBlocks` | List blocks | None | Read-Only | FINALIZED | Offset/Limit | Public (120/m) | Active (Legacy) |
| `GET` | `/api/blockchain/blocks/:number` | `blockchainController.getBlockByNumber` | Get block by number | None | Read-Only | FINALIZED | None | Public (120/m) | Active (Legacy) |
| `GET` | `/api/blockchain/blocks/:number/consensus` | `blockchainController.getBlockConsensus` | Get block consensus cert | None | Read-Only | FINALIZED | None | Public (120/m) | Active (Legacy) |
| `GET` | `/api/blockchain/validate` | `blockchainController.validate` | Validate chain cryptographic integrity | None | Read-Only | FINALIZED | None | Public (60/m) | Active (Legacy) |
| `GET` | `/api/blockchain/identity/:id` | `blockchainController.getIdentity` | Public key/address lookup | None | Read-Only | N/A | None | Public (120/m) | Active (Legacy) |
| `POST` | `/api/blockchain/transactions/verify` | `blockchainController.verifyTransaction` | Verify transaction signature | None | Read-Only | N/A | None | Public (120/m) | Active (Legacy) |
| `GET` | `/api/blockchain/mempool` | `blockchainController.getMempool` | View pending transactions | None | Read-Only | PENDING | None | Public (120/m) | Active (Legacy) |
| `GET` | `/api/blockchain/mempool/stats` | `blockchainController.getMempoolStats` | Mempool statistics | None | Read-Only | PENDING | None | Public (120/m) | Active (Legacy) |
| `GET` | `/api/blockchain/state/root` | `blockchainController.getStateRoot` | Deterministic state root | None | Read-Only | FINALIZED | None | Public (120/m) | Active (Legacy) |
| `GET` | `/api/blockchain/state/snapshot` | `blockchainController.getConsensusState` | Consensus state snapshot | None | Read-Only | FINALIZED | None | Public (120/m) | Active (Legacy) |
| `POST` | `/api/blockchain/consensus/verify` | `blockchainController.verifyConsensusCertificate` | Verify FBA certificate | None | Read-Only | N/A | None | Public (120/m) | Active (Legacy) |
| `GET` | `/api/validators` | `validatorController.getAll` | Validator node directory | Optional JWT | Read-Only | N/A | None | Public (120/m) | Active (Legacy) |
| `GET` | `/api/validators/:id` | `validatorController.getById` | Validator details | Optional JWT | Read-Only | N/A | None | Public (120/m) | Active (Legacy) |
| `POST` | `/api/validators/:id/status` | `validatorController.updateStatus` | Toggle validator status (simulation) | VALIDATOR/ADMIN | Mutating | Immediate | None | Mutating (30/m) | Active (Legacy) |
| `GET` | `/api/consensus/status` | `consensusController.getStatus` | FBA consensus status | Optional JWT | Read-Only | Live | None | Public (120/m) | Active (Legacy) |
| `GET` | `/api/consensus/quorum` | `consensusController.getQuorum` | Quorum slices config | Optional JWT | Read-Only | Live | None | Public (120/m) | Active (Legacy) |
| `GET` | `/api/consensus/state` | `consensusController.getState` | Current round & state | Optional JWT | Read-Only | Live | None | Public (120/m) | Active (Legacy) |
| `GET` | `/api/consensus/conflicts` | `consensusController.getConflicts` | Double-vote/conflict log | Optional JWT | Read-Only | Live | None | Public (120/m) | Active (Legacy) |
| `GET` | `/api/consensus/votes/height/:height` | `consensusController.getVotesByHeight` | Votes for height | Optional JWT | Read-Only | Live | None | Public (120/m) | Active (Legacy) |
| `GET` | `/api/consensus/journal` | `consensusController.getJournal` | Consensus journal log | Optional JWT | Read-Only | Live | Limit | Public (120/m) | Active (Legacy) |
| `POST` | `/api/consensus/propose` | `consensusController.propose` | Submit block proposal | SHOP/ADMIN/VALIDATOR | Mutating | PENDING | None | Mutating (30/m) | Active (Legacy) |
| `GET` | `/api/contracts` | `contractController.getContracts` | List deployed contracts | None | Read-Only | FINALIZED | None | Public (120/m) | Active (Legacy) |
| `GET` | `/api/contracts/:address` | `contractController.getContractDetails` | Contract ABI and details | None | Read-Only | FINALIZED | None | Public (120/m) | Active (Legacy) |
| `GET` | `/api/contracts/:address/events` | `contractController.getContractEvents` | Contract event logs | None | Read-Only | FINALIZED | None | Public (120/m) | Active (Legacy) |
| `POST` | `/api/contracts/call` | `contractController.callContract` | Read-only / state call | Optional JWT | Mutating/View | PENDING/FINALIZED | None | Public (60/m) | Active (Legacy) |
| `GET` | `/api/network/status` | `networkController.getStatus` | Network status | None | Read-Only | Live | None | Public (120/m) | Active (Legacy) |
| `GET` | `/api/network/peers` | `networkController.getPeers` | Connected P2P peers | None | Read-Only | Live | None | Public (120/m) | Active (Legacy) |
| `GET` | `/api/network/topology` | `networkController.getTopology` | Network topology graph | None | Read-Only | Live | None | Public (120/m) | Active (Legacy) |
| `GET` | `/api/network/metrics` | `networkController.getMetrics` | P2P network telemetry | None | Read-Only | Live | None | Public (120/m) | Active (Legacy) |
| `GET` | `/api/network/sync/status` | `networkController.getSyncStatus` | P2P sync state | None | Read-Only | Live | None | Public (120/m) | Active (Legacy) |
| `GET` | `/api/ledger/status` | `ledgerController.getStatus` | Ledger sync status | None | Read-Only | Live | None | Public (120/m) | Active (Legacy) |
| `GET` | `/api/ledger/checkpoint` | `ledgerController.getCheckpoint` | Latest checkpoint | None | Read-Only | FINALIZED | None | Public (120/m) | Active (Legacy) |
| `GET` | `/api/events` | `eventController.getEvents` | Query events | None | Read-Only | Mixed | Cursor/Limit | Public (120/m) | Active (Phase 13) |
| `GET` | `/api/events/:eventId` | `eventController.getEventById` | Query single event | None | Read-Only | Mixed | None | Public (120/m) | Active (Phase 13) |
| `GET` | `/api/events/blocks/:heightOrHash` | `eventController.getBlockEvents` | Block events | None | Read-Only | FINALIZED | Cursor/Limit | Public (120/m) | Active (Phase 13) |
| `GET` | `/api/events/transactions/:txHash` | `eventController.getTransactionEvents` | Transaction events | None | Read-Only | Mixed | Cursor/Limit | Public (120/m) | Active (Phase 13) |
| `GET` | `/api/events/contracts/:address` | `eventController.getContractEvents` | Contract events | None | Read-Only | FINALIZED | Cursor/Limit | Public (120/m) | Active (Phase 13) |
| `GET` | `/api/events/stream` | `eventController.streamEvents` | SSE event stream | None | Read-Only | Live | Streaming | SSE (30 conn/IP) | Active (Phase 13) |
| `GET` | `/api/events/metrics` | `eventController.getMetricsHandler` | Prometheus metrics | None | Read-Only | Live | None | Public (120/m) | Active (Phase 13) |

---

## 3. Validator Process Daemon Endpoints (Ports 8001–8012)

| HTTP Method | Route | Purpose | Auth Required | Finality Semantics |
|---|---|---|---|---|
| `GET` | `/health` | Aggregate validator daemon health | None | Live |
| `GET` | `/health/live` | Kubernetes Liveness Probe | None | Live |
| `GET` | `/health/ready` | Kubernetes Readiness Probe | None | Live |
| `GET` | `/health/consensus` | Consensus Readiness Probe (503 if not ready) | None | Live |
| `GET` | `/health/tls` | X.509 Certificate validity and CA trust | None | Live |
| `GET` | `/health/keys` | Keystore status and rotation counts (secrets redacted) | None | Live |
| `POST` | `/admin/tls/reload` | Hot-reload TLS certificates | Admin/Local | Immediate |
| `GET` | `/version` | Build info, protocol version, network ID | None | N/A |
| `GET` | `/status` | Full node status, peers, checkpoint, metrics | None | Live |
| `GET` | `/sync/status` | Detailed sync state and latest checkpoint | None | Live |
| `GET` | `/ledger/status` | Ledger sync state machine snapshot | None | Live |
| `POST` | `/status` | Fault injection: Toggle Online/Offline/Degraded | Local | Immediate |
| `GET` | `/metrics` | Prometheus metrics snapshot | None | Live |
| `GET` | `/blocks` | Local block chain array | None | FINALIZED |
| `GET` | `/blocks/latest` | Latest verified block | None | FINALIZED |
| `GET` | `/peers` | Connected authenticated P2P peers | None | Live |
| `GET` | `/api/events/*` & `/events/*` | Isolated validator event journal and SSE stream | None | Mixed |

---

## 4. Deprecation Strategy & Phase 14 Versioning

1. **Legacy Route Preservation (`/api/...`)**:
   - Every existing `/api/...` route continues to function exactly as implemented to avoid breaking existing frontend clients and tests.
   - Standard deprecation headers are injected on legacy `/api/...` calls:
     ```http
     Deprecation: true
     Sunset: Fri, 01 Jan 2027 00:00:00 GMT
     Link: </api/v1/...>; rel="successor-version"
     ```
2. **Standardized Version 1 Routes (`/api/v1/...`)**:
   - Standard response envelope: `{ data: { ... }, meta: { version: "1.0.0", requestId: "...", timestamp: "..." }, error: null }`.
   - Cursor-based pagination (`cursor`, `limit`, `nextCursor`, `prevCursor`, `hasMore`).
   - Rate limiting headers (`X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`).
   - Request correlation IDs (`X-Request-ID`).
3. **JSON-RPC 2.0 (`/rpc`, `/rpc/v1`, `/api/v1/rpc`)**:
   - Provides programmatic batch and single execution for all ledger, transaction, EVM, and consensus functions.

