const crypto = require('crypto');

/**
 * PDSChain EVM Execution Receipt
 * 
 * Represents the immutable, cryptographically verifiable result of an EVM contract execution.
 */
class EVMReceipt {
  constructor({
    transactionId,
    contractAddress,
    status = 'SUCCESS', // 'SUCCESS' | 'REVERT' | 'OUT_OF_GAS'
    gasUsed = 0,
    returnData = '0x',
    logs = [],
    revertReason = null,
    blockNumber = null,
    blockHash = null,
    timestamp = null
  } = {}) {
    this.transactionId = transactionId;
    this.contractAddress = contractAddress ? contractAddress.toLowerCase() : null;
    this.status = status;
    this.gasUsed = Number(gasUsed) || 0;
    this.returnData = returnData || '0x';
    this.logs = Array.isArray(logs) ? logs : [];
    this.revertReason = revertReason || null;
    this.blockNumber = blockNumber !== null ? Number(blockNumber) : null;
    this.blockHash = blockHash || null;
    this.timestamp = timestamp || new Date().toISOString();
    this.receiptHash = this.calculateHash();
  }

  isSuccess() {
    return this.status === 'SUCCESS';
  }

  isRevert() {
    return this.status === 'REVERT' || this.status === 'OUT_OF_GAS';
  }

  calculateHash() {
    const canonicalStr = JSON.stringify({
      transactionId: this.transactionId,
      contractAddress: this.contractAddress,
      status: this.status,
      gasUsed: this.gasUsed,
      returnData: this.returnData,
      logs: this.logs,
      revertReason: this.revertReason
    });

    return '0x' + crypto.createHash('sha256').update(canonicalStr, 'utf8').digest('hex');
  }

  toJSON() {
    return {
      transactionId: this.transactionId,
      contractAddress: this.contractAddress,
      status: this.status,
      gasUsed: this.gasUsed,
      returnData: this.returnData,
      logs: this.logs,
      revertReason: this.revertReason,
      receiptHash: this.receiptHash,
      blockNumber: this.blockNumber,
      blockHash: this.blockHash,
      timestamp: this.timestamp
    };
  }

  static success({ transactionId, contractAddress, gasUsed, returnData, logs, blockNumber, blockHash }) {
    return new EVMReceipt({
      transactionId,
      contractAddress,
      status: 'SUCCESS',
      gasUsed,
      returnData,
      logs,
      revertReason: null,
      blockNumber,
      blockHash
    });
  }

  static revert({ transactionId, contractAddress, gasUsed, revertReason, returnData, logs, blockNumber, blockHash }) {
    return new EVMReceipt({
      transactionId,
      contractAddress,
      status: 'REVERT',
      gasUsed,
      returnData,
      logs: logs || [],
      revertReason,
      blockNumber,
      blockHash
    });
  }
}

module.exports = EVMReceipt;

