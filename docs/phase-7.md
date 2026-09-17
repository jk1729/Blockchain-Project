# Phase 7: PDSChain Native Solidity Smart Contracts + EVM Execution

## Executive Summary

In **Phase 7**, PDSChain achieves a major architectural milestone by integrating **genuine Solidity smart contracts** executed within an embedded **Ethereum Virtual Machine (EVM)** runtime, while strictly preserving the **12-validator Federated Byzantine Agreement (FBA) consensus topology**, **Ed25519 native cryptographic identities**, and the **zero-cryptocurrency / zero-fee permissioned governance model**.

Rather than utilizing an external public blockchain or synthetic mock wrappers, PDSChain embeds `@ethereumjs/vm` directly into its node architecture. PDSChain transactions of type `CONTRACT_CALL` are cryptographically signed using Ed25519 keys, staged in the mempool, executed deterministically in copy-on-write EVM snapshots by all 12 validators independently, voted on via FBA quorum slices (3-of-4 slices, 9-of-12 global threshold), and finalized with cryptographically verifiable `ConsensusCertificate`s, deterministic `EVMReceipt`s, `receiptsRoot`, and composite `stateRoot`s.

> [!IMPORTANT]
> **PDSChain enforces ZERO cryptocurrency, ZERO native gas token, ZERO transaction fees, and ZERO PoW/PoS.**
> Gas is utilized strictly as an execution resource cap and deterministic loop watchdog (maximum 1,000,000 gas per transaction; 10,000,000 gas per block) to prevent out-of-gas exploits and denial-of-service halting.

---

## 1. System Architecture: 5-Layer Permissioned Stack

