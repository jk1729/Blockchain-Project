# PDSChain Phase 15: Explorer Routes and Views

## 1. Frontend Route Specifications

The explorer application uses clean hash-based routing (`window.location.hash`) supporting direct linking, bookmarking, and native browser history (back/forward navigation):

| Route | View Name | Purpose & Contents | Deep Link Example |
|---|---|---|---|
| `#overview` | **Dashboard / Overview** | Real-time chain metrics, latest block hash, validator quorum health, throughput, chain flow graph, recent blocks, and recent transactions. | `http://localhost:3000/explorer.html#overview` |
| `#blocks` | **Blocks Explorer** | Cursor-paginated list of all verified blocks with heights, hashes, parent hashes, tx counts, proposer IDs, and finality tags. | `http://localhost:3000/explorer.html#blocks` |
| `#block/:id` | **Block Inspector** | Detailed modal/view of a specific block by height or hash, including consensus certificate, 12-validator approvals, roots, and tx list. | `http://localhost:3000/explorer.html#block/4` |
| `#txs` | **Transactions Explorer** | Cursor-paginated list of all on-chain transactions with status filters, commodity amounts, and finality metadata. | `http://localhost:3000/explorer.html#txs` |
| `#tx/:id` | **Transaction Inspector**| Detailed modal/view of a transaction by ID or hash, including EVM execution receipt, gas metrics, return data, and revert reasons. | `http://localhost:3000/explorer.html#tx/TXN-004281` |
| `#addresses` | **Address Search** | Account and address lookup landing page. | `http://localhost:3000/explorer.html#addresses` |
| `#address/:addr` | **Account Profile** | Account classification (EOA, Contract, Validator, Beneficiary, Shop), balance, nonce, transaction count, and transaction history. | `http://localhost:3000/explorer.html#address/BEN-001` |
| `#contracts` | **Smart Contracts Directory** | Directory of verified native EVM smart contracts, addresses, code hashes, function counts, and event counts. | `http://localhost:3000/explorer.html#contracts` |
| `#contract/:addr`| **Contract Detail & Runner** | Deployed contract bytecode viewer, verified ABI explorer, and interactive read-only view call execution runner. | `http://localhost:3000/explorer.html#contract/0x1000...` |
| `#events` | **Events & Logs Explorer** | Filterable event journal with categories (`BLOCKCHAIN`, `TRANSACTION`, `CONTRACT`, `CONSENSUS`, `NETWORK`, `SYNC`, `RECOVERY`), SSE ticker, and JSON inspector. | `http://localhost:3000/explorer.html#events` |
| `#validators` | **Validator Directory** | 12-validator consortium node table with institution names, regions, endpoints, consensus readiness, and quorum health. | `http://localhost:3000/explorer.html#validators` |
| `#network` | **Network & Topology** | Authenticated P2P mTLS peer list, connection latency, direction (inbound/outbound), and topology structure. | `http://localhost:3000/explorer.html#network` |
| `#sync` | **Sync & Recovery Health** | Ledger synchronization progress bar, target heights, checkpoint verification, and CA trust status. | `http://localhost:3000/explorer.html#sync` |

---

## 2. Backend REST API Endpoints

### 2.1 Explorer Aggregated Endpoints (`/api/v1/explorer/...`)
- `GET /api/v1/explorer/overview`:
  - Returns chain metadata, finalized height, latest block, recent blocks, recent transactions, validator health, and throughput metrics in a single lightweight round-trip.
- `GET /api/v1/explorer/search?q=:query`:
  - Analyzes `:query` and returns categorized matching entities (`BLOCK`, `TRANSACTION`, `ADDRESS`, `CONTRACT`, `VALIDATOR`, `EVENT`).
- `GET /api/v1/explorer/address/:address`:
  - Resolves account type, balance, nonce, validator metadata (if applicable), contract metadata (if applicable), and recent transactions.
- `GET /api/v1/explorer/block/:identifier`:
  - Retrieves block details by numeric height or 64-char hexadecimal block hash.

### 2.2 Core Blockchain & Ledger Endpoints (`/api/v1/...`)
- `GET /api/v1/blockchain/blocks`: Paginated list of block records with cursor metadata.
- `GET /api/v1/blockchain/blocks/:number`: Block detail by block number.
- `GET /api/v1/blockchain/blocks/:number/consensus`: Block consensus certificate and signatures.
- `GET /api/v1/transactions`: Paginated transactions list.
- `GET /api/v1/transactions/:id`: Transaction details by ID or hash.
- `GET /api/v1/transactions/:id/receipt`: EVM execution receipt with gas and logs.
- `GET /api/v1/contracts`: Directory of deployed contracts.
- `GET /api/v1/contracts/:address`: Contract metadata and ABI.
- `POST /api/v1/contracts/call`: Read-only EVM view method simulator (`isView: true`).
- `GET /api/v1/validators`: Consortium validators list.
- `GET /api/v1/consensus/status`: Consensus engine health.
- `GET /api/v1/consensus/quorum`: Quorum slices and participation threshold.
- `GET /api/v1/network/peers`: Connected P2P peer nodes.
- `GET /api/v1/network/topology`: Network graph nodes and edges.
- `GET /api/v1/ledger/status`: Synchronization state and checkpoint status.
- `GET /api/v1/events`: Paginated event query with category and severity filters.
- `GET /api/v1/events/stream`: Real-time Server-Sent Events (SSE) stream.

