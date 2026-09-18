/**
 * PDSChain JSON-RPC 2.0 Transaction Methods (Phase 14)
 */

const blockchainService = require('../../services/blockchainService');
const transactionService = require('../../services/transactionService');
const { mempool } = require('../../blockchain/mempool');
const { evmRuntime } = require('../../evm');
const { RPC_ERRORS, JsonRpcError } = require('../JsonRpcErrors');

const transactionMethods = {
  /**
   * pds_getTransactionByHash
   * params: [txHash]
   */
  async pds_getTransactionByHash(params, context) {
    if (!params || !params[0]) {
      throw new JsonRpcError(RPC_ERRORS.INVALID_PARAMS, 'Expected [txHash]');
    }

    const txHash = String(params[0]).toLowerCase();

    // 1. Search in committed blocks
    const chain = blockchainService.blockchain ? blockchainService.blockchain.chain : [];
    for (const block of chain) {
      const txs = block.transactions || [];
      for (let i = 0; i < txs.length; i++) {
        const tx = txs[i];
        const hash = (tx.hash || tx.transactionId || tx.id || '').toLowerCase();
        if (hash === txHash) {
          return {
            transactionHash: tx.hash || tx.transactionId,
            transactionId: tx.transactionId || tx.id,
            blockNumber: block.blockNumber,
            blockHash: block.blockHash,
            transactionIndex: i,
            from: tx.sender || tx.from,
            to: tx.receiver || tx.to || tx.recipient,
            value: tx.quantity || tx.value || 0,
            commodity: tx.commodity,
            status: tx.status || 'Committed',
            finality: 'FINALIZED',
            timestamp: tx.timestamp
          };
        }
      }
    }

    // 2. Search in mempool
    const pending = mempool.getTransaction(txHash);
    if (pending) {
      return {
        transactionHash: pending.transactionId,
        transactionId: pending.transactionId,
        blockNumber: null,
        blockHash: null,
        transactionIndex: null,
        from: pending.sender,
        to: pending.receiver,
        value: pending.quantity || 0,
        commodity: pending.commodity,
        status: 'Pending',
        finality: 'PENDING',
        timestamp: pending.timestamp
      };
    }

    // 3. Search in DB TransactionModel
    try {
      const dbTx = await transactionService.getTransactionById(params[0]);
      if (dbTx) {
        return {
          transactionHash: dbTx.hash || dbTx.transactionId,
          transactionId: dbTx.transactionId,
          blockNumber: dbTx.blockNumber,
          blockHash: dbTx.blockHash,
          from: dbTx.sender || dbTx.shopId,
          to: dbTx.beneficiaryId,
          value: dbTx.quantity,
          commodity: dbTx.commodity,
          status: dbTx.status,
          finality: dbTx.blockNumber ? 'FINALIZED' : 'COMMITTED',
          timestamp: dbTx.timestamp
        };
      }
    } catch (e) {
      // Not found in DB
    }

    return null;
  },

  /**
   * pds_getTransactionReceipt
   * params: [txHash]
   */
  async pds_getTransactionReceipt(params, context) {
    if (!params || !params[0]) {
      throw new JsonRpcError(RPC_ERRORS.INVALID_PARAMS, 'Expected [txHash]');
    }

    const txHash = String(params[0]);
    try {
      const receipt = evmRuntime.getReceipt(txHash);
      if (receipt) {
        return typeof receipt.toJSON === 'function' ? receipt.toJSON() : receipt;
      }
    } catch (e) {
      // Ignore
    }

    // Check if tx exists in blockchain blocks to generate synthetic receipt
    const tx = await transactionMethods.pds_getTransactionByHash([txHash], context);
    if (!tx || !tx.blockNumber) {
      return null;
    }

    return {
      transactionHash: tx.transactionHash,
      transactionId: tx.transactionId,
      blockNumber: tx.blockNumber,
      blockHash: tx.blockHash,
      transactionIndex: tx.transactionIndex || 0,
      from: tx.from,
      to: tx.to,
      status: 1,
      gasUsed: 21000,
      cumulativeGasUsed: 21000,
      logs: [],
      finality: 'FINALIZED'
    };
  },

  /**
   * pds_sendRawTransaction
   * params: [signedTxPayload]
   */
  async pds_sendRawTransaction(params, context) {
    if (!params || !params[0]) {
      throw new JsonRpcError(RPC_ERRORS.INVALID_PARAMS, 'Expected [signedTxPayload]');
    }

    const rawTx = params[0];
    try {
      // If object, validate and insert into mempool
      const txObj = typeof rawTx === 'string' ? JSON.parse(rawTx) : rawTx;
      mempool.addTransaction(txObj);
      return txObj.transactionId || txObj.hash || '0x' + Date.now();
    } catch (err) {
      throw new JsonRpcError(RPC_ERRORS.TRANSACTION_REJECTED, `Transaction rejected: ${err.message}`, { details: err.message });
    }
  },

  /**
   * pds_estimateGas
   * params: [txObject]
   */
  async pds_estimateGas(params, context) {
    if (!params || !params[0]) {
      return 21000;
    }
    const tx = params[0];
    if (tx.data || tx.calldata || tx.contractAddress) {
      return 150000;
    }
    return 21000;
  }
};

module.exports = transactionMethods;

