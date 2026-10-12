# PDSChain — Testing Strategy, Commands & Verification Procedures

## 1. Test Suite Architecture

PDSChain uses an isolated multi-tier verification architecture:
1. **Backend Unit, Integration, Adversarial & Chaos Test Suites (`backend/tests/`)**:
   - **134 Jest test suites** (`1,109+` assertions) executing in isolated temporary SQLite databases (`os.tmpdir()/pdschain-test-isolated/pdschain-test.sqlite`) so tests never corrupt or overwrite the live runtime ledger (`database/pdschain.sqlite`).
2. **Solidity Smart Contract Test Suite (`contracts/test/PDSContracts.test.js`)**:
   - **20 Hardhat tests** verifying role access control, emergency pause circuit breaker, zero-PII beneficiary registration, warehouse stock transfers, entitlement quota calculations, and atomic ration distribution.
3. **Real Browser End-to-End Verification (Chrome DevTools Protocol)**:
   - Automated headless/visible Google Chrome E2E verification driving all 6 portals, 37 HTML pages, login/logout flows, route guards, and EVM contract calls with zero console errors and zero network failures.

---

## 2. Exact Test Commands

### A. Run All Backend Tests (Jest)
Because `@ethereumjs/vm` and `@ethereumjs/statemanager` use ESM modules, Node.js requires `--experimental-vm-modules` (configured automatically in `backend/package.json`):
```bash
cd backend
npm test
```
Direct invocation for a single test file:
```bash
cd backend
node --experimental-vm-modules node_modules/jest/bin/jest.js tests/blockchain.test.js --runInBand --detectOpenHandles --forceExit
```

### B. Run Solidity Smart Contract Tests (Hardhat)
```bash
cd contracts
npx hardhat test
```

### C. Verify Live Blockchain Integrity via API
With the backend server running on port `3000`:
```bash
curl -s http://localhost:3000/api/blockchain/validate
```
Expected response:
```json
{
  "success": true,
  "isValid": true,
  "reason": null,
  "brokenBlockIndex": null
}
```

---

## 3. Adversarial & Security Test Coverage

| Test Suite | Verified Guarantees |
| :--- | :--- |
| `tests/blockchain.test.js` | Block hash recomputation, Merkle root tampering detection, previous-hash link breakage detection. |
| `tests/merkle-security-adversarial.test.js` | Proof depth bounds, malformed hex rejection, second-preimage domain separation (`0x00`/`0x01`), flood protection. |
| `tests/consensus-safety-adversarial.test.js` | Equivocation rejection, forged validator vote rejection, `< 9/12` quorum failure enforcement. |
| `tests/auth.test.js` & `tests/frontend-security-auth-xss.test.js` | Privilege escalation prevention, JWT enforcement, XSS payload neutralization, logout session destruction. |
| `tests/database-durability-recovery.test.js` | Atomic transaction rollback on error, WAL crash recovery, state root consistency across restarts. |
| `tests/evm-contracts.test.js` | Embedded Cancun EVM deployment, ABI call execution, and deterministic `evmStateRoot` anchoring. |

