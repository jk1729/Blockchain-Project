/**
 * PDSChain Mempool Entry
 * 
 * Represents a pending, staged transaction in the Mempool with lifecycle metadata.
 */

const Transaction = require('../Transaction');

const MempoolStatus = {
  READY: 'READY',       // Nonce matches expectedNonce, eligible for block selection
  QUEUED: 'QUEUED',     // Nonce > expectedNonce (future nonce), held until prior nonces are committed
  INCLUDED: 'INCLUDED', // Mined into a committed block
  EXPIRED: 'EXPIRED',   // TTL exceeded
  REJECTED: 'REJECTED'  // Failed admission or validation
};

class MempoolEntry {
  constructor({
    transaction,
    receivedAt = Date.now(),
    ttl = 3600000,
    status = MempoolStatus.READY,
    sizeBytes = 0
  }) {
    if (!transaction) {
      throw new Error('Transaction is required to create a MempoolEntry');
    }

    this.transaction = transaction instanceof Transaction ? transaction : Transaction.fromJSON(transaction);
    this.transactionId = this.transaction.transactionId || this.transaction.id;
    this.sender = this.transaction.sender;
    this.receiver = this.transaction.receiver;
    this.type = this.transaction.type;
    this.nonce = parseInt(this.transaction.nonce, 10) || 0;
    
    this.receivedAt = typeof receivedAt === 'number' ? receivedAt : new Date(receivedAt).getTime();
    this.expiresAt = this.receivedAt + ttl;
    this.status = status;
    this.sizeBytes = sizeBytes;
    this.includedBlockNumber = null;
    this.rejectionReason = null;
  }

  /**
   * Check if this entry has exceeded its time-to-live
   * @param {number} [now] 
   * @returns {boolean}
   */
  isExpired(now = Date.now()) {
    return now >= this.expiresAt;
  }

  /**
   * Mark entry as included in a finalized blockchain block
   * @param {number} blockNumber 
   */
  markIncluded(blockNumber) {
    this.status = MempoolStatus.INCLUDED;
    this.includedBlockNumber = blockNumber;
  }

  /**
   * Mark entry as rejected with a specific reason
   * @param {string} reason 
   */
  markRejected(reason) {
    this.status = MempoolStatus.REJECTED;
    this.rejectionReason = reason;
  }

  /**
   * Safe public summary representation (no private key or secrets)
   */
  toPublicSummary() {
    return {
      transactionId: this.transactionId,
      type: this.type,
      sender: this.sender,
      receiver: this.receiver,
      nonce: this.nonce,
      status: this.status,
      receivedAt: new Date(this.receivedAt).toISOString(),
      expiresAt: new Date(this.expiresAt).toISOString(),
      sizeBytes: this.sizeBytes,
      commodity: this.transaction.commodity,
      quantity: this.transaction.quantity,
      unit: this.transaction.unit,
      signature: this.transaction.signature ? `${this.transaction.signature.substring(0, 16)}...` : null
    };
  }

  /**
   * Full JSON representation
   */
  toJSON() {
    return {
      transactionId: this.transactionId,
      type: this.type,
      sender: this.sender,
      receiver: this.receiver,
      nonce: this.nonce,
      status: this.status,
      receivedAt: new Date(this.receivedAt).toISOString(),
      expiresAt: new Date(this.expiresAt).toISOString(),
      sizeBytes: this.sizeBytes,
      includedBlockNumber: this.includedBlockNumber,
      rejectionReason: this.rejectionReason,
      transaction: this.transaction.toJSON()
    };
  }
}

module.exports = {
  MempoolStatus,
  MempoolEntry
};

