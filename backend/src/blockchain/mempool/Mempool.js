/**
 * PDSChain Transaction Mempool
 * 
 * Manages the staging, admission validation, nonce sequencing, duplicate detection,
 * TTL expiration, and deterministic candidate selection for unconfirmed transactions.
 */

const { MempoolStatus, MempoolEntry } = require('./MempoolEntry');
const MempoolPolicy = require('./MempoolPolicy');
const { MempoolErrorCodes, MempoolError } = require('./MempoolErrors');
const Transaction = require('../Transaction');
const { serializeUnsignedTransaction } = require('../serialization');
const { verifyTransactionSignature } = require('../identity/signature');
const stateManagerInstance = require('../../execution/StateManager');
const logger = require('../../utils/logger');

class Mempool {
  constructor(options = {}, stateManager = stateManagerInstance) {
    this.policy = new MempoolPolicy(options);
    this.stateManager = stateManager;

    // Primary index: Map<transactionId, MempoolEntry>
    this.entries = new Map();

    // Secondary index: Map<senderKey, Set<transactionId>>
    this.bySender = new Map();

    // Nonce index: Map<senderKey, Map<nonce, transactionId>>
    this.bySenderNonce = new Map();

    // Internal metrics for observability
    this.metrics = {
      acceptedCount: 0,
      rejectedCount: 0,
      duplicateCount: 0,
      nonceConflictCount: 0,
      expiredCount: 0
    };
  }

  /**
   * Normalize sender key for consistent case-insensitive indexing
   * @param {string} sender 
   * @returns {string}
   */
  _normalizeSender(sender) {
    return String(sender || '').toLowerCase().trim();
  }

  /**
   * Clear all mempool entries, indices, and metrics (used for tests/reset)
   */
  clear() {
    this.entries.clear();
    this.bySender.clear();
    this.bySenderNonce.clear();
    this.metrics = {
      acceptedCount: 0,
      rejectedCount: 0,
      duplicateCount: 0,
      nonceConflictCount: 0,
      expiredCount: 0
    };
  }

