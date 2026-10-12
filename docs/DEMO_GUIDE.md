# PDSChain — Faculty & Evaluator Demonstration Guide

## 1. Starting the Local Demonstration Environment

```bash
cd backend
npm start
```

Open Google Chrome to:
- **Landing Page**: `http://localhost:3000/html/index.html`
- **Login Portal**: `http://localhost:3000/html/login.html`
- **Blockchain Explorer**: `http://localhost:3000/html/explorer.html`

To reset the demonstration dataset to a clean baseline at any time (development mode only):
```bash
cd backend
npm run seed
```

---

## 2. Demo Role Accounts (Localhost Demo Environment Only)

> **Security Note**: Demo credential prefill in the login dropdown is strictly gated to `localhost` / `127.0.0.1` and disabled on external/production domains.

| Role | Username | Demo Password | Assigned Entity | Portal Destination |
| :--- | :--- | :--- | :--- | :--- |
| **Administrator** | `admin` | `admin123` | `ADMIN-HQ` | `/html/admin/admin.html` |
| **Warehouse Manager** | `warehouse` | `warehouse123` | `WH-003` (North Silo) | `/html/warehouse/warehouse.html` |
| **Fair Price Shop** | `shop` | `shop123` | `FPS-102` (Central Bazaar) | `/html/shop/shop.html` |
| **Citizen Beneficiary** | `citizen` | `citizen123` | `BEN-1024` (Arun Kumar) | `/html/citizen/citizen.html` |
| **Validator Node** | `validator` | `validator123` | `VAL-07` (CAG Audit Node) | `/html/validator/validator.html` |

---

## 3. Step-by-Step End-to-End Demonstration Workflow

### Workflow 1: Beneficiary Enrollment & Quota Recalculation (Admin)
1. Log in as **Administrator** (`admin` / `admin123`).
2. Navigate to **Beneficiaries** (`/html/admin/beneficiaries.html`).
3. Click **Add Beneficiary**, enter a citizen name, region (`Chennai Central`), and household size (`4`), and submit.
4. Observe the new beneficiary in the table with calculated monthly quota (`20kg Rice, 10kg Wheat`).
5. **Refresh the browser (`F5`)** and verify the beneficiary persists from SQLite.
6. Click **Edit**, change household size to `5`, and submit. Verify quota automatically updates to `25kg Rice, 12.5kg Wheat`.
7. Click **Sign Out** in the user menu and verify immediate redirection to `login.html`.

### Workflow 2: Warehouse-to-Shop Stock Transfer (Warehouse)
1. Log in as **Warehouse Manager** (`warehouse` / `warehouse123`).
2. Navigate to **Stock Transfers** (`/html/warehouse/transfers.html`).
3. Click **New Stock Transfer**, select destination `FPS-102`, commodity `Rice`, quantity `15 KG`, and submit.
4. Verify the transfer is signed with Ed25519, approved by 12-validator FBA consensus, and committed with status `CONFIRMED`.
5. Refresh the page and verify inventory balances and transfer records persist.

### Workflow 3: 6-Step Ration Distribution & Block Anchoring (Fair Price Shop)
1. Log in as **Fair Price Shop Dealer** (`shop` / `shop123`).
2. Navigate to **Distribution Pipeline** (`/html/shop/distribution.html`).
3. **Step 1**: Enter Beneficiary ID `BEN-1024` and click **Verify Beneficiary**.
4. **Step 2**: Select `Rice` and click **Next**.
5. **Step 3**: Enter `2` KG and click **Next**.
6. **Step 4**: Click **Submit to Blockchain**.
7. Observe the 12-validator FBA consensus animation and final **Step 6 Cryptographic Receipt** displaying the `TXN-...` ID, Block Height, Merkle Root, and State Root. Copy the `TXN-...` ID.

### Workflow 4: Independent Citizen Receipt Verification (Citizen)
1. Log in as **Citizen** (`citizen` / `citizen123`).
2. Open **Verify Receipt** (`/html/citizen/verify.html`).
3. Paste the captured `TXN-...` ID and click **Verify on Blockchain**.
4. Confirm the green **Verified on Blockchain Ledger** badge with block number and Merkle proof.
5. Test `TXN-NONEXISTENT` and confirm it is rejected with a not-found error.

### Workflow 5: Byzantine Fault Tolerance & Quorum Simulation (Validator)
1. Log in as **Validator** (`validator` / `validator123`).
2. On `/html/validator/validator.html`, click **Fail VAL-07 (Resilient)**.
3. Observe `11 / 12` nodes online and Stage 3 showing `QUORUM MET (11/12 >= 9)`.
4. Click **Fail 4 Nodes (Breach Quorum)**.
5. Observe `8 / 12` nodes online and Stage 3 turning red: `QUORUM FAILED (8/12 < 9)` and Stage 4 `REJECTED (Unfinalized)`.
6. Click **Restore 12 Nodes** to return to `12 / 12` online.

### Workflow 6: Blockchain Explorer & Live EVM Smart Contracts
1. Open `/html/explorer.html#contracts`.
2. Inspect all 8 verified Solidity `0.8.24` contracts deployed on the embedded Cancun EVM (`Chain ID 1729`).
3. Execute read-only view methods (`paused()`, `getAllContractAddresses()`) directly against the EVM state.

