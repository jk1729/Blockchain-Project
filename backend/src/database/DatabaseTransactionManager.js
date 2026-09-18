/**
 * PDSChain Database Transaction Manager (Phase 18)
 * 
 * Enforces atomic write boundaries, crash-safe commit sequences, and
 * rollback protection across authoritative and derived persistence tiers.
 */

const { sequelize } = require('../config/database');
const BlockModel = require('../models/Block');
const ReceiptModel = require('../models/Receipt');
const TransactionModel = require('../models/Transaction');
const CheckpointRecord = require('../models/CheckpointRecord');
const EventRecord = require('../models/EventRecord');
const { DatabaseIntegrityManager, DatabaseIntegrityError } = require('./DatabaseIntegrityManager');
const logger = require('../utils/logger');

class DatabaseTransactionError extends Error {
  constructor(message, code = 'TRANSACTION_ERROR', originalError = null) {
    super(message);
    this.name = 'DatabaseTransactionError';
    this.code = code;
    this.originalError = originalError;
  }
}

class DatabaseTransactionManager {
  constructor(options = {}) {
    this.sequelize = options.sequelize || sequelize;
    this.integrityManager = options.integrityManager || new DatabaseIntegrityManager();
    this.logger = options.logger || logger;
  }

  /**
   * Execute atomic block finalization write workflow
   * @param {object} params
   * @param {object} params.block - Block instance or JSON
   * @param {Array<object>} [params.receipts=[]] - Execution receipts
   * @param {Array<object>} [params.events=[]] - Events generated
   * @param {object} [params.checkpoint=null] - Finalized checkpoint
   * @param {object} [params.latestBlock=null] - Preceding block for continuity check
   * @param {object} [params.options={}] - Fault injection / hooks
   * @returns {Promise<object>} Committed summary
   */
  async commitFinalizedBlock({ block, receipts = [], events = [], checkpoint = null, latestBlock = null, options = {} }) {
    if (!block) {
      throw new DatabaseTransactionError('Block payload is required for commit', 'MISSING_BLOCK');
    }

    // 1. Enforce monotonic height & previousHash continuity before opening transaction
    if (latestBlock) {
      this.integrityManager.enforceMonotonicHeight(block, latestBlock);
    }

    // Fault injection hook (Pre-transaction)
    if (options.faultInjection && options.faultInjection.failBeforeTx) {
      throw new DatabaseTransactionError('Simulated crash before transaction start', 'FAULT_INJECTED');
    }

    // 2. Open atomic database transaction
    const t = await this.sequelize.transaction();

    try {
      // 3. Persist Authoritative Block
      const blockPayload = typeof block.toJSON === 'function' ? block.toJSON() : block;
      const createdBlock = await BlockModel.create(blockPayload, { transaction: t });

      // Fault injection hook (Mid-transaction after block create)
      if (options.faultInjection && options.faultInjection.failAfterBlock) {
        throw new Error('Simulated failure after block insertion');
      }

      // 4. Persist Receipts
      if (Array.isArray(receipts) && receipts.length > 0) {
        for (const r of receipts) {
          await ReceiptModel.create({
            transactionHash: r.transactionHash || r.hash,
            transactionId: r.transactionId || r.id || 'N/A',
            blockNumber: block.blockNumber,
            blockHash: block.blockHash,
            transactionIndex: r.transactionIndex || 0,
            contractAddress: r.contractAddress || null,
            status: r.status || 'SUCCESS',
            gasUsed: r.gasUsed || 21000,
            cumulativeGasUsed: r.cumulativeGasUsed || 21000,
            logs: r.logs || [],
            logsBloom: r.logsBloom || null,
            receiptHash: r.receiptHash || r.hash || '0x00',
            revertReason: r.revertReason || null
          }, { transaction: t });
        }
      }

      // 5. Persist Checkpoint if provided
      if (checkpoint) {
        await CheckpointRecord.create({
          checkpointHeight: checkpoint.blockHeight !== undefined ? checkpoint.blockHeight : block.blockNumber,
          checkpointHash: checkpoint.checkpointHash || '0x00',
          blockHash: checkpoint.blockHash || block.blockHash,
          stateRoot: checkpoint.stateRoot || block.stateRoot || '0x00',
          certificateHash: checkpoint.certificateHash || '0x00',
          approvingValidators: checkpoint.validatorApprovals || [],
          validatorCount: checkpoint.validatorCount || 12,
          isCommitted: true
        }, { transaction: t });
      }

      // 6. Persist Derived Events within transaction
      if (Array.isArray(events) && events.length > 0) {
        for (const ev of events) {
          await EventRecord.create({
            eventId: ev.eventId || ev.id,
            eventType: ev.eventType || ev.type,
            category: ev.category || 'BLOCKCHAIN',
            severity: ev.severity || 'INFO',
            finalityStatus: 'FINALIZED',
            blockNumber: block.blockNumber,
            blockHash: block.blockHash,
            transactionHash: ev.transactionHash || null,
            deduplicationKey: ev.deduplicationKey || `${ev.eventId}-${block.blockNumber}`,
            payload: ev.payload || ev.data || {},
            timestamp: ev.timestamp || new Date().toISOString()
          }, { transaction: t });
        }
      }

      // Fault injection hook (Just before commit)
      if (options.faultInjection && options.faultInjection.failBeforeCommit) {
        throw new Error('Simulated database failure before commit');
      }

      // 7. Commit atomic transaction
      await t.commit();
      this.logger.info(`[DatabaseTransactionManager] Block #${block.blockNumber} atomically committed with ${receipts.length} receipts and ${events.length} events.`);

      return {
        success: true,
        blockNumber: block.blockNumber,
        blockHash: block.blockHash,
        receiptsCount: receipts.length,
        eventsCount: events.length
      };
    } catch (error) {
      // 8. Rollback completely on any failure
      await t.rollback();
      const details = error.errors ? error.errors.map(e => `${e.path}: ${e.message}`).join(', ') : error.message;
      this.logger.error(`[DatabaseTransactionManager] Transaction rolled back for block #${block.blockNumber}: ${details}`);
      throw new DatabaseTransactionError(`Failed to atomically commit block #${block.blockNumber}: ${details}`, 'COMMIT_FAILED', error);
    }
  }