  /**
   * Admission Pipeline: Validates and admits an incoming signed transaction.
   * 
   * Pipeline Steps:
   * 1. Basic Structure Validation
   * 2. Byte Size Limit Validation
   * 3. Cryptographic Signature & Address Verification
   * 4. Deterministic Transaction ID Validation
   * 5. Duplicate & Replay Detection
   * 6. Sender Nonce Validation & Conflict Detection
   * 7. Capacity & Sender Limit Policy Validation
   * 8. Staged in Mempool as READY or QUEUED
   * 
   * @param {Transaction|object} tx - Incoming transaction
   * @param {object} [options]
   * @returns {MempoolEntry} Admitted mempool entry
   */
  addTransaction(tx, options = {}) {
    if (!tx || typeof tx !== 'object') {
      this.metrics.rejectedCount++;
      throw new MempoolError(MempoolErrorCodes.MALFORMED_TRANSACTION, 'Transaction payload must be an object.');
    }

    const transaction = tx instanceof Transaction ? tx : Transaction.fromJSON(tx);
    const { sender, receiver, nonce, signature, transactionId } = transaction;

    if (!sender) {
      this.metrics.rejectedCount++;
      throw new MempoolError(MempoolErrorCodes.MALFORMED_TRANSACTION, 'Sender address or entity ID is required.');
    }

    if (!receiver) {
      this.metrics.rejectedCount++;
      throw new MempoolError(MempoolErrorCodes.MALFORMED_TRANSACTION, 'Receiver address or entity ID is required.');
    }

    // 1. Transaction Size Limit Check
    const canonicalStr = serializeUnsignedTransaction(transaction);
    const sizeBytes = Buffer.byteLength(canonicalStr, 'utf8');
    if (sizeBytes > this.policy.maxTransactionSizeBytes) {
      this.metrics.rejectedCount++;
      throw new MempoolError(
        MempoolErrorCodes.TRANSACTION_TOO_LARGE,
        `Transaction size (${sizeBytes} bytes) exceeds limit (${this.policy.maxTransactionSizeBytes} bytes).`,
        { sizeBytes, limit: this.policy.maxTransactionSizeBytes }
      );
    }

    // 2. Cryptographic Digital Signature Verification
    if (!signature) {
      this.metrics.rejectedCount++;
      throw new MempoolError(MempoolErrorCodes.INVALID_SIGNATURE, 'Transaction is unsigned. Digital signature is required.');
    }

    const sigResult = verifyTransactionSignature(transaction);
    if (!sigResult.valid) {
      this.metrics.rejectedCount++;
      if (sigResult.reason && sigResult.reason.includes('TRANSACTION_ID_MISMATCH')) {
        throw new MempoolError(MempoolErrorCodes.INVALID_TRANSACTION_ID, sigResult.reason);
      }
      throw new MempoolError(MempoolErrorCodes.INVALID_SIGNATURE, `Digital signature verification failed: ${sigResult.reason}`);
    }

    // 3. Deterministic Transaction ID Check
    if (transactionId && sigResult.transactionId && transactionId !== sigResult.transactionId) {
      this.metrics.rejectedCount++;
      throw new MempoolError(
        MempoolErrorCodes.INVALID_TRANSACTION_ID,
        `Transaction ID '${transactionId}' does not match canonical hash '${sigResult.transactionId}'.`
      );
    }

    const txId = transaction.transactionId || sigResult.transactionId;
    const senderKey = this._normalizeSender(sender);
    const txNonce = parseInt(nonce, 10) || 0;

    // 4. Duplicate & Replay Checks
    if (this.entries.has(txId)) {
      this.metrics.duplicateCount++;
      this.metrics.rejectedCount++;
      throw new MempoolError(MempoolErrorCodes.DUPLICATE_TRANSACTION, `Transaction '${txId}' already exists in mempool.`);
    }

    if (this.stateManager && typeof this.stateManager.isTransactionIdSeen === 'function' && this.stateManager.isTransactionIdSeen(txId)) {
      this.metrics.duplicateCount++;
      this.metrics.rejectedCount++;
      throw new MempoolError(MempoolErrorCodes.DUPLICATE_TRANSACTION, `Transaction '${txId}' has already been committed to the blockchain.`);
    }

    // 5. Conflicting Nonce Check (same sender + same nonce already pending in mempool)
    let senderNonceMap = this.bySenderNonce.get(senderKey);
    if (!senderNonceMap) {
      senderNonceMap = new Map();
      this.bySenderNonce.set(senderKey, senderNonceMap);
    }

    if (senderNonceMap.has(txNonce)) {
      const existingTxId = senderNonceMap.get(txNonce);
      this.metrics.nonceConflictCount++;
      this.metrics.rejectedCount++;
      throw new MempoolError(
        MempoolErrorCodes.CONFLICTING_NONCE,
        `Conflicting transaction with sender '${sender}' and nonce ${txNonce} is already pending ('${existingTxId}').`,
        { sender, nonce: txNonce, existingTransactionId: existingTxId }
      );
    }

    // 6. Nonce Sequencing & Gap Evaluation against Committed State
    const expectedNonce = this.stateManager ? this.stateManager.getExpectedNonce(sender) : 0;
    let entryStatus;

    if (txNonce < expectedNonce) {
      this.metrics.rejectedCount++;
      throw new MempoolError(
        MempoolErrorCodes.REPLAYED_NONCE,
        `Stale/replayed nonce ${txNonce}. Expected nonce for sender '${sender}' is ${expectedNonce}.`,
        { sender, nonce: txNonce, expectedNonce }
      );
    } else if (txNonce === expectedNonce) {
      entryStatus = MempoolStatus.READY;
    } else {
      // Future Nonce: Check against max future nonce gap
      const gap = txNonce - expectedNonce;
      if (gap > this.policy.maxFutureNonceGap) {
        this.metrics.rejectedCount++;
        throw new MempoolError(
          MempoolErrorCodes.NONCE_GAP,
          `Nonce ${txNonce} exceeds maximum future nonce gap (${this.policy.maxFutureNonceGap}). Expected: ${expectedNonce}.`,
          { sender, nonce: txNonce, expectedNonce, gap }
        );
      }
      entryStatus = MempoolStatus.QUEUED;
    }

    // 7. Capacity Checks
    if (this.entries.size >= this.policy.maxTransactions) {
      this.metrics.rejectedCount++;
      throw new MempoolError(
        MempoolErrorCodes.MEMPOOL_FULL,
        `Mempool capacity limit reached (${this.policy.maxTransactions} transactions).`
      );
    }

    let senderTxSet = this.bySender.get(senderKey);
    if (!senderTxSet) {
      senderTxSet = new Set();
      this.bySender.set(senderKey, senderTxSet);
    }

    if (senderTxSet.size >= this.policy.maxTransactionsPerSender) {
      this.metrics.rejectedCount++;
      throw new MempoolError(
        MempoolErrorCodes.SENDER_LIMIT_EXCEEDED,
        `Sender '${sender}' has reached maximum pending transaction limit (${this.policy.maxTransactionsPerSender}).`
      );
    }

    // 8. Create Entry and Index
    const entry = new MempoolEntry({
      transaction,
      receivedAt: Date.now(),
      ttl: this.policy.transactionTTL,
      status: entryStatus,
      sizeBytes
    });

    this.entries.set(txId, entry);
    senderTxSet.add(txId);
    senderNonceMap.set(txNonce, txId);
    this.metrics.acceptedCount++;

    return entry;
  }

