/**
 * PDSChain Sync Planner (Phase 10)
 * 
 * Orchestrates multi-peer height discovery, common-ancestor search,
 * divergence detection, and bounded batch scheduling.
 */

const { MessageEnvelope, MessageType } = require('../../network/MessageEnvelope');
const logger = require('../../utils/logger');

class SyncPlanner {
  /**
   * @param {object} params
   * @param {NetworkConfig} params.config
   * @param {PeerManager} params.peerManager
   * @param {Blockchain} params.blockchain
   * @param {LedgerSyncState} params.syncState
   * @param {CheckpointManager} [params.checkpointManager]
   * @param {number} [params.defaultBatchSize=20]
   */
  constructor(params = {}) {
    this.config = params.config;
    this.peerManager = params.peerManager;
    this.blockchain = params.blockchain;
    this.syncState = params.syncState;
    this.checkpointManager = params.checkpointManager || null;
    this.defaultBatchSize = params.defaultBatchSize || 20;

    this.failedPeers = new Set();
  }

  /**
   * Determine target synchronization height requiring agreement across multiple peers
   * @param {Map<string, number>|object} peerHeights Map of validatorId -> height
   * @param {number} [minAgreement=2] Required minimum agreeing peers for consensus safety
   * @returns {{ targetHeight: number, agreementCount: number, agreeingPeers: string[] }}
   */
  determineTargetHeight(peerHeights, minAgreement = 2) {
    const entries = peerHeights instanceof Map 
      ? Array.from(peerHeights.entries()) 
      : Object.entries(peerHeights || {});

    if (entries.length === 0) {
      const localH = this.blockchain ? this.blockchain.getLatestBlock().blockNumber : 0;
      return { targetHeight: localH, agreementCount: 0, agreeingPeers: [] };
    }

    // Tally heights reported by peers
    const heightCounts = new Map(); // height -> [peerIds]
    for (const [peerId, h] of entries) {
      const height = parseInt(h, 10) || 0;
      if (!heightCounts.has(height)) {
        heightCounts.set(height, []);
      }
      heightCounts.get(height).push(peerId);
    }

    // Sort heights descending to find highest agreed target
    const sortedHeights = Array.from(heightCounts.keys()).sort((a, b) => b - a);

    // Look for height with >= minAgreement, or fallback to highest agreement
    let bestHeight = 0;
    let maxAgreement = 0;
    let bestPeers = [];

    for (const h of sortedHeights) {
      const peers = heightCounts.get(h);
      if (peers.length >= minAgreement) {
        return {
          targetHeight: h,
          agreementCount: peers.length,
          agreeingPeers: peers
        };
      }
      if (peers.length > maxAgreement) {
        maxAgreement = peers.length;
        bestHeight = h;
        bestPeers = peers;
      }
    }

    // If only 1 peer is connected, use its height if no conflict
    if (entries.length === 1) {
      return {
        targetHeight: entries[0][1],
        agreementCount: 1,
        agreeingPeers: [entries[0][0]]
      };
    }

    return {
      targetHeight: bestHeight,
      agreementCount: maxAgreement,
      agreeingPeers: bestPeers
    };
  }

  /**
   * Divide a block height range into bounded sync batches
   * @param {number} fromHeight 
   * @param {number} toHeight 
   * @param {number} [batchSize] 
   * @returns {Array<{ batchNumber: number, fromHeight: number, toHeight: number, count: number }>}
   */
  createBatches(fromHeight, toHeight, batchSize = this.defaultBatchSize) {
    const batches = [];
    if (fromHeight > toHeight) return batches;

    let currentStart = fromHeight;
    let batchNumber = 1;
    const boundedSize = Math.max(1, Math.min(100, batchSize));

    while (currentStart <= toHeight) {
      const currentEnd = Math.min(toHeight, currentStart + boundedSize - 1);
      batches.push({
        batchNumber: batchNumber++,
        fromHeight: currentStart,
        toHeight: currentEnd,
        count: currentEnd - currentStart + 1
      });
      currentStart = currentEnd + 1;
    }

    return batches;
  }

  /**
   * Select best eligible sync peer, rotating away from failed peers
   * @param {string[]} eligiblePeers 
   * @returns {string|null}
   */
  selectSyncPeer(eligiblePeers = []) {
    const candidates = eligiblePeers.filter(p => !this.failedPeers.has(p));
    if (candidates.length > 0) {
      return candidates[0];
    }
    // If all failed, reset failed list and retry
    if (eligiblePeers.length > 0) {
      this.failedPeers.clear();
      return eligiblePeers[0];
    }
    return null;
  }

  recordPeerFailure(peerValidatorId) {
    if (peerValidatorId) {
      this.failedPeers.add(peerValidatorId);
      logger.warn(`[SyncPlanner] Peer ${peerValidatorId} marked failed; switching to alternative`);
    }
  }

  recordPeerSuccess(peerValidatorId) {
    if (peerValidatorId) {
      this.failedPeers.delete(peerValidatorId);
    }
  }

  /**
   * Find common finalized ancestor between local chain and a peer's advertised hash list
   * @param {Array<{ height: number, blockHash: string }>} peerBlockHashes 
   * @returns {{ commonAncestorHeight: number, commonAncestorHash: string, diverged: boolean }}
   */
  detectCommonAncestor(peerBlockHashes = []) {
    if (!this.blockchain || !Array.isArray(peerBlockHashes) || peerBlockHashes.length === 0) {
      return { commonAncestorHeight: 0, commonAncestorHash: '', diverged: false };
    }

    // Sort descending by height
    const sorted = [...peerBlockHashes].sort((a, b) => b.height - a.height);

    for (const peerItem of sorted) {
      const localBlock = this.blockchain.getBlockByNumber(peerItem.height);
      if (localBlock) {
        const localHash = String(localBlock.blockHash || localBlock.hash || '').toLowerCase();
        const peerHash = String(peerItem.blockHash || '').toLowerCase();

        if (localHash === peerHash) {
          // Common ancestor found!
          return {
            commonAncestorHeight: peerItem.height,
            commonAncestorHash: localHash,
            diverged: false
          };
        } else {
          // Both nodes have a block at this height, but hashes differ!
          logger.warn(`[SyncPlanner] Hash mismatch at height #${peerItem.height}: local '${localHash}' vs peer '${peerHash}'`);
        }
      }
    }

    // If Genesis (height 0) was checked and differed, chain is diverged!
    const genesisPeer = sorted.find(p => p.height === 0);
    const genesisLocal = this.blockchain.getBlockByNumber(0);
    if (genesisPeer && genesisLocal && genesisPeer.blockHash.toLowerCase() !== genesisLocal.blockHash.toLowerCase()) {
      return {
        commonAncestorHeight: -1,
        commonAncestorHash: null,
        diverged: true
      };
    }

    return {
      commonAncestorHeight: 0,
      commonAncestorHash: genesisLocal ? genesisLocal.blockHash : '',
      diverged: false
    };
  }
}

module.exports = SyncPlanner;