```text
┌─────────────────────────────────────────────────────────────────────────┐
│                        1. APPLICATION LAYER                             │
│  Beneficiaries | Fair Price Shops | Warehouses | PDS Portal & UI        │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │ REST / RPC API
┌────────────────────────────────────▼────────────────────────────────────┐
│                        2. BLOCKCHAIN CORE                               │
│  Ed25519 Transactions | Mempool | Blocks | Merkle Roots | State Root    │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │ Identity Bridge & Tx Dispatch
┌────────────────────────────────────▼────────────────────────────────────┐
│                        3. EXECUTION LAYER                               │
│  ExecutionEngine | Rules | Copy-on-Write EVM State | EVMReceipts        │
│  Solidity Contracts: PDSRegistry, Beneficiary, Shop, Inventory, Dist.  │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │ Candidate Proposal & State Roots
┌────────────────────────────────────▼────────────────────────────────────┐
│                        4. CONSENSUS LAYER                               │
│  12 Institutional Validators | 3-of-4 Quorum Slices | 9/12 Threshold    │
│  Independent EVM Simulation | Signed Votes | ConsensusCertificate       │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │ Node-to-Node Gossip / RPC
┌────────────────────────────────────▼────────────────────────────────────┐
│                        5. NETWORK LAYER                                 │
│  Validator HTTP Mesh | Proposal Broadcast | Peer Liveness               │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Native Solidity Smart Contracts

The smart contracts reside in `contracts/contracts/` and are compiled using Hardhat targeting **Solidity `0.8.24`** with IR-based code generation (`viaIR: true`) and the **Cancun EVM**:

### 2.1 Core Governance & Access Control
- [`AccessControl.sol`](file:///d:/Blockchain%20Project/contracts/contracts/core/AccessControl.sol): OpenZeppelin-compatible role-based permissioning with `DEFAULT_ADMIN_ROLE`, `INSPECTOR_ROLE`, `SHOP_ROLE`, and `WAREHOUSE_ROLE`.
- [`PDSRegistry.sol`](file:///d:/Blockchain%20Project/contracts/contracts/core/PDSRegistry.sol): The master system registry managing contract address lookups and an emergency circuit breaker (`pause()` / `unpause()`).

### 2.2 Domain Registries
- [`BeneficiaryRegistry.sol`](file:///d:/Blockchain%20Project/contracts/contracts/registry/BeneficiaryRegistry.sol): Stores pseudonymous beneficiary profiles (`bytes32`/string anonymized IDs, socioeconomic category: AAY/BPL/APL, family size, active status). **Strictly zero personally identifiable information (PII) is stored on-chain**.
- [`ShopRegistry.sol`](file:///d:/Blockchain%20Project/contracts/contracts/registry/ShopRegistry.sol): Registers authorized Fair Price Shops (FPS), their assigned operator EVM address, operational status, and geographic coordinates.
- [`WarehouseRegistry.sol`](file:///d:/Blockchain%20Project/contracts/contracts/registry/WarehouseRegistry.sol): Registers regional buffer warehouses, storage capacity, and designated warehouse managers.
- [`CommodityRegistry.sol`](file:///d:/Blockchain%20Project/contracts/contracts/registry/CommodityRegistry.sol): Authorizes essential food grains (Rice, Wheat, Sugar, Coarse Grains) and standard units (KG, L).

### 2.3 Inventory & Distribution Engine
- [`InventoryManager.sol`](file:///d:/Blockchain%20Project/contracts/contracts/inventory/InventoryManager.sol): Enforces strict inventory accounting across warehouses and shops. Requires warehouse manager or admin signatures for intake and transfers; prevents negative balances and unauthorized stock deductions.
- [`EntitlementManager.sol`](file:///d:/Blockchain%20Project/contracts/contracts/inventory/EntitlementManager.sol): Calculates monthly family food grain allowances deterministically based on socioeconomic category, family size, and time periods (`YYYY-MM`). Tracks quota consumption and rejects double-claiming.
- [`DistributionManager.sol`](file:///d:/Blockchain%20Project/contracts/contracts/distribution/DistributionManager.sol): Coordinates the atomic end-to-end grain disbursement workflow. Validates shop authorization, beneficiary eligibility, monthly quota availability, and shop inventory; performs simultaneous quota consumption and stock deduction; and emits immutable `RationDistributed` event logs.

---

## 3. Embedded EVM Runtime Adapter (`backend/src/evm/`)

PDSChain embeds `@ethereumjs/vm` directly within the Node.js runtime environment without requiring external Geth or Ganache processes.

### 3.1 Components
- [`EVMRuntime.js`](file:///d:/Blockchain%20Project/backend/src/evm/EVMRuntime.js): Manages the VM instance, chain ID (`1729`), contract deployment bootstrapping, view call dispatcher, and state execution.
- [`EVMStateAdapter.js`](file:///d:/Blockchain%20Project/backend/src/evm/EVMStateAdapter.js): Provides copy-on-write state checkpointing (`checkpoint()`), atomic rollback (`revert()`), and finalized commits (`commit()`). Computes the deterministic 32-byte `evmStateRoot`.
- [`ContractRegistry.js`](file:///d:/Blockchain%20Project/backend/src/evm/ContractRegistry.js): Dynamically loads compiled Hardhat artifacts (`artifacts/contracts/`), bytecode, and ABIs, mapping contract names to deterministic addresses.
- [`ABIEncoder.js`](file:///d:/Blockchain%20Project/backend/src/evm/ABIEncoder.js): High-performance ABI encoding, function return data decoding, log parsing, custom error decoding, and BigInt JSON sanitation.
- [`ExecutionGasPolicy.js`](file:///d:/Blockchain%20Project/backend/src/evm/ExecutionGasPolicy.js): Enforces hard transaction gas limits (`1,000,000` gas) and block gas limits (`10,000,000` gas). Throws `GasLimitExceededError` if violated.
- [`EVMReceipt.js`](file:///d:/Blockchain%20Project/backend/src/evm/EVMReceipt.js): Structured execution receipt with `status` (`SUCCESS` | `REVERT`), `gasUsed`, `logs`, `revertReason`, and deterministic `receiptHash`.
- [`identityBridge.js`](file:///d:/Blockchain%20Project/backend/src/evm/identityBridge.js): Maps native PDSChain identities (Ed25519 `PDS1...` addresses and entity IDs like `FPS-101`, `ADMIN`, `VAL-01`) to deterministic 20-byte EVM addresses (`0x...`).

---

## 4. Cryptographic Identity Bridge

PDSChain maintains a strict cryptographic distinction between transaction authorization and smart contract context:

1. **Transaction Signing**: Authoritative digital signatures are created with **Ed25519** private keys over canonical transaction serializations.
2. **Deterministic Address Derivation**:
   ```javascript
   const hash = crypto.createHash('sha256')
     .update(`PDSCHAIN_EVM_ADDR_V1:${normalizedIdentifier}`, 'utf8')
     .digest('hex');
   const evmAddress = `0x${hash.substring(0, 40).toLowerCase()}`;
   ```
3. **Execution Context**: Inside the EVM, `msg.sender` reflects the derived 20-byte address of the verified signer. Solidity access control checks evaluate `hasRole(ROLE, msg.sender)` against this address.

---

## 5. Transaction Lifecycle for `CONTRACT_CALL`

```text
Citizen / FPS / Admin
         │  1. Create CONTRACT_CALL payload
         ▼
Transaction Model
         │  2. Deterministically sign with Ed25519 private key
         ▼
Mempool Admission
         │  3. Validate signature, ID binding, nonce gap, and gas limits
         ▼
Block Proposer (VAL-01)
         │  4. Isolated EVM Simulation -> predict receiptsRoot & evmStateRoot
         │  5. Assemble CandidateBlockProposal & sign proposal header
         ▼
12 Institutional Validators (FBA Consensus)
         │  6. Independent EVM Simulation in isolated snapshot
         │  7. Verify: Zero reverts + receiptHash match + stateRoot match
         │  8. Emit signed ACCEPT / REJECT ValidatorVote statements
         ▼
