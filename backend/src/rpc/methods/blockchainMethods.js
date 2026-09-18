/**
 * PDSChain JSON-RPC 2.0 Blockchain Methods (Phase 14)
 */

const blockchainService = require('../../services/blockchainService');
const { RPC_ERRORS, JsonRpcError } = require('../JsonRpcErrors');

const blockchainMethods = {
  /**
   * pds_blockNumber
   * Returns current block height.
   */
  async pds_blockNumber(params, context) {
    const latest = blockchainService.blockchain ? blockchainService.blockchain.getLatestBlock() : null;
    return latest ? latest.blockNumber : 0;
  },

  /**
   * pds_getBlockByNumber
   * params: [blockNumberOrTag, includeTxs]
   */
  async pds_getBlockByNumber(params, context) {
    if (!params || params.length === 0) {
      throw new JsonRpcError(RPC_ERRORS.INVALID_PARAMS, 'Expected [blockNumberOrTag, includeTxs]');
    }

    const tag = params[0];
    const includeTxs = Boolean(params[1]);
    let blockNumber;

    if (tag === 'latest') {
      const latest = blockchainService.blockchain.getLatestBlock();
      blockNumber = latest ? latest.blockNumber : 0;
    } else if (tag === 'earliest') {
      blockNumber = 0;
    } else if (typeof tag === 'string' && tag.startsWith('0x')) {
      blockNumber = parseInt(tag, 16);
    } else {
      blockNumber = parseInt(tag, 10);
    }

    if (isNaN(blockNumber)) {
      throw new JsonRpcError(RPC_ERRORS.INVALID_PARAMS, `Invalid block number or tag: '${tag}'`);
    }

    const block = blockchainService.getBlockByNumber(blockNumber);
    if (!block) {
      return null;
    }

    const raw = typeof block.toJSON === 'function' ? block.toJSON() : block;
    if (!includeTxs) {
      return {
        ...raw,
        transactions: (raw.transactions || []).map(t => t.hash || t.transactionId || t.id || '')
      };
    }
    return raw;
  },

  /**
   * pds_getBlockByHash
   * params: [blockHash, includeTxs]
   */
  async pds_getBlockByHash(params, context) {
    if (!params || !params[0]) {
      throw new JsonRpcError(RPC_ERRORS.INVALID_PARAMS, 'Expected [blockHash, includeTxs]');
    }

    const hash = String(params[0]).toLowerCase();
    const includeTxs = Boolean(params[1]);

    const chain = blockchainService.blockchain ? blockchainService.blockchain.chain : [];
    const block = chain.find(b => (b.blockHash && b.blockHash.toLowerCase() === hash) || (b.hash && b.hash.toLowerCase() === hash));
    
    if (!block) {
      return null;
    }

    const raw = typeof block.toJSON === 'function' ? block.toJSON() : block;
    if (!includeTxs) {
      return {
        ...raw,
        transactions: (raw.transactions || []).map(t => t.hash || t.transactionId || t.id || '')
      };
    }
    return raw;
  },

  /**
   * pds_getBlockTransactionCountByNumber
   * params: [blockNumberOrTag]
   */
  async pds_getBlockTransactionCountByNumber(params, context) {
    if (!params || params.length === 0) {
      throw new JsonRpcError(RPC_ERRORS.INVALID_PARAMS, 'Expected [blockNumberOrTag]');
    }
    const block = await blockchainMethods.pds_getBlockByNumber([params[0], true], context);
    if (!block) return null;
    return (block.transactions || []).length;
  },

  /**
   * pds_getBlockTransactionCountByHash
   * params: [blockHash]
   */
  async pds_getBlockTransactionCountByHash(params, context) {
    if (!params || !params[0]) {
      throw new JsonRpcError(RPC_ERRORS.INVALID_PARAMS, 'Expected [blockHash]');
    }
    const block = await blockchainMethods.pds_getBlockByHash([params[0], true], context);
    if (!block) return null;
    return (block.transactions || []).length;
  },

  /**
   * pds_validateChain
   * Validates blockchain integrity
   */
  async pds_validateChain(params, context) {
    return blockchainService.validateChain();
  }
};

module.exports = blockchainMethods;

