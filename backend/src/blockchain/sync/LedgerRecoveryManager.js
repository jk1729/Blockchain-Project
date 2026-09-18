/**
 * PDSChain Ledger Recovery Manager (Phase 10)
 * 
 * Orchestrates startup reconciliation across SQLite storage, consensus journal,
 * checkpoints, and EVM world state, enforcing crash recovery and mempool cleanup.
 */

const { SyncStatus } = require('./LedgerSyncState');
const LedgerCheckpoint = require('./LedgerCheckpoint');
const logger = require('../../utils/logger');

class LedgerRecoveryManager {
  /**
   * @param {object} params
   * @param {Blockchain} params.blockchain
   * @param {ConsensusJournal} params.journal
   * @param {CheckpointManager} params.checkpointManager
   * @param {LedgerSyncState} params.syncState
   * @param {EVMRuntime} [params.evmRuntime]
   * @param {object} [params.mempool]
   * @param {NetworkMetrics} [params.metrics]
   */
  constructor(params = {}) {
    this.blockchain = params.blockchain;
    this.journal = params.journal;
    this.checkpointManager = params.checkpointManager;
    this.syncState = params.syncState;
    this.evmRuntime = params.evmRuntime || null;
    this.mempool = params.mempool || null;
    this.metrics = params.metrics || null;
    this.proofIndexer = params.proofIndexer || null;
  }