Quorum Evaluation (Quorum.js)
         │  9. Verify 3-of-4 quorum slices & threshold (>= 9 of 12)
         ▼
Consensus Certificate
         │ 10. Construct cryptographically verifiable ConsensusCertificate
         ▼
Ledger & EVM Commit
         │ 11. Atomic SQL transaction commit + EVM commit()
         │ 12. Finalized Block appended to chain with receiptsRoot
```

---

## 6. Block Structure & State Commitments

With Phase 7, each Block incorporates both transaction Merkle commitments, consensus certificates, and EVM execution commitments:

```json
{
  "blockNumber": 6,
  "previousHash": "0x12a8...",
  "blockHash": "0x98f4...",
  "merkleRoot": "0x44cd...",
  "receiptsRoot": "0x89e2...",
  "stateRoot": "0x55ba...",
  "proposerId": "VAL-01",
  "consensusStatus": "FINALIZED",
  "consensusCertificate": {
    "version": 1,
    "proposalId": "0x7a3e...",
    "certificateHash": "a2bf1329a73692ccc09161b78263bef45605f1bebe6a717f30c1fae0acc1864e",
    "threshold": 9,
    "totalValidators": 12,
    "achieved": true,
    "validatorApprovals": [
      { "validatorId": "VAL-01", "vote": "ACCEPT", "signature": "..." },
      { "validatorId": "VAL-02", "vote": "ACCEPT", "signature": "..." }
    ]
  },
  "executionReceipts": [
    {
      "transactionId": "TXN-EVM-001",
      "contractAddress": "0x6f91...",
      "status": "SUCCESS",
      "gasUsed": 45210,
      "receiptHash": "0x39a1..."
    }
  ]
}
```

The block `stateRoot` is a SHA-256 composite commitment over:
$$\text{stateRoot} = \text{SHA256}(\text{beneficiaries} \parallel \text{shops} \parallel \text{warehouses} \parallel \text{inventory} \parallel \text{nonces} \parallel \text{evmStateRoot})$$

---

## 7. REST API Endpoints

| Method | Endpoint | Description | Auth |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/contracts` | List all 8 deployed contracts, code hashes, and `evmStateRoot` | Public |
| `GET` | `/api/contracts/:addressOrName` | Retrieve contract metadata, deployed address, and full ABI | Public |
| `GET` | `/api/contracts/:address/events` | Query decoded historical event logs for contract | Public |
| `GET` | `/api/contracts/transactions/:id/receipt` | Query deterministic EVM execution receipt by transaction ID | Public |
| `POST` | `/api/contracts/call` (`isView: true`) | Execute read-only view call without state mutation | Public / Optional |
| `POST` | `/api/contracts/call` (`isView: false`) | Submit state-changing transaction through mempool and FBA | RBAC / Signed |

---

## 8. Verification & Test Suite Summary

PDSChain maintains a 100% passing test baseline across all layers:

### 8.1 Hardhat Solidity Unit Tests (`contracts/`)
- **20 / 20 Tests Passing** (`npx hardhat test` in 2s):
  - Access control and emergency circuit breaker
  - Pseudonymous beneficiary registration (zero PII)
  - Fair Price Shop & Warehouse directory management
  - Warehouse stock receiving, transfer, and deficit prevention
  - Socioeconomic entitlement quota calculations and custom overrides
  - Atomic grain distribution with balance and quota deductions

### 8.2 Backend Integration & Regression Suites (`backend/`)
- **270 / 270 Tests Passing across 15 Test Suites** (`npm test` in 22s):
  1. `auth.test.js` (RBAC & JWT authentication)
  2. `api.test.js` (REST endpoints)
  3. `cryptography.test.js` (Ed25519 identity & signing)
  4. `mempool.test.js` (Transaction mempool & admission)
  5. `execution.test.js` (Execution layer basics)
  6. `execution-rules.test.js` (Domain execution rules)
  7. `stateRoot.test.js` (Deterministic state hashing)
  8. `consensus.test.js` (FBA consensus core)
  9. `consensus-signatures.test.js` (Block proposals & certificates)
  10. `blockchain.test.js` (Ledger & block integrity)
  11. `transaction.test.js` (PDS transactions)
  12. `warehouse.test.js` (Logistics workflows)
  13. `evm-runtime.test.js` (**13 new tests**: VM boot, registry, ABI encoding, view calls, rollback, gas limits)
  14. `contracts-integration.test.js` (**10 new tests**: end-to-end `CONTRACT_CALL`, FBA voting, certificate, block commit, receipts)
  15. `contracts-adversarial.test.js` (**6 new tests**: calldata tampering, forged callers, state root discrepancy rejection, candidate rollback, outage tolerance)

**Total Test Coverage: 290 / 290 Tests Passing (100%)**

