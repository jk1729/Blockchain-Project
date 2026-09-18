/**
 * PDSChain Checkpoint Manager (Phase 10)
 * 
 * Manages atomic disk persistence, crash-safe updates, and integrity verification
 * for cryptographic ledger checkpoints.
 */

const fs = require('fs');
const path = require('path');
const LedgerCheckpoint = require('./LedgerCheckpoint');
const logger = require('../../utils/logger');

class CheckpointManager {
  /**
   * @param {object} [options]
   * @param {string} [options.filepath]
   * @param {boolean} [options.inMemoryOnly=false]
   */
  constructor(options = {}) {
    this.inMemoryOnly = options.inMemoryOnly || false;
    this.filepath = options.filepath || path.resolve(process.cwd(), 'database', 'checkpoint.json');
    this.latestCheckpoint = null;
    this.checkpointHistory = []; // In-memory cache of recent checkpoints

    if (!this.inMemoryOnly) {
      try {
        const dir = path.dirname(this.filepath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        this._recoverOrCleanTempFiles();
        this.load();
      } catch (err) {
        logger.warn(`[CheckpointManager] Filesystem unwritable (${err.message}); falling back to in-memory mode`);
        this.inMemoryOnly = true;
      }
    }
  }

  /**
   * Inspect and clean up any interrupted writes (.tmp files)
   * @private
   */
  _recoverOrCleanTempFiles() {
    const tmpPath = `${this.filepath}.tmp`;
    if (fs.existsSync(tmpPath)) {
      try {
        logger.warn(`[CheckpointManager] Detected incomplete checkpoint write artifact: ${tmpPath}. Cleaning up.`);
        fs.unlinkSync(tmpPath);
      } catch (e) {
        logger.error(`[CheckpointManager] Failed to remove temp checkpoint file: ${e.message}`);
      }
    }
  }

  /**
   * Load existing checkpoint from disk
   * @returns {LedgerCheckpoint|null}
   */
  load() {
    if (this.inMemoryOnly || !fs.existsSync(this.filepath)) {
      return this.latestCheckpoint;
    }

    try {
      const raw = fs.readFileSync(this.filepath, 'utf8').trim();
      if (!raw) return null;

      const data = JSON.parse(raw);
      const cp = LedgerCheckpoint.fromJSON(data);
      
      // Verify integrity
      if (cp.calculateHash() !== cp.checkpointHash) {
        throw new Error(`Checkpoint self-hash validation failed for height #${cp.blockHeight}`);
      }

      this.latestCheckpoint = cp;
      this.checkpointHistory.push(cp);
      return cp;
    } catch (err) {
      logger.error(`[CheckpointManager] Error loading checkpoint: ${err.message}`);
      throw err;
    }
  }

  /**
   * Atomically save a new ledger checkpoint
   * @param {LedgerCheckpoint} checkpoint 
   * @returns {LedgerCheckpoint}
   */
  saveCheckpoint(checkpoint) {
    if (!checkpoint || !(checkpoint instanceof LedgerCheckpoint)) {
      throw new Error('[CheckpointManager] Invalid checkpoint instance provided');
    }

    if (checkpoint.verificationStatus !== 'VERIFIED') {
      throw new Error(`[CheckpointManager] Cannot persist unverified checkpoint (status: '${checkpoint.verificationStatus}')`);
    }

    // Integrity check
    if (checkpoint.calculateHash() !== checkpoint.checkpointHash) {
      throw new Error('[CheckpointManager] Checkpoint self-hash mismatch; refusing to persist tampered checkpoint');
    }

    // Check against existing latest checkpoint
    if (this.latestCheckpoint) {
      // 1. Rejection of stale checkpoint
      if (checkpoint.blockHeight < this.latestCheckpoint.blockHeight) {
        throw new Error(
          `[CheckpointManager] Stale checkpoint rejected: incoming height #${checkpoint.blockHeight} is older than current #${this.latestCheckpoint.blockHeight}`
        );
      }

      // 2. Conflicting checkpoint detection at same height
      if (checkpoint.blockHeight === this.latestCheckpoint.blockHeight) {
        if (checkpoint.blockHash !== this.latestCheckpoint.blockHash) {
          throw new Error(
            `[CheckpointManager] Conflicting checkpoint detected at height #${checkpoint.blockHeight}: incoming '${checkpoint.blockHash}' vs existing '${this.latestCheckpoint.blockHash}'`
          );
        }
      }
    }

    // Atomic persistence using write-to-temp and atomic rename
    if (!this.inMemoryOnly && this.filepath) {
      const tmpPath = `${this.filepath}.tmp`;
      const jsonContent = JSON.stringify(checkpoint.toJSON(), null, 2);
      
      try {
        fs.writeFileSync(tmpPath, jsonContent, 'utf8');
        fs.renameSync(tmpPath, this.filepath); // Atomic rename on POSIX / Windows
      } catch (err) {
        // Clean up tmp on error
        try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch (_) {}
        throw new Error(`[CheckpointManager] Atomic write failed: ${err.message}`);
      }
    }

    this.latestCheckpoint = checkpoint;
    this.checkpointHistory.push(checkpoint);
    if (this.checkpointHistory.length > 20) {
      this.checkpointHistory.shift();
    }

    logger.info(`[CheckpointManager] Checkpoint #${checkpoint.blockHeight} persisted successfully (hash: ${checkpoint.blockHash.slice(0, 10)}...)`);
    return checkpoint;
  }

  getLatestCheckpoint() {
    return this.latestCheckpoint;
  }

  /**
   * Compare local latest checkpoint with a peer's advertised checkpoint
   * @param {LedgerCheckpoint|object} peerCheckpoint 
   * @returns {{ match: boolean, conflict: boolean, localHeight: number, peerHeight: number, reason?: string }}
   */
  compareWithPeer(peerCheckpoint) {
    if (!peerCheckpoint) {
      return { match: false, conflict: false, localHeight: this.latestCheckpoint ? this.latestCheckpoint.blockHeight : 0, peerHeight: 0, reason: 'Peer checkpoint is null' };
    }

    const peerHeight = parseInt(peerCheckpoint.blockHeight, 10);
    const peerHash = String(peerCheckpoint.blockHash || '').toLowerCase();
    const peerCertHash = String(peerCheckpoint.certificateHash || '').toLowerCase();

    if (!this.latestCheckpoint) {
      return { match: false, conflict: false, localHeight: 0, peerHeight, reason: 'No local checkpoint' };
    }

    const localHeight = this.latestCheckpoint.blockHeight;
    const localHash = this.latestCheckpoint.blockHash;

    if (localHeight === peerHeight) {
      if (localHash === peerHash) {
        return { match: true, conflict: false, localHeight, peerHeight };
      } else {
        return {
          match: false,
          conflict: true,
          localHeight,
          peerHeight,
          reason: `Conflicting block hash at height #${localHeight}: local '${localHash}' vs peer '${peerHash}'`
        };
      }
    }

    // If peer is at a different height, check if we have a historical checkpoint for that height
    const historical = this.checkpointHistory.find(c => c.blockHeight === peerHeight);
    if (historical) {
      if (historical.blockHash === peerHash) {
        return { match: true, conflict: false, localHeight, peerHeight, isHistorical: true };
      } else {
        return {
          match: false,
          conflict: true,
          localHeight,
          peerHeight,
          reason: `Historical fork detected at height #${peerHeight}: local '${historical.blockHash}' vs peer '${peerHash}'`
        };
      }
    }

    return { match: false, conflict: false, localHeight, peerHeight, reason: 'Different heights without history match' };
  }
}

module.exports = CheckpointManager;

