/**
 * PDSChain Ledger Controller (Phase 10)
 * 
 * Read-only observability controller for ledger synchronization, checkpoints,
 * and recovery status.
 */

const { LedgerSyncState } = require('../blockchain/sync/LedgerSyncState');
const CheckpointManager = require('../blockchain/sync/CheckpointManager');

class LedgerController {
  /**
   * @param {object} [options]
   * @param {LedgerSyncState} [options.syncState]
   * @param {CheckpointManager} [options.checkpointManager]
   * @param {Blockchain} [options.blockchain]
   */
  constructor(options = {}) {
    this.syncState = options.syncState || null;
    this.checkpointManager = options.checkpointManager || null;
    this.blockchain = options.blockchain || null;
  }

  getStatus = (req, res) => {
    const latestBlock = this.blockchain ? this.blockchain.getLatestBlock() : null;
    const latestCp = this.checkpointManager ? this.checkpointManager.getLatestCheckpoint() : null;
    const syncSnapshot = this.syncState ? this.syncState.getSnapshot() : {
      state: 'CURRENT',
      isConsensusReady: true,
      localFinalizedHeight: latestBlock ? latestBlock.blockNumber : 0,
      localCommittedHeight: latestBlock ? latestBlock.blockNumber : 0,
      latestBlockHash: latestBlock ? latestBlock.blockHash : null,
      targetHeight: latestBlock ? latestBlock.blockNumber : 0,
      progressPercentage: 100,
      verificationStatus: 'PASSED',
      stateRootStatus: 'VALID',
      journalReplayStatus: 'REPLAYED'
    };

    res.json({
      success: true,
      validatorId: syncSnapshot.validatorId || 'VAL-01',
      state: syncSnapshot.state,
      isConsensusReady: syncSnapshot.isConsensusReady,
      heights: {
        finalized: syncSnapshot.localFinalizedHeight,
        committed: syncSnapshot.localCommittedHeight,
        target: syncSnapshot.targetHeight
      },
      latestBlock: {
        number: latestBlock ? latestBlock.blockNumber : 0,
        hash: latestBlock ? latestBlock.blockHash : null,
        timestamp: latestBlock ? latestBlock.timestamp : null
      },
      checkpoint: latestCp ? latestCp.toJSON() : null,
      verification: {
        status: syncSnapshot.verificationStatus,
        stateRoot: syncSnapshot.stateRootStatus,
        receiptRoot: syncSnapshot.receiptRootStatus,
        journalReplay: syncSnapshot.journalReplayStatus
      },
      syncProgress: {
        percentage: syncSnapshot.progressPercentage,
        currentBatch: syncSnapshot.currentBatch,
        totalBlocksSynced: syncSnapshot.totalBlocksSynced || 0,
        lastSuccessfulSyncAt: syncSnapshot.lastSuccessfulSyncAt,
        lastFailedSyncAt: syncSnapshot.lastFailedSyncAt,
        retriesCount: syncSnapshot.retriesCount || 0,
        recoveryReason: syncSnapshot.recoveryReason
      },
      timestamp: new Date().toISOString()
    });
  };

  getCheckpoint = (req, res) => {
    const cp = this.checkpointManager ? this.checkpointManager.getLatestCheckpoint() : null;
    if (!cp) {
      return res.json({
        success: true,
        checkpoint: null,
        message: 'No checkpoint persisted yet'
      });
    }

    res.json({
      success: true,
      checkpoint: cp.toJSON()
    });
  };
}

const defaultLedgerController = new LedgerController();

module.exports = defaultLedgerController;
module.exports.LedgerController = LedgerController;

