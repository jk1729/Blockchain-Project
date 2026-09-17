/**
 * PDSChain ExecutionEngine
 * 
 * Provides the execution boundary for deterministic state transitions,
 * cryptographic signature verification, nonce ordering, and smart-contract-like rule execution.
 */

const stateManagerInstance = require('./StateManager');
const Transaction = require('../blockchain/Transaction');
const ExecutionContext = require('./ExecutionContext');
const ExecutionReceipt = require('./ExecutionReceipt');
const { getRuleForType } = require('./rules');
const { ExecutionErrorCodes, ExecutionError } = require('./errors/ExecutionErrors');
const { verifyTransactionSignature } = require('../blockchain/identity/signature');
const logger = require('../utils/logger');

class ExecutionEngine {
  constructor(state = stateManagerInstance) {
    this.stateManager = state;
  }

  /**
   * Validate a transaction proposal against:
   * 1. Cryptographic Digital Signature & Sender Identity
   * 2. Sender Nonce Sequencing & Replay Protection
   * 3. Idempotency (Transaction ID not previously executed)
   * 4. Smart-Contract-Like Domain Rule (Entitlement, Inventory, Transfer)
   * 
   * Side-effect-free: Does not modify any state or database records.
   * 
   * @param {Transaction|object} tx - The transaction proposal
   * @param {object} [options] - Options (dbTransaction, requireSignature)
   * @returns {Promise<object>} Deterministic validation result
   */
  async validateTransaction(tx, options = {}) {
    if (!tx || typeof tx !== 'object') {
      throw new ExecutionError(
        ExecutionErrorCodes.INVALID_TRANSACTION_TYPE,
        'Transaction payload must be an object.'
      );
    }

    const transaction = tx instanceof Transaction ? tx : Transaction.fromJSON(tx);
    const context = ExecutionContext.fromTransaction(transaction, options);
    const { requireSignature = false } = options;

    // 1. Resolve Domain Rule from Registry
    const rule = getRuleForType(context.transactionType);
    if (!rule) {
      throw new ExecutionError(
        ExecutionErrorCodes.INVALID_TRANSACTION_TYPE,
        `No execution rule registered for transaction type '${context.transactionType}'.`
      );
    }

    // 2. Digital Signature Verification (if present or explicitly required)
    if (transaction.signature || requireSignature) {
      const sigResult = verifyTransactionSignature(transaction);
      if (!sigResult.valid) {
        throw new ExecutionError(
          ExecutionErrorCodes.INVALID_SIGNATURE,
          `Transaction signature verification failed: ${sigResult.reason}`
        );
      }
    }

    // 3. Idempotency Check (Has transaction ID already been executed?)
    if (this.stateManager && typeof this.stateManager.isTransactionIdSeen === 'function') {
      if (this.stateManager.isTransactionIdSeen(context.transactionId)) {
        throw new ExecutionError(
          ExecutionErrorCodes.ALREADY_APPLIED,
          `Transaction '${context.transactionId}' has already been executed and committed to state.`
        );
      }
    }

    // 4. Nonce Verification & Replay Protection
    if (context.sender && context.sender !== 'SYSTEM' && this.stateManager) {
      const nonceResult = this.stateManager.validateNonce(context.sender, context.nonce);
      if (!nonceResult.valid) {
        throw new ExecutionError(
          ExecutionErrorCodes.REPLAYED_NONCE,
          `Transaction nonce validation failed: ${nonceResult.reason}`,
          { expectedNonce: nonceResult.expectedNonce, providedNonce: context.nonce }
        );
      }
    }

    // 5. Execute Pure Side-Effect-Free Rule Validation
    const ruleValidation = await rule.validate(context, this.stateManager, options);

    return {
      valid: true,
      transactionId: context.transactionId,
      transactionType: context.transactionType,
      context,
      ...ruleValidation
    };
  }

  /**
   * Deterministically execute a verified transaction and apply atomic state transitions.
   * 
   * @param {Transaction|object} tx - The transaction to execute
   * @param {object} [contextOptions] - Context options (dbTransaction, blockNumber, blockHash, consensusRound)
   * @returns {Promise<object>} Execution result and receipt
   */
  async executeTransaction(tx, contextOptions = {}) {
    const transaction = tx instanceof Transaction ? tx : Transaction.fromJSON(tx);
    const context = ExecutionContext.fromTransaction(transaction, contextOptions);
    const { dbTransaction = null, blockNumber = 0, blockHash = '' } = contextOptions;

    logger.execution(`Executing transaction ${context.transactionId} (${context.transactionType}) on state (Block #${blockNumber})...`);

    // 1. Re-validate state atomically within lock/transaction
    const validation = await this.validateTransaction(transaction, {
      ...contextOptions,
      dbTransaction
    });

    // 2. Resolve Rule from Registry
    const rule = getRuleForType(context.transactionType);
    if (!rule) {
      throw new ExecutionError(
        ExecutionErrorCodes.INVALID_TRANSACTION_TYPE,
        `No execution rule registered for transaction type '${context.transactionType}'.`
      );
    }

    // 3. Execute State Transition via Rule Module
    const ruleResult = await rule.execute(context, this.stateManager, {
      ...contextOptions,
      dbTransaction
    });

    // 4. Atomically Consume Nonce and Record Transaction ID
    if (context.sender && context.sender !== 'SYSTEM' && this.stateManager) {
      this.stateManager.consumeNonce(context.sender, context.nonce);
    }
    if (this.stateManager) {
      this.stateManager.recordTransactionId(context.transactionId);
    }

    // 5. Construct Deterministic Execution Receipt
    const receipt = ExecutionReceipt.success({
      transactionId: context.transactionId,
      transactionType: context.transactionType,
      stateChanges: ruleResult.stateChanges || validation.predictedChanges || [],
      blockNumber,
      blockHash,
      consensusRound: contextOptions.consensusRound || context.consensusRound || '',
      timestamp: context.timestamp
    });

    return {
      success: true,
      transactionId: context.transactionId,
      receipt: receipt,
      evmReceipt: ruleResult.receipt || null,
      stateTransitions: ruleResult.stateChanges || validation.predictedChanges || [],
      blockNumber,
      blockHash
    };
  }
}

module.exports = new ExecutionEngine();