  /**
   * Deterministic Candidate Selection for Block Proposers.
   * 
   * Selection Rules:
   * 1. Only READY transactions are eligible (QUEUED items are excluded).
   * 2. Sorted alphabetically by sender address.
   * 3. Sorted ascending by nonce for the same sender.
   * 4. Tie-broken alphabetically by transactionId.
   * 
   * @param {number} [limit=100] - Maximum number of candidate transactions
   * @returns {Transaction[]} Deterministically ordered candidate transactions
   */
  getCandidateTransactions(limit = 100) {
    this.cleanupExpired();

    const maxCount = parseInt(limit, 10) || 100;
    const readyEntries = [];

    for (const entry of this.entries.values()) {
      if (entry.status === MempoolStatus.READY && !entry.isExpired()) {
        readyEntries.push(entry);
      }
    }

    // Deterministic sort
    readyEntries.sort((a, b) => {
      // 1. Sender ascending
      const senderComp = a.sender.localeCompare(b.sender);
      if (senderComp !== 0) return senderComp;

      // 2. Nonce ascending
      if (a.nonce !== b.nonce) return a.nonce - b.nonce;

      // 3. Transaction ID tie-breaker
      return a.transactionId.localeCompare(b.transactionId);
    });

    return readyEntries.slice(0, maxCount).map(entry => entry.transaction);
  }

  /**
   * Alias for getCandidateTransactions for compatibility
   */
  getPendingTransactions(limit = 100) {
    return this.getCandidateTransactions(limit);
  }

  /**
   * Promote queued transactions for a sender whose expected nonce has advanced.
   * Promotes consecutive nonces matching the newly expected nonce sequence.
   * 
   * @param {string} sender 
   * @returns {number} Number of transactions promoted from QUEUED to READY
   */
  promoteQueuedTransactions(sender) {
    if (!sender) return 0;
    const senderKey = this._normalizeSender(sender);
    const senderNonceMap = this.bySenderNonce.get(senderKey);
    if (!senderNonceMap || senderNonceMap.size === 0) return 0;

    let expectedNonce = this.stateManager ? this.stateManager.getExpectedNonce(sender) : 0;
    let promotedCount = 0;

    // Iterate through consecutive nonces starting at expectedNonce
    while (senderNonceMap.has(expectedNonce)) {
      const txId = senderNonceMap.get(expectedNonce);
      const entry = this.entries.get(txId);
      if (entry && entry.status === MempoolStatus.QUEUED && !entry.isExpired()) {
        entry.status = MempoolStatus.READY;
        promotedCount++;
        expectedNonce++;
      } else {
        break;
      }
    }

    return promotedCount;
  }

  /**
   * Remove transactions that were committed into a block from the active mempool.
   * 
   * @param {string[]} transactionIds - Array of included transaction IDs
   * @param {number} [blockNumber=null] - Block height where transactions were included
   * @returns {number} Number of transactions removed
   */
  removeIncludedTransactions(transactionIds, blockNumber = null) {
    if (!Array.isArray(transactionIds) || transactionIds.length === 0) {
      return 0;
    }

    let removedCount = 0;
    const sendersToPromote = new Set();

    for (const txId of transactionIds) {
      if (!txId) continue;
      const entry = this.entries.get(txId);
      if (entry) {
        entry.markIncluded(blockNumber);
        
        const senderKey = this._normalizeSender(entry.sender);
        const senderTxSet = this.bySender.get(senderKey);
        if (senderTxSet) {
          senderTxSet.delete(txId);
          if (senderTxSet.size === 0) {
            this.bySender.delete(senderKey);
          }
        }

        const senderNonceMap = this.bySenderNonce.get(senderKey);
        if (senderNonceMap) {
          senderNonceMap.delete(entry.nonce);
          if (senderNonceMap.size === 0) {
            this.bySenderNonce.delete(senderKey);
          }
        }

        this.entries.delete(txId);
        removedCount++;
        sendersToPromote.add(entry.sender);
      }
    }

    // Promote queued transactions for affected senders
    for (const sender of sendersToPromote) {
      this.promoteQueuedTransactions(sender);
    }

    return removedCount;
  }

