/**
 * PDSChain JSON-RPC 2.0 Proof Methods (Phase 16 - Stage J)
 */

const blockchainService = require('../../services/blockchainService');
const { verifyMerkleProof, MerkleError, MERKLE_ERROR_CODES } = require('../../blockchain/merkle');
const { RPC_ERRORS, JsonRpcError } = require('../JsonRpcErrors');

const proofMethods = {
  /**
   * pds_getTransactionProof
   * params: [txHash, blockIdentifier]
   */
  async pds_getTransactionProof(params, context) {
    if (!params || params.length === 0 || !params[0]) {
      throw new JsonRpcError(RPC_ERRORS.INVALID_PARAMS, 'Expected [txHash, blockIdentifier?]');
    }

    const txHash = String(params[0]).trim();
    try {
      const proof = blockchainService.getTransactionProof(txHash);
      return proof.toJSON();
    } catch (err) {
      if (err.code === MERKLE_ERROR_CODES.PROOF_NOT_FOUND) {
        throw new JsonRpcError(RPC_ERRORS.RESOURCE_NOT_FOUND, err.message);
      }
      if (err.code === MERKLE_ERROR_CODES.NODE_SYNCING || err.code === MERKLE_ERROR_CODES.RECOVERY_REQUIRED) {
        throw new JsonRpcError(RPC_ERRORS.CONSENSUS_SYNC_ERROR, err.message);
      }
      throw new JsonRpcError(RPC_ERRORS.INTERNAL_ERROR, err.message);
    }
  },

  /**
   * pds_getReceiptProof
   * params: [txHash]
   */
  async pds_getReceiptProof(params, context) {
    if (!params || params.length === 0 || !params[0]) {
      throw new JsonRpcError(RPC_ERRORS.INVALID_PARAMS, 'Expected [txHash]');
    }

    const txHash = String(params[0]).trim();
    try {
      const proof = blockchainService.getReceiptProof(txHash);
      return proof.toJSON();
    } catch (err) {
      if (err.code === MERKLE_ERROR_CODES.PROOF_NOT_FOUND) {
        throw new JsonRpcError(RPC_ERRORS.RESOURCE_NOT_FOUND, err.message);
      }
      if (err.code === MERKLE_ERROR_CODES.COMMITMENT_MISMATCH) {
        throw new JsonRpcError(RPC_ERRORS.INVALID_PARAMS, err.message);
      }
      throw new JsonRpcError(RPC_ERRORS.INTERNAL_ERROR, err.message);
    }
  },

  /**
   * pds_getEventProof
   * params: [eventId]
   */
  async pds_getEventProof(params, context) {
    if (!params || params.length === 0 || !params[0]) {
      throw new JsonRpcError(RPC_ERRORS.INVALID_PARAMS, 'Expected [eventId]');
    }

    const eventId = String(params[0]).trim();
    try {
      return blockchainService.getEventProof(eventId);
    } catch (err) {
      if (err.code === MERKLE_ERROR_CODES.PROOF_NOT_FOUND) {
        throw new JsonRpcError(RPC_ERRORS.RESOURCE_NOT_FOUND, err.message);
      }
      throw new JsonRpcError(RPC_ERRORS.INTERNAL_ERROR, err.message);
    }
  },

  /**
   * pds_verifyMerkleProof
   * params: [proofObject, leafValueOrHash?, expectedRoot?]
   */
  async pds_verifyMerkleProof(params, context) {
    if (!params || params.length === 0 || !params[0] || typeof params[0] !== 'object') {
      throw new JsonRpcError(RPC_ERRORS.INVALID_PARAMS, 'Expected [proofObject, leafValueOrHash?, expectedRoot?]');
    }

    const proof = params[0];
    const leaf = params[1] || null;
    const expectedRoot = params[2] || null;

    const t0 = Date.now();
    const result = verifyMerkleProof(proof, leaf, expectedRoot);
    const durationMs = Date.now() - t0;

    blockchainService.proofMetrics.recordVerification(result.valid, durationMs, Boolean(result.reason === MERKLE_ERROR_CODES.MALFORMED_PROOF));

    return result;
  },

  /**
   * pds_getMerkleRoot
   * params: [blockIdentifier, commitmentType?]
   */
  async pds_getMerkleRoot(params, context) {
    if (!params || params.length === 0) {
      throw new JsonRpcError(RPC_ERRORS.INVALID_PARAMS, 'Expected [blockIdentifier, commitmentType?]');
    }

    const identifier = params[0];
    const type = String(params[1] || 'TRANSACTION').toUpperCase();

    let block = null;
    if (identifier === 'latest') {
      block = blockchainService.blockchain.getLatestBlock();
    } else if (typeof identifier === 'number' || /^\d+$/.test(String(identifier))) {
      block = blockchainService.blockchain.getBlockByNumber(Number(identifier));
    } else {
      block = blockchainService.blockchain.chain.find(b =>
        (b.blockHash && b.blockHash.toLowerCase() === String(identifier).toLowerCase()) ||
        (b.hash && b.hash.toLowerCase() === String(identifier).toLowerCase())
      );
    }

    if (!block) {
      throw new JsonRpcError(RPC_ERRORS.RESOURCE_NOT_FOUND, `Block '${identifier}' not found`);
    }

    if (type === 'RECEIPT') {
      return {
        blockNumber: block.blockNumber !== undefined ? block.blockNumber : block.index,
        blockHash: block.blockHash || block.hash,
        commitmentType: 'RECEIPT',
        root: block.receiptsRoot || null
      };
    }

    return {
      blockNumber: block.blockNumber !== undefined ? block.blockNumber : block.index,
      blockHash: block.blockHash || block.hash,
      commitmentType: 'TRANSACTION',
      root: block.merkleRoot
    };
  },

  /**
   * pds_getProofStatus
   * params: []
   */
  async pds_getProofStatus(params, context) {
    return blockchainService.getProofStatus();
  }
};

module.exports = proofMethods;

