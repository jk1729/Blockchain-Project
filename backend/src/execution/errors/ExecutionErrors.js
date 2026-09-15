/**
 * PDSChain Execution Layer Structured Errors
 * 
 * Standardized error codes and error classes for deterministic rule validation and execution.
 */

const ExecutionErrorCodes = {
  INVALID_TRANSACTION_TYPE: 'INVALID_TRANSACTION_TYPE',
  UNAUTHORIZED_SENDER: 'UNAUTHORIZED_SENDER',
  BENEFICIARY_NOT_FOUND: 'BENEFICIARY_NOT_FOUND',
  BENEFICIARY_INELIGIBLE: 'BENEFICIARY_INELIGIBLE',
  SHOP_NOT_FOUND: 'SHOP_NOT_FOUND',
  WAREHOUSE_NOT_FOUND: 'WAREHOUSE_NOT_FOUND',
  COMMODITY_NOT_FOUND: 'COMMODITY_NOT_FOUND',
  INSUFFICIENT_ENTITLEMENT: 'INSUFFICIENT_ENTITLEMENT',
  INSUFFICIENT_STOCK: 'INSUFFICIENT_STOCK',
  INVALID_QUANTITY: 'INVALID_QUANTITY',
  INVALID_TRANSFER: 'INVALID_TRANSFER',
  ALREADY_APPLIED: 'ALREADY_APPLIED',
  REPLAYED_NONCE: 'REPLAYED_NONCE',
  INVALID_NONCE: 'INVALID_NONCE',
  INVALID_SIGNATURE: 'INVALID_SIGNATURE',
  STATE_CONFLICT: 'STATE_CONFLICT',
  STATE_ROOT_MISMATCH: 'STATE_ROOT_MISMATCH',
  STATE_CORRUPTED: 'STATE_CORRUPTED',
  EXECUTION_FAILED: 'EXECUTION_FAILED'
};

class ExecutionError extends Error {
  constructor(code, message, details = {}) {
    super(message || code);
    this.name = 'ExecutionError';
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
  ExecutionErrorCodes,
  ExecutionError
};

