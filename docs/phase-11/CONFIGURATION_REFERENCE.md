# PDSChain Phase 11: Production Configuration Reference

## 1. Overview

PDSChain validators are configured via `ValidatorConfig` (`backend/src/config/validatorConfig.js`). Configuration can be provided through:
1. **JSON Configuration Files**: Specified via `VALIDATOR_CONFIG_FILE` or `ValidatorConfig.fromFile(filePath)`.
2. **Environment Variables**: Overriding file settings.
3. **CLI Arguments**: Provided to the entrypoint.
4. **Consortium Defaults**: Sourced from `consensusConfig.js` for development and testing.

All parameters are strictly validated prior to daemon boot. Invalid parameters cause the daemon to fail closed with a descriptive `ConfigurationError`.

---

## 2. Configuration Parameters

| Parameter | Type | Default | Required in Prod | Description |
| :--- | :--- | :--- | :--- | :--- |
| `VALIDATOR_ID` | String | `VAL-01` | **Yes** | Unique institutional identifier (format: `VAL-XX` or `TEST-VAL-*`). |
| `NODE_ENV` | String | `development` | **Yes** | Runtime environment (`development`, `test`, `staging`, `production`). |
| `INSTITUTION_NAME` | String | Sourced from `consensusConfig.js` | No | Human-readable name of the participating organization. |
| `OPERATOR_NAME` | String | `PDSChain Federation` | No | Operational department or consortium custodian. |
| `NETWORK_ID` | String | `pdschain-devnet` (dev) / `pdschain-mainnet` (prod) | **Yes** | Protocol network tag. Devnet tags are rejected in production mode. |
| `CHAIN_ID` | Integer | `1729` | **Yes** | Canonical EVM Chain ID (1729). Must match the network. |
| `PROTOCOL_VERSION` | Integer | `1` | **Yes** | P2P framing and wire protocol version. |
| `P2P_HOST` | String | `127.0.0.1` | **Yes** | Network interface on which the P2P wire socket listens (`0.0.0.0` for all). |
| `P2P_PORT` | Integer | `5001` - `5012` | **Yes** | TCP/TLS port for authenticated peer-to-peer consensus communication. |
| `P2P_ADVERTISED_HOST`| String | Defaults to `P2P_HOST` | Recommended | Publicly accessible IP address or DNS name advertised to remote peers. |
| `P2P_ADVERTISED_PORT`| Integer | Defaults to `P2P_PORT` | Recommended | Publicly accessible port advertised to remote peers behind NAT. |
| `P2P_USE_TLS` | Boolean | `false` | Recommended | Whether P2P connections enforce TLS transport wrappers. |
| `API_HOST` | String | `127.0.0.1` | No | Interface for HTTP management, health probes, and metrics. |
| `API_PORT` | Integer | `4001` - `4012` | **Yes** | Port for HTTP management API. Cannot collide with `P2P_PORT`. |
| `DATA_DIR` | String | `database/validators/{id}` | **Yes** | Root directory for all isolated persistent storage. |
| `IDENTITY_PATH` | String | `{DATA_DIR}/identity.json`| **Yes (in prod)** | Absolute or relative path to the protected Ed25519 identity keypair file. |
| `DATABASE_STORAGE` | String | `{DATA_DIR}/pdschain.sqlite` | No | Path to SQLite database file. |
| `CONSENSUS_JOURNAL` | String | `{DATA_DIR}/consensus_journal.jsonl` | No | Path to write-ahead consensus journal. |
| `LEDGER_CHECKPOINT` | String | `{DATA_DIR}/checkpoints/checkpoint.json` | No | Path to canonical cryptographic checkpoint file. |
| `MAX_FRAME_SIZE` | Integer | `4194304` (4 MB) | No | Maximum streaming frame size (bounds: 1 KB to 64 MB). |
| `MAX_QUEUE_SIZE` | Integer | `1000` | No | Inbound message queue buffer limit. |
| `MAX_PEERS` | Integer | `32` | No | Maximum concurrent peer connections. |
| `CONNECTION_TIMEOUT`| Integer | `5000` (5s) | No | Socket connection timeout in milliseconds. |
| `SHUTDOWN_TIMEOUT` | Integer | `5000` (5s) | No | Maximum grace period for background tasks to flush during shutdown. |
| `LOG_LEVEL` | String | `info` | No | Minimum logging severity (`debug`, `info`, `warn`, `error`). |
| `LOG_FORMAT` | String | `text` (dev) / `json` (prod) | No | Output format for application logs. |

---

## 3. Sample Production Configuration File (`validator.json`)

```json
{
  "validatorId": "VAL-01",
  "nodeEnv": "production",
  "institutionName": "Ministry of Consumer Affairs",
  "operatorName": "Government of India",
  "networkId": "pdschain-mainnet",
  "chainId": 1729,
  "protocolVersion": 1,
  "listenHost": "0.0.0.0",
  "listenPort": 5001,
  "advertisedHost": "validator1.pdschain.gov.in",
  "advertisedPort": 5001,
  "apiHost": "127.0.0.1",
  "apiPort": 4001,
  "dataDir": "/var/lib/pdschain/VAL-01",
  "identityPath": "/var/lib/pdschain/VAL-01/identity.json",
  "useTLS": true,
  "logLevel": "info",
  "logFormat": "json",
  "peers": [
    { "validatorId": "VAL-02", "host": "validator2.pdschain.gov.in", "port": 5002 },
    { "validatorId": "VAL-03", "host": "validator3.pdschain.gov.in", "port": 5003 },
    { "validatorId": "VAL-04", "host": "validator4.pdschain.gov.in", "port": 5004 }
  ]
}
```

---

## 4. Diagnostics & Secret Redaction

To prevent credentials, private keys, or passwords from appearing in diagnostics or Prometheus endpoints, `config.toSafeObject()` strips all secret material before emitting state dumps. Any attempt to query configuration via APIs returns sanitized metadata only.

