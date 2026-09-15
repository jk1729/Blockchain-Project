/**
 * PDSChain Deterministic Execution Context
 * 
 * Encapsulates all transaction and environmental parameters needed for deterministic rule execution.
 * Eliminates non-deterministic dependencies (no hidden Date.now(), Math.random(), or network calls).
 */

const Transaction = require('../blockchain/Transaction');

class ExecutionContext {
  constructor({
    transactionId,
    transactionType,
    sender,
    senderPublicKey = null,
    receiver,
    beneficiaryId = null,
    shopId = null,
    warehouseId = null,
    commodity = null,
    quantity = 0,
    unit = 'KG',
    name = '',
    nonce = 0,
    timestamp,
    blockHeight = 0,
    blockHash = '',
    consensusRound = '',
    payload = {},
    stateSnapshot = null
  }) {
    this.transactionId = transactionId;
    this.transactionType = (transactionType || 'DISTRIBUTION').toUpperCase();
    this.sender = sender;
    this.senderPublicKey = senderPublicKey;
    this.receiver = receiver;
    this.beneficiaryId = beneficiaryId;
    this.shopId = shopId;
    this.warehouseId = warehouseId;
    this.commodity = commodity;
    this.quantity = typeof quantity === 'number' ? quantity : parseFloat(quantity) || 0;
    this.unit = unit || 'KG';
    this.name = name || '';
    this.nonce = parseInt(nonce, 10) || 0;
    this.timestamp = timestamp;
    this.blockHeight = parseInt(blockHeight, 10) || 0;
    this.blockHash = blockHash || '';
    this.consensusRound = consensusRound || '';
    this.payload = payload || {};
    this.stateSnapshot = stateSnapshot;
  }

  /**
   * Factory method: Construct ExecutionContext from a Transaction instance or object
   * @param {Transaction|object} tx 
   * @param {object} [options] 
   * @returns {ExecutionContext}
   */
  static fromTransaction(tx, options = {}) {
    const transaction = tx instanceof Transaction ? tx : Transaction.fromJSON(tx);
    const p = transaction.payload || {};

    const beneficiaryId = transaction.beneficiaryId || p.beneficiaryId || p.beneficiary || null;
    const shopId = transaction.shopId || p.shopId || p.shop || (transaction.receiver && transaction.receiver.startsWith('FPS-') ? transaction.receiver : null);
    const warehouseId = p.warehouseId || p.warehouse || (transaction.sender && transaction.sender.startsWith('WH-') ? transaction.sender : null);
    const commodity = transaction.commodity || p.commodity || p.item || null;
    const quantity = transaction.quantity !== undefined ? transaction.quantity : (p.quantity !== undefined ? p.quantity : 0);
    const unit = transaction.unit || p.unit || 'KG';
    const name = transaction.name || transaction.beneficiaryName || p.name || p.beneficiaryName || '';

    return new ExecutionContext({
      transactionId: transaction.transactionId || transaction.id,
      transactionType: transaction.type,
      sender: transaction.sender,
      senderPublicKey: transaction.senderPublicKey,
      receiver: transaction.receiver,
      beneficiaryId,
      shopId,
      warehouseId,
      commodity,
      quantity,
      unit,
      name,
      nonce: transaction.nonce,
      timestamp: transaction.timestamp,
      blockHeight: options.blockHeight || options.blockNumber || 0,
      blockHash: options.blockHash || '',
      consensusRound: options.consensusRound || p.consensusRound || '',
      payload: p,
      stateSnapshot: options.stateSnapshot || null
    });
  }

  toJSON() {
    return {
      transactionId: this.transactionId,
      transactionType: this.transactionType,
      sender: this.sender,
      senderPublicKey: this.senderPublicKey,
      receiver: this.receiver,
      beneficiaryId: this.beneficiaryId,
      shopId: this.shopId,
      warehouseId: this.warehouseId,
      commodity: this.commodity,
      quantity: this.quantity,
      unit: this.unit,
      name: this.name,
      nonce: this.nonce,
      timestamp: this.timestamp,
      blockHeight: this.blockHeight,
      blockHash: this.blockHash,
      consensusRound: this.consensusRound,
      payload: this.payload
    };
  }
}

module.exports = ExecutionContext;