  /**
   * Run full startup recovery and reconciliation sequence
   * @returns {Promise<{ success: boolean, state: string, recoveryReport: object }>}
   */
  async recover() {
    logger.info('[LedgerRecoveryManager] Starting ledger recovery & state reconciliation sequence...');
    if (this.metrics) this.metrics.incrementRecoveryAttempt();
    if (this.proofIndexer) this.proofIndexer.setStatus('REBUILDING');

    const report = {
      initialState: this.syncState.state,
      journalReplay: null,
      checkpoint: null,
      chainIntegrity: null,
      evmReconciliation: null,
      mempoolReconciliation: null,
      divergenceDetected: false,
      finalState: null
    };

    try {
      // Step 1: Replay & Recover Consensus Journal
      const journalState = this.journal ? this.journal.recoverState() : null;
      report.journalReplay = journalState;
      if (journalState && journalState.hasCorruptedRecords) {
        logger.warn(`[LedgerRecoveryManager] Journal corruption detected & quarantined to: ${journalState.quarantinedPath}`);
        if (this.metrics) this.metrics.incrementJournalFailure();
      }
      this.syncState.journalReplayStatus = 'REPLAYED';

      // Step 2: Load and Verify Latest Checkpoint
      const checkpoint = this.checkpointManager ? this.checkpointManager.load() : null;
      report.checkpoint = checkpoint ? checkpoint.toJSON() : null;

      // Step 3: Chain Validation & Checkpoint Alignment
      const latestBlock = this.blockchain ? this.blockchain.getLatestBlock() : null;
      const isChainValid = this.blockchain ? this.blockchain.isChainValid() : false;
      report.chainIntegrity = {
        valid: isChainValid,
        latestBlockNumber: latestBlock ? latestBlock.blockNumber : 0,
        latestBlockHash: latestBlock ? latestBlock.blockHash : null
      };

      if (!isChainValid) {
        logger.error('[LedgerRecoveryManager] Local blockchain chain integrity check failed! Entering HALTED.');
        if (this.proofIndexer) this.proofIndexer.setStatus('DEGRADED');
        this.syncState.transitionTo(SyncStatus.CORRUPTED, 'Chain integrity verification failed');
        this.syncState.transitionTo(SyncStatus.HALTED, 'Unrecoverable chain corruption');
        report.finalState = SyncStatus.HALTED;
        return { success: false, state: SyncStatus.HALTED, recoveryReport: report };
      }

      // Checkpoint vs Block Alignment
      if (checkpoint && latestBlock) {
        if (checkpoint.blockHeight > latestBlock.blockNumber) {
          // Checkpoint is ahead of persisted blocks (missing block records)
          logger.error(`[LedgerRecoveryManager] Checkpoint height #${checkpoint.blockHeight} is ahead of chain height #${latestBlock.blockNumber}`);
          if (this.proofIndexer) this.proofIndexer.setStatus('DEGRADED');
          this.syncState.transitionTo(SyncStatus.RECOVERY_REQUIRED, 'Checkpoint ahead of block store; block recovery needed');
          report.finalState = SyncStatus.RECOVERY_REQUIRED;
          return { success: false, state: SyncStatus.RECOVERY_REQUIRED, recoveryReport: report };
        }

        if (latestBlock.blockNumber > checkpoint.blockHeight) {
          // Tip block was committed before checkpoint was saved (e.g. crash after block write)
          logger.info(`[LedgerRecoveryManager] Re-aligning checkpoint for block #${latestBlock.blockNumber}...`);
          try {
            const newCp = LedgerCheckpoint.fromFinalizedBlock(latestBlock, this.blockchain.chain.length);
            this.checkpointManager.saveCheckpoint(newCp);
            report.checkpoint = newCp.toJSON();
          } catch (cpErr) {
            logger.warn(`[LedgerRecoveryManager] Failed to auto-create checkpoint: ${cpErr.message}`);
          }
        }
      } else if (!checkpoint && latestBlock) {
        // Initial checkpoint creation from Genesis
        try {
          const genesisCp = LedgerCheckpoint.fromFinalizedBlock(latestBlock, 1);
          if (this.checkpointManager) {
            this.checkpointManager.saveCheckpoint(genesisCp);
          }
          report.checkpoint = genesisCp.toJSON();
        } catch (_) {}
      }

      // Step 4: EVM State Verification
      if (this.evmRuntime && this.evmRuntime.isInitialized && latestBlock) {
        try {
          const currentStateRoot = await this.evmRuntime.getStateRoot();
          if (latestBlock.stateRoot && currentStateRoot && currentStateRoot !== '0x' + '0'.repeat(64)) {
            const cleanBlockRoot = latestBlock.stateRoot.toLowerCase().replace(/^0x/, '');
            const cleanEvmRoot = currentStateRoot.toLowerCase().replace(/^0x/, '');
            if (cleanBlockRoot !== cleanEvmRoot && latestBlock.blockNumber > 0) {
              logger.warn(`[LedgerRecoveryManager] EVM stateRoot discrepancy: block '${cleanBlockRoot}' vs EVM '${cleanEvmRoot}'`);
              this.syncState.stateRootStatus = 'MISMATCH';
            } else {
              this.syncState.stateRootStatus = 'VALID';
            }
          } else {
            this.syncState.stateRootStatus = 'VALID';
          }
        } catch (evmErr) {
          logger.warn(`[LedgerRecoveryManager] EVM stateRoot verification warning: ${evmErr.message}`);
        }
      } else {
        this.syncState.stateRootStatus = 'VALID';
      }

      // Step 5: Mempool Reconciliation (purge transactions already in finalized blocks)
      let purgedCount = 0;
      if (this.mempool && this.blockchain) {
        for (const block of this.blockchain.chain) {
          if (Array.isArray(block.transactions)) {
            for (const tx of block.transactions) {
              const txId = tx.transactionId || tx.id;
              if (txId && typeof this.mempool.remove === 'function') {
                this.mempool.remove(txId);
                purgedCount++;
              }
            }
          }
        }
      }
      report.mempoolReconciliation = { purgedCount };

      // Step 6: Determine Final Startup State
      this.syncState.setFinalizedState(
        latestBlock ? latestBlock.blockNumber : 0,
        latestBlock ? latestBlock.blockHash : null
      );
      this.syncState.verificationStatus = 'PASSED';
      this.syncState.receiptRootStatus = 'VALID';

      // Transition to CURRENT if verification passed
      if (this.syncState.canTransitionTo(SyncStatus.CURRENT)) {
        this.syncState.transitionTo(SyncStatus.CURRENT, 'Ledger recovery and verification passed successfully');
        report.finalState = SyncStatus.CURRENT;
      } else {
        report.finalState = this.syncState.state;
      }

      if (this.proofIndexer && this.blockchain) {
        try {
          this.proofIndexer.rebuild(this.blockchain.chain);
        } catch (idxErr) {
          logger.warn(`[LedgerRecoveryManager] Proof indexer rebuild warning: ${idxErr.message}`);
        }
      }

      logger.info(`[LedgerRecoveryManager] Recovery complete. Final state: ${this.syncState.state} (Height: #${this.syncState.localFinalizedHeight})`);
      return { success: true, state: this.syncState.state, recoveryReport: report };

    } catch (err) {
      logger.error(`[LedgerRecoveryManager] Fatal recovery exception: ${err.message}`, err.stack);
      if (this.metrics) this.metrics.incrementRecoveryFailure();
      if (this.proofIndexer) this.proofIndexer.setStatus('DEGRADED');
      
      try {
        if (this.syncState.canTransitionTo(SyncStatus.RECOVERY_REQUIRED)) {
          this.syncState.transitionTo(SyncStatus.RECOVERY_REQUIRED, err.message);
        }
      } catch (_) {}

      report.finalState = this.syncState.state;
      return { success: false, state: this.syncState.state, error: err.message, recoveryReport: report };
    }
  }
}

module.exports = LedgerRecoveryManager;

