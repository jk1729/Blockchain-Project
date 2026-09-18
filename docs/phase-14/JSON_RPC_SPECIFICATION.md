# PDSChain Phase 14: JSON-RPC 2.0 Specification

## 1. Protocol Architecture & Endpoints

PDSChain exposes a JSON-RPC 2.0 compliant interface mounted across:
- `POST /rpc`
- `POST /rpc/v1`
- `POST /api/v1/rpc`

### 1.1 Protocol Constraints
- **Transport**: HTTP `POST` only (`GET`, `PUT`, `DELETE` return `405 Method Not Allowed`).
- **Content-Type**: `application/json` required (`415 Unsupported Media Type` on non-JSON).
- **Batch Processing**: Supported up to a maximum of 20 requests per batch.
- **Payload Limit**: 1 MB maximum request body size.
- **Secret Redaction**: All returned parameters, receipts, logs, and error details undergo recursive secret redaction.

---

## 2. Standard & Custom Error Codes

| Error Code | Name | Description |
|---|---|---|
| `-32700` | `PARSE_ERROR` | Invalid JSON was received by the server. |
| `-32600` | `INVALID_REQUEST` | The JSON sent is not a valid Request object or exceeds batch limits. |
| `-32601` | `METHOD_NOT_FOUND` | The method does not exist or is not registered. |
| `-32602` | `INVALID_PARAMS` | Invalid method parameter(s). |
| `-32603` | `INTERNAL_ERROR` | Internal JSON-RPC execution error. |
| `-32000` | `EXECUTION_ERROR` | EVM contract execution reverted or runtime error. |
| `-32001` | `RESOURCE_NOT_FOUND` | Requested block, transaction, receipt, or account not found. |
| `-32002` | `TRANSACTION_REJECTED` | Nonce conflict, insufficient balance, or invalid signature. |
| `-32003` | `CONSENSUS_SYNC_ERROR` | Node is currently synchronizing or consensus is degraded. |
| `-32004` | `RATE_LIMIT_EXCEEDED` | Request frequency exceeds sliding-window rate limits. |
| `-32005` | `UNAUTHORIZED` | Request requires authenticated consortium participant credentials. |

---

## 3. Method Specifications

### 3.1 Blockchain Methods

#### `pds_blockNumber`
Returns the integer height of the most recently verified and committed block.
- **Parameters**: `[]`
- **Returns**: `number` (e.g. `17`)

#### `pds_getBlockByNumber`
Retrieves block details by height or tag.
- **Parameters**:
  1. `string | number`: Block sequence number or tag (`"latest"`, `"earliest"`).
  2. `boolean`: If `true`, returns full transaction objects; if `false`, returns transaction hashes.
- **Returns**: `Block` object or `null`.

#### `pds_getBlockByHash`
Retrieves block details by 32-byte SHA-256 block hash.
- **Parameters**:
  1. `string`: 32-byte hex block hash.
  2. `boolean`: Include full transaction objects.
- **Returns**: `Block` object or `null`.

#### `pds_getBlockTransactionCountByNumber`
- **Parameters**: `[number | string]` (Block height or tag).
- **Returns**: `number` (Transaction count in block).

#### `pds_validateChain`
Performs cryptographic verification of the local ledger.
- **Parameters**: `[]`
- **Returns**: `{ isValid: boolean, blockCount: number }`

---

### 3.2 Transaction Methods

#### `pds_getTransactionByHash`
Looks up transaction in committed blocks, mempool, or ledger storage.
- **Parameters**: `[string]` (Transaction hash or transaction ID).
- **Returns**: `Transaction` object or `null`. Includes `finality: 'PENDING' | 'COMMITTED' | 'FINALIZED'`.

#### `pds_getTransactionReceipt`
Returns execution receipt containing gas consumed, status, and event logs.
- **Parameters**: `[string]` (Transaction hash).
- **Returns**: `Receipt` object or `null`.

#### `pds_sendRawTransaction`
Submits signed transaction payload into the transaction mempool.
- **Parameters**: `[object | string]` (Signed transaction payload).
- **Returns**: `string` (Transaction hash / identifier).

#### `pds_estimateGas`
Estimates gas required for transaction execution.
- **Parameters**: `[object]` (Transaction candidate call object).
- **Returns**: `number` (Gas estimate in units).

---

### 3.3 Smart Contract Methods

#### `pds_call`
Executes a read-only EVM smart contract method without modifying ledger state.
- **Parameters**:
  1. `object`: `{ to: string, method?: string, args?: any[], data?: string, from?: string }`
  2. `string`: Block tag (default `"latest"`).
- **Returns**: Return data (decoded value or `0x` hex string).

#### `pds_getCode`
Returns contract bytecode at given address.
- **Parameters**: `[string]` (20-byte contract address).
- **Returns**: `string` (`0x` hex bytecode).

#### `pds_getLogs`
Queries contract event logs.
- **Parameters**:
  1. `object`: `{ address?: string, fromBlock?: number, toBlock?: number, topics?: string[] }`
- **Returns**: Array of log entries with `topics` and decoded `args`.

---

### 3.4 Consensus & Validator Methods

#### `pds_getValidators`
Returns directory of 12 consortium validators with operational statuses.
- **Parameters**: `[]`
- **Returns**: Array of validator objects.

#### `pds_getConsensusStatus`
Returns real-time FBA consensus status, quorum health, and validator counts.
- **Parameters**: `[]`
- **Returns**: `{ model: string, validatorsCount: number, onlineValidators: number, hasQuorum: boolean, quorumPercentage: number }`

#### `pds_getQuorum`
Returns quorum slice configurations and recent consensus rounds.
- **Parameters**: `[]`
- **Returns**: `{ networkStatus, slices, recentRounds }`

#### `pds_propose`
Submits block proposal to FBA consensus engine (requires authenticated consortium participant).
- **Parameters**: `[object]` (Candidate proposal).
- **Returns**: Consensus result summary.

---

### 3.5 Network, Sync & Node Methods

#### `pds_getNetworkStatus`
Returns P2P network configuration, protocol version, TLS status, and peer counts.
- **Parameters**: `[]`

#### `pds_getPeers`
Returns connected authenticated P2P peers.
- **Parameters**: `[]`

#### `pds_getSyncStatus`
Returns ledger synchronization state and current block height.
- **Parameters**: `[]`

#### `pds_nodeInfo`
Returns client version (`"PDSChain/v1.0.0/node"`), chainId (`1729`), and uptime.
- **Parameters**: `[]`

#### `pds_health`
Returns aggregate health of storage, consensus, and EVM subsystems.
- **Parameters**: `[]`