  /**
   * Execute atomic synchronization batch commit
   * @param {Array<object>} blocks - Ordered array of validated blocks
   * @param {object} [checkpoint]
   * @returns {Promise<object>}
   */
  async commitSyncBatch(blocks, checkpoint = null) {
    if (!Array.isArray(blocks) || blocks.length === 0) {
      throw new DatabaseTransactionError('Sync batch must be non-empty array', 'EMPTY_SYNC_BATCH');
    }

    const t = await this.sequelize.transaction();
    try {
      for (const block of blocks) {
        const blockPayload = typeof block.toJSON === 'function' ? block.toJSON() : block;
        await BlockModel.create(blockPayload, { transaction: t });
      }

      if (checkpoint) {
        const lastBlock = blocks[blocks.length - 1];
        await CheckpointRecord.create({
          checkpointHeight: checkpoint.blockHeight !== undefined ? checkpoint.blockHeight : lastBlock.blockNumber,
          checkpointHash: checkpoint.checkpointHash || '0x00',
          blockHash: checkpoint.blockHash || lastBlock.blockHash,
          stateRoot: checkpoint.stateRoot || lastBlock.stateRoot || '0x00',
          certificateHash: checkpoint.certificateHash || '0x00',
          approvingValidators: checkpoint.validatorApprovals || [],
          validatorCount: checkpoint.validatorCount || 12,
          isCommitted: true
        }, { transaction: t });
      }

      await t.commit();
      return { success: true, blocksCommitted: blocks.length };
    } catch (err) {
      await t.rollback();
      throw new DatabaseTransactionError(`Sync batch commit failed: ${err.message}`, 'SYNC_BATCH_FAILED', err);
    }
  }
}

module.exports = {
  DatabaseTransactionManager,
  DatabaseTransactionError
};
