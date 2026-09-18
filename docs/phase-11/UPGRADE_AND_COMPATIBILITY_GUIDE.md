# PDSChain Phase 11: Upgrade, Versioning & Compatibility Guide

## 1. Versioning Architecture

PDSChain distinguishes between three distinct version layers:
1. **Application Version**: Semantic version of the node binary/package (e.g. `1.0.0`).
2. **Wire Protocol Version**: Version of the framing codecs, envelope headers, and message types (current: `1`).
3. **EVM & Consensus Hard Fork Version**: Hard fork rules (current: `Cancun` EVM, Chain ID `1729`).

---

## 2. Protocol Version Negotiation

When two validator daemons initiate a P2P handshake, `VersionNegotiator` (`backend/src/utils/versionNegotiator.js`) evaluates protocol version compatibility:

- **Supported Range**: Protocol Version $1 \le V \le 2$.
- **Downward Negotiation**: If Node A supports version 2 and Node B supports version 1, both nodes negotiate down to version 1.
- **Obsolete Versions**: Versions $< 1$ are rejected with an explicit `obsolete` reason.
- **Unsupported Future Versions**: Versions $> 2$ are rejected to prevent unvetted consensus divergence.

---

## 3. Storage & Migration Compatibility

### Checkpoints
- Checkpoints support schema versioning (`checkpoint.version`).
- `VersionNegotiator.isFormatCompatible(record)` validates that legacy unversioned checkpoints and version 1 checkpoints are handled transparently.
- Future unsupported format versions trigger upgrade-required alarms.

### Database Migrations
- SQLite schemas are verified at startup before mounting.
- Backups should be taken using `BackupManager.createBackup()` prior to performing any binary upgrade.

---

## 4. Safe Rolling Upgrade Procedure

Consortium members can perform rolling node upgrades without interrupting consensus:
1. **Quorum Safety Margin**: In a 12-validator network requiring 9-of-12 quorum, up to 3 validators can be offline simultaneously without halting consensus.
2. **Upgrade Batching**:
   - Upgrade validators in batches of 1 or 2 nodes at a time (e.g., `VAL-01` and `VAL-02`).
   - Stop daemon: `systemctl stop pdschain-validator@VAL-01`.
   - Update binary / container image.
   - Restart daemon: `systemctl start pdschain-validator@VAL-01`.
   - Poll readiness: `curl -s http://localhost:4001/health/consensus`.
   - Once the upgraded node transitions to `CURRENT`, proceed to the next batch.

