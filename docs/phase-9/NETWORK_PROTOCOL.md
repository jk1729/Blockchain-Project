# PDSChain Phase 9: Network Wire Protocol & Message Specification

## 1. Overview

The PDSChain P2P network protocol is an application-specific, connection-oriented, framed binary/JSON protocol designed for low latency, determinism, and high throughput among the 12 institutional consensus nodes.

---

## 2. Framing Specification

All data sent over TCP/TLS connections is framed using a 4-byte big-endian length prefix followed by the UTF-8 encoded JSON message envelope:

```text
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                       Length (4 Bytes)                        |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                                                               |
|                 MessageEnvelope (JSON Payload)                |
|                             ...                               |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
```

- **Length**: UInt32 in Network Byte Order (Big-Endian). Represents the size of the subsequent JSON payload in bytes.
- **Maximum Length**: Configurable, default `4,194,304` bytes (4 MB).

---

## 3. MessageEnvelope Schema

Every message transmitted over the wire uses the standardized versioned `MessageEnvelope` structure:

```json
{
  "version": 1,
  "networkId": "pdschain-devnet",
  "chainId": 1729,
  "type": "VOTE",
  "senderId": "VAL-01",
  "messageId": "MSG-7177d1910338d0f7dbb1030e7a289993",
  "timestamp": 1758097632120,
  "correlationId": null,
  "payload": {
    "vote": {
      "validatorId": "VAL-01",
      "blockNumber": 4282,
      "round": 0,
      "vote": "ACCEPT",
      "signature": "0x..."
    }
  },
  "signature": null
}
```

### Envelope Fields:
- `version`: Protocol specification version integer (currently `1`).
- `networkId`: Federation network identifier (`pdschain-devnet` or `pdschain-mainnet`).
- `chainId`: EVM & Blockchain chain ID integer (`1729`).
- `type`: Enum indicating message semantics (see Wire Message Types).
- `senderId`: Originating validator identifier (e.g. `VAL-01`).
- `messageId`: Deterministic SHA-256 hash prefix (`MSG-<hex32>`) computed over the canonical serialization of the envelope.
- `timestamp`: Unix millisecond timestamp when the envelope was created.
- `correlationId`: Optional request identifier to pair asynchronous responses with requests.
- `payload`: Type-specific data object.

---

## 4. Wire Message Types

| Message Type | Direction | Description |
|---|:---:|---|
| `HANDSHAKE` | Outbound -> Inbound | Initiator sends random 32-byte cryptographic challenge nonce |
| `HANDSHAKE_ACK` | Inbound -> Outbound | Responder returns signed initiator challenge + its own counter-challenge |
| `HANDSHAKE_COMPLETE` | Outbound -> Inbound | Initiator returns signed responder challenge to finalize mutual authentication |
| `HEARTBEAT` | Bidirectional | `PING` or `PONG` message used for liveness detection and latency measurement |
| `PROPOSAL` | Proposer -> Peers | Broadcast of candidate block proposal for consensus round evaluation |
| `VOTE` | Validator -> Peers | Broadcast of signed validator prevote/commit vote for candidate block |
| `CERTIFICATE` | Validator -> Peers | Broadcast of finalized consensus certificate achieving quorum |
| `ROUND_CHANGE` | Validator -> Peers | Notification of timeout and proposed round advancement |
| `SYNC_REQUEST` | Client -> Peer | Request for missing block range (`fromHeight` to `toHeight`) |
| `SYNC_RESPONSE` | Peer -> Client | Response delivering verified blocks with their attached consensus certificates |
| `ERROR` | Bidirectional | Protocol-level error notification with standardized error codes |