  /**
   * Explicit cleanup of expired transactions based on TTL.
   * 
   * @param {number} [now=Date.now()] 
   * @returns {number} Number of expired transactions pruned
   */
  cleanupExpired(now = Date.now()) {
    let expiredCount = 0;
    const toDelete = [];

    for (const [txId, entry] of this.entries.entries()) {
      if (entry.isExpired(now)) {
        toDelete.push(txId);
      }
    }

    for (const txId of toDelete) {
      const entry = this.entries.get(txId);
      if (entry) {
        entry.status = MempoolStatus.EXPIRED;

        const senderKey = this._normalizeSender(entry.sender);
        const senderTxSet = this.bySender.get(senderKey);
        if (senderTxSet) {
          senderTxSet.delete(txId);
          if (senderTxSet.size === 0) this.bySender.delete(senderKey);
        }

        const senderNonceMap = this.bySenderNonce.get(senderKey);
        if (senderNonceMap) {
          senderNonceMap.delete(entry.nonce);
          if (senderNonceMap.size === 0) this.bySenderNonce.delete(senderKey);
        }

        this.entries.delete(txId);
        expiredCount++;
        this.metrics.expiredCount++;
      }
    }

    return expiredCount;
  }

  /**
   * Lookup a transaction by its transaction ID
   * @param {string} transactionId 
   * @returns {MempoolEntry|null}
   */
  getTransaction(transactionId) {
    if (!transactionId) return null;
    return this.entries.get(transactionId) || null;
  }

  /**
   * Get all pending entries for a specific sender
   * @param {string} sender 
   * @returns {MempoolEntry[]}
   */
  getTransactionsBySender(sender) {
    if (!sender) return [];
    const senderKey = this._normalizeSender(sender);
    const txIds = this.bySender.get(senderKey);
    if (!txIds) return [];

    const result = [];
    for (const txId of txIds) {
      const entry = this.entries.get(txId);
      if (entry && !entry.isExpired()) {
        result.push(entry);
      }
    }
    return result;
  }

  /**
   * Return array of all active pending transactions in the mempool
   * @param {string} [statusFilter] - Optional status filter ('READY' | 'QUEUED')
   * @returns {MempoolEntry[]}
   */
  getAllPending(statusFilter = null) {
    this.cleanupExpired();
    const list = [];
    for (const entry of this.entries.values()) {
      if (!entry.isExpired()) {
        if (!statusFilter || entry.status === statusFilter) {
          list.push(entry);
        }
      }
    }
    return list;
  }

  /**
   * Aggregate metrics and status counts for public observability
   */
  getStats() {
    this.cleanupExpired();

    let readyCount = 0;
    let queuedCount = 0;

    for (const entry of this.entries.values()) {
      if (entry.status === MempoolStatus.READY) readyCount++;
      else if (entry.status === MempoolStatus.QUEUED) queuedCount++;
    }

    const total = this.entries.size;
    const capacity = this.policy.maxTransactions;
    const utilization = capacity > 0 ? (total / capacity).toFixed(4) : '0.0000';

    return {
      total,
      ready: readyCount,
      queued: queuedCount,
      expired: this.metrics.expiredCount,
      accepted: this.metrics.acceptedCount,
      rejected: this.metrics.rejectedCount,
      duplicate: this.metrics.duplicateCount,
      nonceConflicts: this.metrics.nonceConflictCount,
      capacity,
      utilization: parseFloat(utilization),
      maxPerSender: this.policy.maxTransactionsPerSender,
      ttlMs: this.policy.transactionTTL
    };
  }
}

module.exports = Mempool;

