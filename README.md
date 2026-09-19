# PDSChain
## Blockchain-Based Public Distribution System

> **Academic Project & Engineering Demonstration**  
> An enterprise-grade, transparent, and cryptographically verifiable Public Distribution System (PDS) architecture featuring a **Federated Byzantine Agreement (FBA)** consensus engine with 12 institutional validator nodes, deterministic SHA-256 blockchain ledger, ACID database transactions, role-based access control, and an integrated multi-stakeholder web interface.

---

## Table of Contents
1. [Project Overview](#1-project-overview)
2. [Problem Statement](#2-problem-statement)
3. [Project Objectives](#3-project-objectives)
4. [System Architecture](#4-system-architecture)
5. [Key Features](#5-key-features)
6. [Technology Stack](#6-technology-stack)
7. [Directory Structure](#7-directory-structure)
8. [Prerequisites & Installation](#8-prerequisites--installation)
9. [Environment Configuration](#9-environment-configuration)
10. [Running the System & Multi-Process Validators](#10-running-the-system--multi-process-validators)
11. [Demo Accounts & Credentials](#11-demo-accounts--credentials)
12. [12-Validator FBA Consensus Topology & Mathematics](#12-12-validator-fba-consensus-topology--mathematics)
13. [Blockchain & Cryptographic Integrity Model](#13-blockchain--cryptographic-integrity-model)
14. [Database Schema & ACID Transaction Atomicity](#14-database-schema--acid-transaction-atomicity)
15. [Complete REST API Reference](#15-complete-rest-api-reference)
16. [Automated Test Suite (1,111/1,111 Tests Passing - 100%)](#16-automated-test-suite-11111111-tests-passing---100)
17. [Academic Scope, Assumptions & Limitations](#17-academic-scope-assumptions--limitations)
18. [License & Acknowledgments](#18-license--acknowledgments)

---

## 1. Project Overview

The **Public Distribution System (PDS)** is one of the world's largest food security and social welfare networks, responsible for distributing subsidized food grains (rice, wheat, sugar, pulses, kerosene) to hundreds of millions of eligible citizens through regional warehouses and Fair Price Shops (FPS).

Despite its societal importance, conventional PDS implementations rely on centralized databases vulnerable to single points of failure, unauthorized data manipulation, stock diversion, phantom beneficiary allocation, and opaque reconciliation pipelines.

**PDSChain** is designed as a software-engineered, academic demonstration prototype that addresses these challenges by integrating:
- **Federated Byzantine Agreement (FBA):** A multi-validator consensus model featuring 12 institutional trust anchors (`VAL-01` to `VAL-12`) that evaluate transaction proposals using overlapping quorum slices rather than energy-intensive Proof of Work.
- **Deterministic Cryptographic Ledger:** SHA-256 block hashing, level-by-level binary Merkle root trees, and sequential `previousHash` linking to make distribution records tamper-evident.
- **ACID Database Atomicity:** Managed database transactions (via Sequelize ORM with persistent SQLite/PostgreSQL support) that guarantee zero partial stock deductions or orphaned ledger entries on validation or consensus failure.
- **Strict Role-Based Access Control (RBAC):** Cryptographic password hashing (`bcryptjs`) and JSON Web Token (`JWT`) authentication across 5 system roles (`ADMIN`, `SHOP`, `WAREHOUSE`, `CITIZEN`, `VALIDATOR`).
- **35-Page Frontend Client:** A modular vanilla JavaScript prototype communicating directly with the backend REST API through a centralized API client (`frontend/js/api.js`).

---

## 2. Problem Statement

Traditional centralized grain allocation and distribution systems face systemic operational and architectural vulnerabilities:

1. **Vulnerability to Internal Tampering:** Centralized database administrators or compromised credentials can alter stock figures or distribution records retroactively without leaving cryptographic audit trails.
2. **Grain Leakage & Stock Diversion:** Discrepancies between warehouse dispatches and shop receipts are difficult to detect in real time without atomic double-entry verification.
3. **Ghost / Duplicate Allocations:** Lack of immediate debounce protection and multi-stakeholder consensus allows rapid duplicate claims or quota overdrafts.
4. **Inefficient Public Verification:** Beneficiaries and independent oversight organizations lack direct mechanisms to cryptographically verify ration distribution receipts against a live immutable chain.
5. **Centralized Single Point of Trust:** Reliance on a single central server eliminates institutional checks and balances between state commissions, civil logistics, citizen forums, and independent auditors.

---

## 3. Project Objectives

- **Cryptographic Traceability:** Maintain an immutable, ordered sequence of grain distribution blocks where each block seals the SHA-256 Merkle root of verified transactions.
- **Automated Tamper Detection:** Provide instant verification endpoints (`GET /api/blockchain/validate`) that detect data modifications, broken hash links, or invalid sequence heights.
- **FBA Consensus Simulation:** Model institutional checks and balances using 12 distributed validator nodes with mathematically verified quorum slice intersection algorithms.
- **Transactional Atomicity:** Ensure that beneficiary quota deductions, shop inventory deductions, FBA consensus rounds, and block persistence succeed together or roll back completely.
- **Role Separation:** Enforce strict RBAC boundaries so that citizens cannot trigger stock movements, shop owners cannot fabricate administrative quotas, and warehouses cannot bypass transfer authorizations.
- **Interactive Multi-Process Telemetry:** Support both unified single-process execution and multi-process HTTP micro-servers (ports `4001`–`4012`) for live consensus visualization.

---

## 4. System Architecture

```mermaid
flowchart TD
    subgraph ClientLayer ["Frontend Client Layer (35 HTML Pages / Vanilla JS)"]
        UI_Admin["Admin Dashboard<br/>(admin.html)"]
        UI_Shop["Shop Distribution Stepper<br/>(distribution.html)"]
        UI_WH["Warehouse Transfers<br/>(transfers.html)"]
        UI_Citizen["Citizen Portal & Quota<br/>(citizen.html)"]
        UI_Val["Validator Telemetry & Quorum<br/>(validator.html / quorum.html)"]
        UI_Explorer["Blockchain Explorer<br/>(blockchain.html)"]
        API_Client["Central REST API Client<br/>(frontend/js/api.js)"]
    end

    subgraph APILayer ["Backend Application Layer (Express.js - Port 3000)"]
        SecurityHeaders["Security Headers Middleware<br/>(nosniff, DENY, XSS)"]
        AuthMiddleware["JWT Authentication & RBAC Guard<br/>(authMiddleware / roleMiddleware)"]
        Controllers["Express Route Controllers<br/>(Auth, Beneficiary, Shop, Warehouse, Transaction, Blockchain, Validator)"]
        TxService["Transaction Service<br/>(Atomic Orchestration & Debounce)"]
        InvService["Inventory & Transfer Service"]
    end

    subgraph ConsensusLayer ["FBA Consensus Layer (12 Institutional Nodes)"]
        FBACoordinator["FBA Consensus Engine<br/>(FBAConsensus.js)"]
        QuorumAlgorithm["Quorum Pruning Algorithm<br/>(findQuorum in Quorum.js)"]
        
        subgraph MultiProcessNodes ["12 HTTP Validator Micro-Servers (Ports 4001 - 4012)"]
            V1["VAL-01: Ministry of Consumer Affairs (:4001)"]
            V2["VAL-02: National Informatics Centre (:4002)"]
            V3["VAL-03: State Food Commission (:4003)"]
            V4["VAL-04: Civil Supplies Corporation (:4004)"]
            V5["VAL-05: District Administration Node (:4005)"]
            V6["VAL-06: Auditor General Observer Node (:4006)"]
            V7["VAL-07: Public Audit & Governance Node (:4007)"]
            V8["VAL-08: Regional Warehouse Authority (:4008)"]
            V9["VAL-09: Fair Price Shop Union Node (:4009)"]
            V10["VAL-10: State Monitoring Cell (:4010)"]
            V11["VAL-11: Citizen Oversight Organisation (:4011)"]
            V12["VAL-12: Security & Cryptography Board (:4012)"]
        end
    end

    subgraph LedgerLayer ["Cryptographic Blockchain Engine"]
        BlockEngine["Block Engine (Block.js)"]
        MerkleEngine["Binary Merkle Tree (hashing.js)"]
        HashChain["SHA-256 Previous-Hash Linkage"]
        ValidatorService["Chain Validator (validation.js)"]
    end

    subgraph PersistenceLayer ["Database & Storage Layer (ACID Transactions)"]
        SequelizeORM["Sequelize ORM Layer"]
        ManagedTx["Managed ACID Transaction Scope (sequelize.transaction)"]
        SQLiteDB["SQLite Persistent Storage<br/>(database/pdschain.sqlite)"]
        PGDB["PostgreSQL (Optional via DATABASE_URL)"]
    end

    %% Connections
    UI_Admin & UI_Shop & UI_WH & UI_Citizen & UI_Val & UI_Explorer --> API_Client
    API_Client -->|HTTP REST / JSON / Bearer JWT| SecurityHeaders
    SecurityHeaders --> AuthMiddleware
    AuthMiddleware --> Controllers
    Controllers --> TxService & InvService
    
    TxService -->|1. Enforce ACID Scope| ManagedTx
    TxService -->|2. Request Proposal Agreement| FBACoordinator
    FBACoordinator -->|HTTP POST /proposal| MultiProcessNodes
    MultiProcessNodes -->|Signed Statements| FBACoordinator
    FBACoordinator --> QuorumAlgorithm
    
    QuorumAlgorithm -->|3. Quorum Verified (>= 9 Nodes)| BlockEngine
    BlockEngine --> MerkleEngine --> HashChain
    
    ManagedTx --> SequelizeORM
    SequelizeORM --> SQLiteDB & PGDB
    BlockEngine -->|Persist Block| SequelizeORM
```

---

## 5. Key Features

### Blockchain Ledger
- **Deterministic SHA-256 Hashing:** Header hash calculated over `blockNumber`, `previousHash`, `timestamp`, `merkleRoot`, `nonce`, and `consensusStatus`.
- **Level-by-Level Binary Merkle Trees:** Computes a 64-character root hash over transaction leaves with odd-element duplication.
- **Previous-Hash Cryptographic Chaining:** Genesis Block #0 initialized with 64 zeroes; every subsequent block references the previous block's hash.
- **Tamper Detection (`GET /api/blockchain/validate`):** Verifies all block hashes, Merkle roots, sequential numbers, and parent pointers across the entire chain.
- **Block Persistence:** Every confirmed block is persisted in the database `Blocks` table and synced into memory upon server startup.

### Federated Byzantine Agreement (FBA) Consensus
- **12 Institutional Validators:** Realistic stakeholder representation (`VAL-01` to `VAL-12`).
- **Mathematical Quorum Slices:** Each validator defines a trust slice of 4 peers with a threshold of $k=3$.
- **Iterative Quorum Pruning (`findQuorum`):** Evaluates agreeing nodes and prunes nodes whose slice thresholds cannot be satisfied.
- **Global Consensus Requirement:** A transaction proposal is accepted only when a valid quorum forms with $|U| \ge 9$ (75% institutional agreement).
- **Multi-Process HTTP Micro-Servers:** Standalone HTTP validator servers on ports `4001` through `4012` communicating via `/proposal`, `/vote`, and `/status`.
- **In-Process Fallback:** Zero-config automated test execution when separate validator processes are offline.

### PDS Logistics & Atomicity
- **Atomic Ration Distribution:** Managed Sequelize transaction encapsulates beneficiary entitlement check, shop stock validation, FBA consensus, block creation, and inventory deduction.
- **Atomic Warehouse Transfers:** Transfers stock between warehouses and shops with atomic source deduction and destination credit.
- **Duplicate Debounce Protection:** In-memory request caching blocks identical rapid distribution requests within a 5-second window.
- **Synthetic Entity Data:** Seeded with 100 beneficiaries, 20 Fair Price Shops, 5 warehouses, 5 commodities, and 125 inventory records.

### Security & Access Control
- **Password Security:** Salted password hashing using `bcryptjs` (10 rounds); passwords stripped from responses.
- **JWT Authentication:** Cryptographically signed tokens with configurable expiration (24 hours).
- **Strict 5-Role RBAC:** Dedicated authorization guards for `ADMIN`, `SHOP`, `WAREHOUSE`, `CITIZEN`, and `VALIDATOR`.
- **HTTP Security Headers:** `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `X-XSS-Protection: 1; mode=block`, and `Referrer-Policy: strict-origin-when-cross-origin`.
- **Payload Sanitization:** Express body parser bounded to `1mb`.

---

## 6. Technology Stack

| Layer | Technologies | Purpose |
| :--- | :--- | :--- |
| **Backend Runtime** | Node.js (v18+), Express.js (v4.21) | REST API routing, middleware, controllers, services |
| **Database & ORM** | Sequelize (v6.37), SQLite3 (v5.1), `pg` (v8.13) | Dual-dialect relational database with ACID transactions |
| **Cryptography** | Node.js native `crypto`, `bcryptjs` (v2.4) | SHA-256 block hashing, Merkle trees, password hashing |
| **Authentication** | `jsonwebtoken` (v9.0) | Stateless Bearer token issuance and RBAC verification |
| **Testing Framework** | Jest (v29.7), Supertest (v7.0) | Automated unit, integration, and endpoint testing |
| **Frontend UI** | HTML5, Vanilla JavaScript (ES6+), CSS3 | 35 responsive pages, modal dialogs, real API binding |
| **Icons & Fonts** | Bootstrap Icons (v1.11), Google Fonts (Inter, IBM Plex Mono) | Visual styling, badges, and monospace ledger formatting |

---

## 7. Directory Structure

```
BlockChain---Project/
├── backend/
│   ├── src/
│   │   ├── app.js                          # Express app configuration, security headers & CORS
│   │   ├── server.js                       # Server bootstrap, DB sync, auto-seed & listen
│   │   ├── config/
│   │   │   ├── env.js                      # Environment variable loader with fallbacks
│   │   │   └── database.js                 # Sequelize PostgreSQL / SQLite connector
│   │   ├── models/                         # Sequelize Data Models
│   │   │   ├── User.js                     # User accounts & RBAC roles
│   │   │   ├── Beneficiary.js              # Citizen entitlements & monthly quotas
│   │   │   ├── Shop.js                     # Fair Price Shops registry
│   │   │   ├── Warehouse.js                # Regional grain warehouses & silos
│   │   │   ├── Commodity.js                # Rice, Wheat, Sugar, Pulses, Kerosene
│   │   │   ├── Inventory.js                # Facility stock allocations
│   │   │   ├── StockTransfer.js            # Inter-facility warehouse-to-shop logs
│   │   │   ├── Transaction.js              # Grain distribution records
│   │   │   ├── Block.js                    # Persisted blockchain blocks
│   │   │   ├── Validator.js                # 12 Validator node identities & trust slices
│   │   │   └── index.js                    # Model associations & registry
│   │   ├── middleware/
│   │   │   ├── authMiddleware.js           # JWT Bearer token authentication
│   │   │   ├── roleMiddleware.js           # Strict role authorization guard
│   │   │   ├── validationMiddleware.js     # Payload validation helper
│   │   │   └── errorMiddleware.js          # Centralized structured JSON error handler
│   │   ├── services/
│   │   │   ├── authService.js              # Registration, bcrypt login & JWT signing
│   │   │   ├── entitlementService.js       # Citizen quota evaluation
│   │   │   ├── inventoryService.js         # Shop inventory & warehouse stock transfers
│   │   │   ├── transactionService.js       # Atomic PDS distribution pipeline
│   │   │   ├── blockchainService.js        # Chain querying, block creation & sync
│   │   │   ├── validatorService.js         # Validator status management & telemetry
│   │   │   └── consensusService.js         # FBA consensus rounds coordinator
│   │   ├── blockchain/
│   │   │   ├── Block.js                    # Block class (SHA-256 header hash & mining)
│   │   │   ├── Blockchain.js               # Blockchain ledger manager & DB sync
│   │   │   ├── hashing.js                  # SHA-256 & binary Merkle root tree calculations
│   │   │   └── validation.js               # Block & chain cryptographic verification
│   │   ├── consensus/
│   │   │   ├── ValidatorNode.js            # Validator node state & vote signing
│   │   │   ├── QuorumSlice.js              # Quorum slice definition & threshold evaluator
│   │   │   ├── Quorum.js                   # Iterative quorum search algorithm
│   │   │   ├── FBAConsensus.js             # FBA consensus coordinator (HTTP & in-process)
│   │   │   └── consensusConfig.js          # 12 institutional validator configurations
│   │   ├── validators/
│   │   │   ├── validatorServer.js          # Standalone HTTP validator micro-server factory
│   │   │   ├── startValidators.js          # Multi-process 12-node launcher (ports 4001-4012)
│   │   │   └── schemas.js                  # Request body schemas
│   │   ├── controllers/                    # 10 Express controllers for REST endpoints
│   │   ├── routes/                         # 10 modular route definitions & /api/health
│   │   ├── seed/
│   │   │   ├── seedData.js                 # Synthetic dataset definitions
│   │   │   └── seedDatabase.js             # Repeatable DB & blockchain seeding script
│   │   └── utils/
│   │       ├── logger.js                   # Structured logging utility
│   │       ├── errors.js                   # Operational HTTP error classes
│   │       └── ids.js                      # Non-colliding unique ID generators
│   ├── tests/                              # 6 Comprehensive Jest Test Suites (47 Tests)
│   │   ├── api.test.js                     # REST endpoint integration tests
│   │   ├── auth.test.js                    # Auth & RBAC access control tests
│   │   ├── warehouse.test.js               # Warehouse stock transfer tests
│   │   ├── transaction.test.js             # Atomic PDS distribution & quota tests
│   │   ├── consensus.test.js               # 12-node FBA quorum & failure tests
│   │   └── blockchain.test.js              # Blockchain hashing & tampering tests
│   ├── .env.example                        # Environment template
│   ├── .env                                # Local environment configuration
│   └── package.json                        # Backend npm dependencies & scripts
│
├── frontend/
│   ├── html/                               # 35 HTML Pages
│   │   ├── index.html                      # System landing & architecture overview
│   │   ├── login.html, register.html       # Authentication & user registration
│   │   ├── blockchain.html                 # Blockchain Explorer & live re-verification
│   │   ├── transaction.html                # Cryptographic transaction lookup
│   │   ├── profile.html, settings.html     # User profile & system settings
│   │   ├── admin/                          # 7 Admin views (beneficiaries, shops, silos, etc.)
│   │   ├── shop/                           # 5 Fair Price Shop views (distribution stepper)
│   │   ├── warehouse/                      # 5 Warehouse views (stock transfers)
│   │   ├── citizen/                        # 4 Citizen Portal views (entitlement meters)
│   │   └── validator/                      # 4 Validator views (quorum visualizer & telemetry)
│   ├── css/                                # Modular stylesheets (style, dashboard, blockchain, etc.)
│   └── js/                                 # Client scripts (api.js, auth.js, blockchain.js, etc.)
│
├── database/
│   └── pdschain.sqlite                     # Persistent zero-config SQLite database file
├── README.md                               # Root project documentation manual
└── .gitignore                              # Git ignore rules
```

---

## 8. Prerequisites & Installation

### Prerequisites
- **Node.js:** `v18.0.0` or newer (Tested up to `v24.20.0`)
- **npm:** `v9.0.0` or newer (Tested up to `v11.19.0`)
- **Modern Web Browser:** Chrome, Firefox, Edge, or Safari with JavaScript enabled

### Installation
Clone the repository and install dependencies inside the `backend/` directory:

```bash
git clone https://github.com/your-username/BlockChain---Project.git
cd BlockChain---Project/backend
npm install
```

---

## 9. Environment Configuration

The backend reads configuration settings from `backend/.env`. A template is provided in `backend/.env.example`.

```bash
cp .env.example .env
```

### Environment Variables Reference

| Variable | Default Value | Description |
| :--- | :--- | :--- |
| `PORT` | `3000` | Port for the main Express backend API server |
| `NODE_ENV` | `development` | Environment mode (`development`, `production`, `test`) |
| `DATABASE_URL` | *(Empty)* | Optional PostgreSQL connection string. If unset or empty, SQLite is used |
| `DATABASE_STORAGE` | `../database/pdschain.sqlite` | Path to persistent SQLite database file |
| `JWT_SECRET` | `pdschain_dev_super_secret_jwt_key_2026` | Secret key used for signing JWT authentication tokens |
| `JWT_EXPIRES_IN` | `24h` | Token expiration duration |
| `BLOCKCHAIN_DIFFICULTY` | `2` | Number of leading zeroes required for block mining |
| `VALIDATOR_COUNT` | `12` | Total number of institutional FBA validator nodes |
| `CORS_ORIGIN` | `http://localhost:3000` | Allowed CORS origins for client requests (comma-separated for multiple) |

### Production Security Requirements
When `NODE_ENV=production`:
- **`JWT_SECRET` Strict Enforcement:** The application strictly enforces that `JWT_SECRET` must be set, cannot match the known development default (`pdschain_dev_super_secret_jwt_key_2026` or variants), and must be at least 32 characters in length. Server startup will terminate immediately if a weak or default key is detected.
- **`CORS_ORIGIN` Strict Enforcement:** Wildcard origin (`*`) is strictly forbidden in production mode. Explicit domain origins (e.g. `https://pdschain.gov.in`) must be supplied.
- **Token Transport:** Authentication tokens are exclusively accepted via standard HTTP `Authorization: Bearer <token>` headers. Transporting JWTs via URL query parameters (`?token=...`) is strictly rejected with HTTP 401 across all protected routes.
- **Client-Side Demo Login Gating:** Client-side demo fallback login is restricted exclusively to development/test environments on `localhost` or `127.0.0.1` and requires explicit activation (`window.PDSCHAIN_CONFIG.DEMO_MODE === true`). It is completely disabled on any external or production hostname.

### Database Configuration
- **SQLite (Default & Verified):** Zero-configuration relational database stored at `database/pdschain.sqlite`. Complete schema migrations, ACID transaction boundaries, rollback behavior, and outbox event journaling are 100% verified against SQLite. All automated test suites use isolated temporary SQLite databases in `%TEMP%/pdschain-test-isolated/` to guarantee repository data safety.
- **PostgreSQL (Optional Support):** PDSChain includes full Sequelize dialect configuration and connection pooling for PostgreSQL via `DATABASE_URL` (e.g., `postgres://user:password@localhost:5432/pdschain`).
  > [!IMPORTANT]
  > **Database Verification Status:**  
  > SQLite is fully tested and verified across all 132 test suites and live application workflows.  
  > **PostgreSQL runtime verification is not completed.** (No local PostgreSQL daemon was active in the local testing environment. The PostgreSQL configuration and driver stack are preserved as designed).

---

## 10. Running the System & Multi-Process Validators

### 1. Seed the Database
Populate the database with the verified synthetic dataset (100 beneficiaries, 20 shops, 5 warehouses, 5 commodities, 125 inventory items, 12 validators, and genesis/initial blocks):

```bash
npm run seed
```

### 2. Start the Express Backend Server
```bash
# Production execution
npm start

# Development mode (with auto-reload on file changes)
npm run dev
```
The server will start at `http://localhost:3000`.

### 3. Accessing the Application & Frontend Portals
The Express backend directly serves all frontend interfaces and static assets:
- **Landing Page & Overview:** `http://localhost:3000/` (or `http://localhost:3000/index.html`)
- **Login Portal:** `http://localhost:3000/login.html`
- **Admin Dashboard:** `http://localhost:3000/admin/`
- **Fair Price Shop Portal:** `http://localhost:3000/shop/`
- **Warehouse Logistics Portal:** `http://localhost:3000/warehouse/`
- **Citizen Entitlements Portal:** `http://localhost:3000/citizen/`
- **Validator Telemetry & Quorum:** `http://localhost:3000/validator/`
- **Blockchain Explorer:** `http://localhost:3000/explorer/`
- **Health Probes:** `http://localhost:3000/health` (Kubernetes-grade aggregate health)
- **Prometheus Metrics:** `http://localhost:3000/metrics`

### 4. (Optional) Launch the 12 Distributed HTTP Validator Micro-Servers
To run the 12 validator nodes as independent HTTP processes communicating over loopback ports `4001` through `4012`:

```bash
# In a separate terminal window:
npm run validators:start
```

### 5. Run the Automated Test Suites
Execute the full test suites across both backend and smart contracts:

```bash
# Backend test suite (132 test suites, 1,091 tests)
cd backend
npm test

# Solidity smart contract test suite (20 tests)
cd ../contracts
npx hardhat test
```

---

## 11. Demo Accounts & Credentials

The database seed initializes 5 pre-configured demo user accounts covering all roles:

| Role | Username | Password | Assigned Entity | Default Landing Page |
| :--- | :--- | :--- | :--- | :--- |
| **Administrator** | `admin` | `admin123` | System Master | `frontend/html/admin/admin.html` |
| **Fair Price Shop** | `shop` | `shop123` | `FPS-102` (Central Bazaar) | `frontend/html/shop/shop.html` |
| **Warehouse Officer** | `warehouse` | `warehouse123` | `WH-003` (Grain Silo) | `frontend/html/warehouse/warehouse.html` |
| **Citizen Beneficiary**| `citizen` | `citizen123` | `BEN-1024` (Arun Kumar) | `frontend/html/citizen/citizen.html` |
| **FBA Validator Node** | `validator` | `validator123` | `VAL-07` (Audit Node) | `frontend/html/validator/validator.html` |

---

## 12. 12-Validator FBA Consensus Topology & Mathematics

### Institutional Node Topology & Port Map

| Node ID | Institutional Stakeholder | HTTP Port | Quorum Slice Members | Threshold |
| :--- | :--- | :---: | :--- | :---: |
| `VAL-01` | Ministry of Consumer Affairs | `4001` | `VAL-01`, `VAL-02`, `VAL-03`, `VAL-04` | 3 of 4 |
| `VAL-02` | National Informatics Centre (NIC) | `4002` | `VAL-02`, `VAL-03`, `VAL-05`, `VAL-06` | 3 of 4 |
| `VAL-03` | State Food Commission | `4003` | `VAL-01`, `VAL-03`, `VAL-07`, `VAL-08` | 3 of 4 |
| `VAL-04` | Civil Supplies Corporation | `4004` | `VAL-01`, `VAL-04`, `VAL-09`, `VAL-10` | 3 of 4 |
| `VAL-05` | District Administration Node | `4005` | `VAL-02`, `VAL-05`, `VAL-07`, `VAL-11` | 3 of 4 |
| `VAL-06` | Auditor General Observer Node | `4006` | `VAL-02`, `VAL-06`, `VAL-08`, `VAL-12` | 3 of 4 |
| `VAL-07` | Public Audit & Governance Node | `4007` | `VAL-03`, `VAL-05`, `VAL-07`, `VAL-09` | 3 of 4 |
| `VAL-08` | Regional Warehouse Authority | `4008` | `VAL-03`, `VAL-06`, `VAL-08`, `VAL-10` | 3 of 4 |
| `VAL-09` | Fair Price Shop Union Node | `4009` | `VAL-04`, `VAL-07`, `VAL-09`, `VAL-11` | 3 of 4 |
| `VAL-10` | State Monitoring Cell | `4010` | `VAL-04`, `VAL-08`, `VAL-10`, `VAL-12` | 3 of 4 |
| `VAL-11` | Citizen Oversight Organisation | `4011` | `VAL-05`, `VAL-09`, `VAL-11`, `VAL-12` | 3 of 4 |
| `VAL-12` | Security & Cryptography Board | `4012` | `VAL-06`, `VAL-10`, `VAL-11`, `VAL-12` | 3 of 4 |

### Mathematical Quorum Logic & Equations

1. **Quorum Slice:** For any validator node $v \in V$, its configured slice $\mathcal{S}(v) \subseteq V$ is satisfied by a candidate set $U \subseteq V$ if:
   $$|\mathcal{S}(v) \cap U| \ge \text{threshold}(v) \quad (k = 3)$$

2. **Quorum Definition:** A set $U \subseteq V$ is a valid quorum if and only if $U$ is non-empty and every member $v \in U$ has its slice satisfied within $U$:
   $$\forall v \in U, \quad |\mathcal{S}(v) \cap U| \ge 3$$

3. **Iterative Pruning Algorithm (`findQuorum`):**
   - Start with candidate agreeing nodes $U_0 = \text{agreeingNodes}$.
   - At iteration $t+1$, remove any node $v$ for which $|\mathcal{S}(v) \cap U_t| < 3$.
   - Repeat until $U_{t+1} = U_t$.

4. **Global Institutional Consensus Rule:**
   $$\text{Consensus Status} = \begin{cases} \text{ACHIEVED}, & \text{if } U \text{ is a valid Quorum and } |U| \ge 9 \\ \text{FAILED}, & \text{otherwise} \end{cases}$$

### Empirical Fault Tolerance Matrix

| Online Validators | Pruned Quorum Size $|U|$ | Consensus Status | Resulting Transaction Outcome |
| :---: | :---: | :---: | :--- |
| **12 of 12** | 12 | **ACHIEVED** | Transaction committed, Block mined |
| **11 of 12** (`VAL-07` Offline) | 11 | **ACHIEVED** | Transaction committed, Block mined |
| **10 of 12** (`VAL-05`, `VAL-06` Offline) | 9 | **ACHIEVED** | Transaction committed, Block mined |
| **9 of 12** (`VAL-05`, `VAL-06`, `VAL-07` Offline) | 8 | **FAILED** | Transaction rejected, Zero state change |
| **8 of 12** (`VAL-05`, `VAL-06`, `VAL-07`, `VAL-08` Offline) | 5 | **FAILED** | Transaction rejected, Zero state change |

---

## 13. Blockchain & Cryptographic Integrity Model

### Block Header Composition
Each block computes its SHA-256 digest deterministically over 6 header fields:
$$\text{blockHash} = \text{SHA256}(\text{blockNumber} \mathbin{\Vert} \text{previousHash} \mathbin{\Vert} \text{timestamp} \mathbin{\Vert} \text{merkleRoot} \mathbin{\Vert} \text{nonce} \mathbin{\Vert} \text{consensusStatus})$$

### Binary Merkle Root Generation
1. Each transaction payload is serialized into a deterministic canonical string:
   $$\text{Leaf}_i = \text{SHA256}(\text{transactionId} : \text{beneficiaryId} : \text{shopId} : \text{commodity} : \text{quantity} : \text{timestamp})$$
2. Adjacent pairs are concatenated and hashed iteratively:
   $$\text{Parent}_{j} = \text{SHA256}(\text{Leaf}_{2j} \mathbin{\Vert} \text{Leaf}_{2j+1})$$
   *(If a level has an odd number of hashes, the last element is duplicated).*
3. The root hash is stored in the block's `merkleRoot` attribute.

### Tamper Detection Algorithm
The `validateChain()` function inspects the ledger in sequence:
1. Re-computes `calculateMerkleRoot(transactions)` and compares against `block.merkleRoot`.
2. Re-computes `calculateHash()` and compares against `block.blockHash`.
3. Verifies that $\text{blockNumber}_i == \text{blockNumber}_{i-1} + 1$.
4. Verifies that $\text{previousHash}_i == \text{blockHash}_{i-1}$.
5. Returns `{ isValid: true, blockCount: N }` on success, or `{ isValid: false, reason, brokenBlockIndex }` on tampering.

---

## 14. Database Schema & ACID Transaction Atomicity

### Sequelize Model Relationships
- `User` $\leftrightarrow$ `Role` (`ADMIN`, `SHOP`, `WAREHOUSE`, `CITIZEN`, `VALIDATOR`)
- `Beneficiary` belongs to `Shop` (`assignedShopId`)
- `Inventory` polymorphic owner mapping (`ownerType`: `SHOP` | `WAREHOUSE`, `ownerId`: ID)
- `StockTransfer` links `sourceWarehouseId` and `targetShopId`
- `Transaction` links `beneficiaryId`, `shopId`, and references `blockNumber` / `blockHash`
- `Block` stores serialized transaction payloads and validator signature lists

### ACID Transaction Guarantees
During a ration distribution:
```javascript
await sequelize.transaction(async (t) => {
  // 1. Lock & check beneficiary monthly entitlement quota
  // 2. Lock & check shop inventory stock availability
  // 3. Coordinate 12-validator FBA consensus round
  // 4. Create block and compute SHA-256 hash & Merkle root
  // 5. Deduct shop stock & increment beneficiary distributed quota
  // 6. Persist Block and Transaction records
});
```
If any check fails (e.g. quota exceeded, insufficient stock, or consensus failure), Sequelize issues an automatic `ROLLBACK`, guaranteeing zero orphan records or partial stock deductions.

---

## 15. Complete REST API Reference

### System & Bootstrap
| Method | Endpoint | Auth Required | Role | Purpose |
| :--- | :--- | :---: | :---: | :--- |
| `GET` | `/api/health` | No | Public | Returns service status, DB health, chain height, validator count |
| `GET` | `/api/data` | No | Public | Complete bootstrap snapshot (beneficiaries, shops, warehouses, chain) |

### Authentication
| Method | Endpoint | Auth Required | Role | Purpose |
| :--- | :--- | :---: | :---: | :--- |
| `POST` | `/api/auth/register` | No | Public | Register new user account (defaults to `CITIZEN`) |
| `POST` | `/api/auth/login` | No | Public | Authenticate with username and password, returns JWT token |
| `GET` | `/api/auth/me` | Yes | Any | Returns authenticated user profile |

### Beneficiaries
| Method | Endpoint | Auth Required | Role | Purpose |
| :--- | :--- | :---: | :---: | :--- |
| `GET` | `/api/beneficiaries` | Yes | Any | List beneficiaries with `search`, `region`, and `status` filters |
| `GET` | `/api/beneficiaries/:id` | Yes | Any | Retrieve single beneficiary details and quota metrics |
| `POST` | `/api/beneficiaries` | Yes | `ADMIN` | Register new citizen beneficiary |
| `PUT` | `/api/beneficiaries/:id` | Yes | `ADMIN` | Update beneficiary status or household size |

### Shops & Warehouses
| Method | Endpoint | Auth Required | Role | Purpose |
| :--- | :--- | :---: | :---: | :--- |
| `GET` | `/api/shops` | Yes | Any | List all 20 Fair Price Shops |
| `GET` | `/api/shops/:id` | Yes | Any | Retrieve shop details |
| `GET` | `/api/shops/:id/inventory`| Yes | Any | Query shop commodity stock levels |
| `POST`| `/api/shops/:id/inventory`| Yes | `SHOP`, `WAREHOUSE`, `ADMIN` | Replenish or adjust shop stock |
| `GET` | `/api/warehouses` | Yes | Any | List all 5 grain warehouses and silos |
| `GET` | `/api/warehouses/:id` | Yes | Any | Retrieve warehouse details |
| `POST`| `/api/warehouses/:id/transfer`| Yes | `WAREHOUSE`, `ADMIN` | Execute atomic warehouse-to-shop stock transfer |

### Transactions & Distribution
| Method | Endpoint | Auth Required | Role | Purpose |
| :--- | :--- | :---: | :---: | :--- |
| `GET` | `/api/transactions` | Yes | Any | Query transactions with search, commodity, and status filters |
| `GET` | `/api/transactions/:id` | Yes | Any | Retrieve single transaction record |
| `POST` | `/api/transactions` | Yes | `SHOP`, `ADMIN` | Execute atomic PDS ration distribution with FBA consensus |

### Blockchain Ledger
| Method | Endpoint | Auth Required | Role | Purpose |
| :--- | :--- | :---: | :---: | :--- |
| `GET` | `/api/blockchain` | No | Public | Returns complete blockchain array, difficulty, and block count |
| `GET` | `/api/blockchain/blocks` | No | Public | List all mined blocks |
| `GET` | `/api/blockchain/blocks/:number` | No | Public | Retrieve specific block by block number |
| `GET` | `/api/blockchain/transactions/:txId` | No | Public | Look up on-chain transaction by transaction ID |
| `GET` | `/api/blockchain/validate` | No | Public | Cryptographically verify all SHA-256 hashes and Merkle roots |

### Validators & Consensus
| Method | Endpoint | Auth Required | Role | Purpose |
| :--- | :--- | :---: | :---: | :--- |
| `GET` | `/api/validators` | No | Public | List all 12 institutional validator nodes and statuses |
| `GET` | `/api/validators/:id` | No | Public | Retrieve validator trust configuration and quorum slice |
| `POST` | `/api/validators/:id/status`| Yes | `VALIDATOR`, `ADMIN` | Toggle node status (`Online`, `Offline`, `Degraded`) |
| `GET` | `/api/consensus/status` | No | Public | Returns current active network quorum status |
| `GET` | `/api/consensus/quorum` | No | Public | Returns trust graph and recent consensus rounds |
| `POST` | `/api/consensus/round` | Yes | `VALIDATOR`, `ADMIN` | Manually trigger a standalone consensus round |

### Smart Contracts & EVM Execution
| Method | Endpoint | Auth Required | Role | Purpose |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/contracts` | No | Public | List all 8 deployed Solidity contracts, code hashes, and EVM state root |
| `GET` | `/api/contracts/:addressOrName` | No | Public | Fetch contract details, deployed address, bytecode, and ABI |
| `GET` | `/api/contracts/:address/events` | No | Public | Query decoded historical events for contract |
| `GET` | `/api/contracts/transactions/:id/receipt` | No | Public | Query deterministic EVM execution receipt by transaction ID |
| `POST` | `/api/contracts/call` | Optional | Public / RBAC | Execute view call (isView: true) or submit state-changing tx via FBA |

### Role Dashboards
| Method | Endpoint | Auth Required | Role | Purpose |
| :--- | :--- | :---: | :---: | :--- |
| `GET` | `/api/dashboard/admin` | Yes | `ADMIN` | Administrative metrics, system counters, node health |
| `GET` | `/api/dashboard/shop` | Yes | `SHOP`, `ADMIN` | Shop inventory, dispatches, beneficiary counts |
| `GET` | `/api/dashboard/citizen` | Yes | `CITIZEN`, `ADMIN`| Citizen monthly entitlement meters and transaction logs |
| `GET` | `/api/dashboard/warehouse` | Yes | `WAREHOUSE`, `ADMIN`| Warehouse silo capacity and stock utilization |
| `GET` | `/api/dashboard/validator` | Yes | `VALIDATOR`, `ADMIN`| Validator node votes, height, and participation rate |

---

## 16. Automated Test Suite (1,111/1,111 Tests Passing - 100%)

The PDSChain test suite delivers comprehensive, end-to-end verification across every architectural layer, combining unit, integration, adversarial, failover, and performance test suites:

### Test Suite Execution Summary

```
================================================================================
                                PDSCHAIN TEST SUITE
================================================================================
  Layer / Component                  Suites    Tests    Passing    Pass Rate
--------------------------------------------------------------------------------
  Hardhat Smart Contracts (`contracts/`)  1       20       20         100%
  Backend Application (`backend/`)       132    1,091    1,091         100%
--------------------------------------------------------------------------------
  TOTAL                                  133    1,111    1,111         100%
================================================================================
```

### 1. Hardhat Solidity Smart Contract Tests (`contracts/`)
- **20 / 20 Tests Passing** (`npx hardhat test`):
  - System registry initialization and multi-role access control (`DEFAULT_ADMIN_ROLE`, `OPERATOR_ROLE`, `VALIDATOR_ROLE`).
  - Emergency circuit breaker (pausing and unpausing state-changing calls).
  - Pseudonymous citizen registration with zero on-chain personally identifiable information (PII).
  - Fair Price Shop and Regional Warehouse registry lifecycle.
  - Warehouse stock intake, inter-facility transfer, and deficit prevention.
  - Periodic socioeconomic grain entitlement quota tracking and custom overrides.
  - Atomic grain distribution with balance and quota deductions.
  - Rejection of distributions exceeding quotas, insufficient shop inventory, unauthorized operators, or paused contract state.

### 2. Backend Integration & Layer Test Suites (`backend/`)
- **1,091 / 1,091 Tests Passing across 132 Test Suites** (`npm test`):
  - **Security, Authentication & Gating (10 Suites):** JWT secret strength enforcement in production, strict CORS policy with wildcard rejection, removal of tokens from URL query strings, client-side demo mode domain gating, XSS sanitization across all frontend DOM renderers, IDOR/BOLA scope enforcement, RPC method authorization, and secret redaction from logs.
  - **Consensus & Federated Byzantine Agreement (18 Suites):** 12 institutional validator initialization, mathematical quorum slice pruning, crash-fault tolerance (VAL-05 and VAL-06 offline), Byzantine double-voter detection, colluding validator isolation, consensus certificate issuance, proposer timeout advancement, and write-ahead consensus journaling.
  - **Blockchain Ledger & Cryptographic Proofs (14 Suites):** Genesis block anchoring, SHA-256 header hashing, previous-hash chaining, binary Merkle tree root computation, level-by-level Merkle proof generation and browser verification, second-preimage collision resistance, state root hashing, and tamper detection.
  - **Transaction Mempool & Execution Engine (12 Suites):** Transaction admission validation, nonce sequencing, Ed25519 digital signature verification, simulation execution, atomic state transition commits, and gas limit enforcement.
  - **EVM Runtime & Smart Contract Integration (8 Suites):** In-memory Ethereum Virtual Machine bootstrap, contract registry, ABI encoding/decoding, read-only view calls, state-changing `CONTRACT_CALL` execution through FBA consensus, receipt generation, and candidate revert rollback.
  - **Database Migrations, ACID Atomicity & HA (16 Suites):** Database initialization, zero-loss rollback on failure, transactional outbox consistency, same-ID collision detection, denial audit logging with SHA-256 hash chains, primary-replica lag tracking, and writer fencing.
  - **P2P Networking & Transport (10 Suites):** Peer challenge-response handshake, mutual TLS (mTLS) encrypted channel establishment, peer whitelist and certificate revocation lists (CRL), and protocol version negotiation.
  - **Observability & Health Probes (12 Suites):** Kubernetes liveness (`/health/live`), readiness (`/health/ready`), startup (`/health/startup`), and aggregate (`/health`) probes, W3C distributed tracing propagation, structured logging with secret masking, Prometheus metrics export (`/metrics`), SLO evaluation, and alert rule triggers.
  - **Adversarial Failure Simulations (18 Suites):** Bounded attack sandboxes, database corruptions, crash recovery, peer network partitions, Byzantine injection, secret privacy audits, and RPO/RTO validation.
  - **Performance & Load Testing (14 Suites):** Workload registry, rate-controlled arrival pacing, bounded memory concurrency, response time histogram aggregation, and automated SLO regression detection.

```
Test Suites: 132 passed, 132 total
Tests:       1091 passed, 1091 total
Snapshots:   0 total
Time:        98.379 s
Ran all test suites.
```

---

## 17. Academic Scope, Assumptions & Limitations

### 1. Verified Architecture vs. Local Simulations
- **Verified Locally (100% Operational):**
  - Full Express.js REST API with 10 modular controllers and 5 role-based dashboards.
  - Complete 12-validator Federated Byzantine Agreement consensus engine with quorum slice pruning and threshold evaluation.
  - Deterministic SHA-256 blockchain ledger with binary Merkle trees and state root tracking.
  - ACID database transactions and outbox event journaling backed by SQLite.
  - 35-page responsive vanilla HTML/CSS/JavaScript frontend directly served at `http://localhost:3000`.
  - Cryptographic password hashing (`bcryptjs`), JWT token authentication, and strict 5-role RBAC.
  - Kubernetes health probes (`/health`) and Prometheus metrics export (`/metrics`).
  - Solidity smart contract suite compiled and verified with Hardhat.
- **Local Simulations & Sandbox Scope:**
  - The 12 institutional validator nodes execute within the local environment (in-process or via loopback micro-servers on `127.0.0.1:4001`–`4012`). This models institutional voting dynamics and fault tolerance without requiring a distributed cloud WAN.
  - Attack, failure, and performance testing execute within isolated temporary sandbox directories (`tmp-sim-*`, `tmp-perf-*`) using synthetic identities.
- **PostgreSQL Support Status:**
  > [!IMPORTANT]
  > The codebase includes complete dialect support and connection pooling for PostgreSQL via `DATABASE_URL`. However, because no external PostgreSQL database daemon was running in the local evaluation environment:  
  > **PostgreSQL runtime verification is not completed.**  
  > The application operates seamlessly and deterministically on its default SQLite database engine (`database/pdschain.sqlite`).

### 2. Synthetic Data Notice
All citizen identities, Aadhaar references, Fair Price Shop profiles, and warehouse inventories in the seed dataset are entirely **fictional and synthetic**. No real personally identifiable information (PII) is stored or processed.

### 3. Proof-of-Work vs. FBA Consensus
The system utilizes Federated Byzantine Agreement (FBA) for institutional transaction validation and block finality. The lightweight mining difficulty (`difficulty: 2`) is included solely for visual proof-of-work simulation in the frontend UI and does not substitute for the mandatory 75% validator quorum agreement.

---

## 18. License & Acknowledgments

This project is developed as an academic software engineering and blockchain project for transparent food security distribution.
- **License:** ISC License
- **Author:** PDSChain Engineering Team

---
*For additional test traces and verification logs, refer to the [Walkthrough Artifact](file:///C:/Users/JK/.gemini/antigravity/brain/9821513d-09f2-4dcb-8f2a-75d65d552594/walkthrough.md).*
