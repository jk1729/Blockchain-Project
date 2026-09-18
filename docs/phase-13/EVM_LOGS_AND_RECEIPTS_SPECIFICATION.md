# PDSChain Phase 13: EVM Logs and Receipts Specification

## 1. Overview

The Embedded EVM runtime in PDSChain executes Solidity smart contracts directly within validator processes. During contract execution, Solidity `emit` statements create EVM execution logs. Phase 13 bridges these logs into first-class `BlockchainEvent` records with decoded parameters, topics, and cryptographic linkage to block receipts.

---

## 2. Receipt Structure (`EVMReceipt`)

Every smart contract invocation produces an `EVMReceipt`:

```typescript
interface EVMReceipt {
  status: 'SUCCESS' | 'REVERT';
  transactionId: string;
  contractAddress: string;
  gasUsed: number;
  returnData: string;           // Hex return bytes (e.g. 0x...)
  revertReason?: string;        // Decoded revert string if reverted
  logs: DecodedLog[];           // Array of decoded event logs
  blockNumber: number;
  receiptHash: string;          // 0x-prefixed SHA-256 hash of receipt contents
}
```

---

## 3. Log Decoding Pipeline (`ABIEncoder.decodeLogs`)

EVM logs are extracted from EthereumJS execution results:
1. `rawLogs`: Array of tuples `[address, topics, data]` or objects `{ topics, data, address }`.
2. Topics are converted to standard `0x`-prefixed 32-byte hex strings.
3. Event signatures are matched against the contract's ABI via `ethers.Interface`.
4. Named event parameters are extracted via `Result.toObject()` or `fragment.inputs`.
5. Indexed strings/bytes (which are hashed in Ethereum logs) have their topic hashes preserved.
6. BigInt values are converted to string format for JSON serialization safety.

---

## 4. Contract Event Mapping to BlockchainEvent

When an event is logged by a contract (e.g. `CommodityRegistered`, `RationIssued`, `ShopStockUpdated`), `EVMRuntime` emits a `BlockchainEvent`:

```json
{
  "eventId": "evt_9c17e3f89028a4128f11b490d1487ca3",
  "category": "CONTRACT",
  "type": "CONTRACT_EVENT_EMITTED",
  "severity": "INFO",
  "finalityStatus": "FINALIZED",
  "blockHeight": 14,
  "txHash": "TX-COMMODITY-01",
  "contractAddress": "0x41e0fd8831d24a56368979f34e9d32a4a05cc03f",
  "source": "evm",
  "payload": {
    "contractAddress": "0x41e0fd8831d24a56368979f34e9d32a4a05cc03f",
    "eventName": "CommodityRegistered",
    "signature": "CommodityRegistered(string,string,address)",
    "args": {
      "name": "0x41e0fd8831d24a56368979f34e9d32a4a05cc03f1b2562f8ee1b8d46a324d0ff",
      "unit": "KG",
      "registeredBy": "0x5A2e1D3e93d36781B519A827BF0582d0342B802e"
    },
    "rawTopics": [
      "0x41e0fd8831d24a56368979f34e9d32a4a05cc03f1b2562f8ee1b8d46a324d0ff",
      "0x5A2e1D3e93d36781B519A827BF0582d0342B802e000000000000000000000000"
    ],
    "rawData": "0x0000000000000000000000000000000000000000000000000000000000000020...",
    "logIndex": 0
  }
}
```

---

## 5. Contract Call Executed & Reverted

- On successful contract calls: emits `CONTRACT_CALL_EXECUTED` with gas accounting and method name.
- On reverted calls: emits `CONTRACT_CALL_FAILED` with `revertReason` (decoded via ABI Error/Panic selectors).
- On view calls: zero state mutation occurs; executed in an isolated checkpoint and rolled back.

