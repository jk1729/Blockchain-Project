/**
 * PDSChain Mempool Structured Errors
 * 
 * Standardized error codes and error classes for the Transaction Mempool admission pipeline.
 */

const MempoolErrorCodes = {
  MEMPOOL_FULL: 'MEMPOOL_FULL',
  SENDER_LIMIT_EXCEEDED: 'SENDER_LIMIT_EXCEEDED',
  DUPLICATE_TRANSACTION: 'DUPLICATE_TRANSACTION',
  CONFLICTING_NONCE: 'CONFLICTING_NONCE',
  INVALID_SIGNATURE: 'INVALID_SIGNATURE',
  INVALID_TRANSACTION_ID: 'INVALID_TRANSACTION_ID',
  INVALID_NONCE: 'INVALID_NONCE',
  REPLAYED_NONCE: 'REPLAYED_NONCE',
  NONCE_GAP: 'NONCE_GAP',
  TRANSACTION_EXPIRED: 'TRANSACTION_EXPIRED',
  TRANSACTION_TOO_LARGE: 'TRANSACTION_TOO_LARGE',
  MALFORMED_TRANSACTION: 'MALFORMED_TRANSACTION'
};

class MempoolError extends Error {
  constructor(code, message, details = {}) {
    super(message || code);
    this.name = 'MempoolError';
    this.code = code;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      details: this.details
    };
  }
}

module.exports = {
  MempoolErrorCodes,
  MempoolError
};

