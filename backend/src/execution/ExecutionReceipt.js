/**
 * PDSChain Execution Receipt
 * 
 * Represents the deterministic result of transaction execution, including
 * ordered state transition changes, execution status, and audit metadata.
 */

class ExecutionReceipt {
  constructor({
    transactionId,
    status = 'SUCCESS',
    transactionType = 'DISTRIBUTION',
    stateChanges = [],
    errorCode = null,
    errorMessage = null,
    blockNumber = 0,
    blockHash = '',
    consensusRound = '',
    timestamp = '',
    verificationStatus = 'CRYPTOGRAPHICALLY_VERIFIED_ON_CHAIN'
  }) {
    this.receiptNumber = `REC-${(transactionId || '').replace(/^TXN-/, '')}`;
    this.transactionId = transactionId;
    this.status = status; // 'SUCCESS' | 'FAILED' | 'REJECTED'
    this.transactionType = transactionType;
    this.stateChanges = this._sortStateChanges(stateChanges);
    this.errorCode = errorCode;
    this.errorMessage = errorMessage;
    this.blockNumber = parseInt(blockNumber, 10) || 0;
    this.blockHash = blockHash || '';
    this.consensusRound = consensusRound || '';
    this.timestamp = timestamp;
    this.verificationStatus = verificationStatus;
  }

  /**
   * Deterministically sort state changes by entity, id, and field
   * @param {Array<object>} changes 
   * @returns {Array<object>}
   */
  _sortStateChanges(changes) {
    if (!Array.isArray(changes)) return [];
    return [...changes].sort((a, b) => {
      const entityComp = String(a.entity || '').localeCompare(String(b.entity || ''));
      if (entityComp !== 0) return entityComp;

      const idComp = String(a.id || '').localeCompare(String(b.id || ''));
      if (idComp !== 0) return idComp;

      return String(a.field || '').localeCompare(String(b.field || ''));
    });
  }

  /**
   * Factory method: Create a successful execution receipt
   */
  static success({
    transactionId,
    transactionType,
    stateChanges = [],
    blockNumber = 0,
    blockHash = '',
    consensusRound = '',
    timestamp = ''
  }) {
    return new ExecutionReceipt({
      transactionId,
      status: 'SUCCESS',
      transactionType,
      stateChanges,
      errorCode: null,
      errorMessage: null,
      blockNumber,
      blockHash,
      consensusRound,
      timestamp
    });
  }

  /**
   * Factory method: Create a failed execution receipt
   */
  static failure({
    transactionId,
    transactionType,
    errorCode,
    errorMessage,
    blockNumber = 0,
    blockHash = '',
    consensusRound = '',
    timestamp = ''
  }) {
    return new ExecutionReceipt({
      transactionId,
      status: 'FAILED',
      transactionType,
      stateChanges: [],
      errorCode,
      errorMessage,
      blockNumber,
      blockHash,
      consensusRound,
      timestamp,
      verificationStatus: 'EXECUTION_REJECTED'
    });
  }

  toJSON() {
    return {
      receiptNumber: this.receiptNumber,
      transactionId: this.transactionId,
      status: this.status,
      transactionType: this.transactionType,
      stateChanges: this.stateChanges,
      errorCode: this.errorCode,
      errorMessage: this.errorMessage,
      blockNumber: this.blockNumber,
      blockHash: this.blockHash,
      consensusRound: this.consensusRound,
      timestamp: this.timestamp,
      verificationStatus: this.verificationStatus
    };
  }
}

module.exports = ExecutionReceipt;
