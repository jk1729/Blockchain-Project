/**
 * PDSChain Merkle Proof REST Controller (Phase 16 - Stage I)
 */

const blockchainService = require('../services/blockchainService');
const { verifyMerkleProof, MerkleError, MERKLE_ERROR_CODES } = require('../blockchain/merkle');
const logger = require('../utils/logger');

function buildEnvelope(data, meta = {}, error = null) {
  return {
    data,
    meta: {
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      finality: meta.finality || (data && data.finality) || 'FINALIZED',
      ...meta
    },
    error
  };
}

function buildErrorEnvelope(status, code, message, req = null) {
  return {
    data: null,
    meta: {
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      requestId: (req && (req.id || req.headers['x-request-id'])) || null,
      finality: 'UNKNOWN'
    },
    error: {
      code,
      message
    }
  };
}

const proofController = {
  /**
   * GET /api/v1/proofs/transactions/:txHash
   */
  async getTransactionProof(req, res) {
    const { txHash } = req.params;
    if (!txHash) {
      return res.status(400).json(buildErrorEnvelope(400, 'INVALID_PARAMS', 'Transaction hash or ID is required', req));
    }

    try {
      const proof = blockchainService.getTransactionProof(txHash);
      const json = proof.toJSON();
      return res.json(buildEnvelope(json, {
        requestId: req.id || req.headers['x-request-id'] || json.requestId,
        finality: json.finality
      }));
    } catch (err) {
      if (err.code === MERKLE_ERROR_CODES.PROOF_NOT_FOUND) {
        return res.status(404).json(buildErrorEnvelope(404, err.code, err.message, req));
      }
      if (err.code === MERKLE_ERROR_CODES.NODE_SYNCING || err.code === MERKLE_ERROR_CODES.RECOVERY_REQUIRED) {
        return res.status(503).json(buildErrorEnvelope(503, err.code, err.message, req));
      }
      logger.error(`[proofController] Failed to generate transaction proof for ${txHash}:`, err);
      return res.status(500).json(buildErrorEnvelope(500, 'INTERNAL_ERROR', err.message, req));
    }
  },

  /**
   * GET /api/v1/proofs/blocks/:height/transactions/:index
   */
  async getBlockTransactionProofByIndex(req, res) {
    const { height, index } = req.params;
    const bNum = parseInt(height, 10);
    const txIdx = parseInt(index, 10);

    if (isNaN(bNum) || isNaN(txIdx) || txIdx < 0) {
      return res.status(400).json(buildErrorEnvelope(400, 'INVALID_PARAMS', 'Valid block height and transaction index required', req));
    }

    try {
      const block = blockchainService.blockchain.getBlockByNumber(bNum);
      if (!block) {
        return res.status(404).json(buildErrorEnvelope(404, 'BLOCK_NOT_FOUND', `Block #${bNum} not found`, req));
      }

      const txs = block.transactions || [];
      if (txIdx >= txs.length) {
        return res.status(400).json(buildErrorEnvelope(400, 'INDEX_OUT_OF_BOUNDS', `Transaction index ${txIdx} out of bounds (block has ${txs.length} transactions)`, req));
      }

      const { MerkleTree } = require('../blockchain/merkle');
      const tree = new MerkleTree(txs, { version: block.version || 1, commitmentType: 'TRANSACTION' });
      const targetTx = txs[txIdx];
      const targetHash = targetTx.hash || targetTx.transactionId || targetTx.id || '';

      const proof = tree.getProof(txIdx, {
        blockHeight: block.blockNumber !== undefined ? block.blockNumber : block.index,
        blockHash: block.blockHash || block.hash,
        transactionHash: targetHash,
        finality: block.consensusStatus || 'FINALIZED'
      });

      return res.json(buildEnvelope(proof.toJSON(), {
        requestId: req.id || req.headers['x-request-id'] || proof.requestId,
        finality: proof.finality
      }));
    } catch (err) {
      logger.error(`[proofController] Failed to generate proof for block #${bNum} index ${txIdx}:`, err);
      return res.status(500).json(buildErrorEnvelope(500, 'INTERNAL_ERROR', err.message, req));
    }
  },

  /**
   * GET /api/v1/proofs/receipts/:txHash
   */
  async getReceiptProof(req, res) {
    const { txHash } = req.params;
    if (!txHash) {
      return res.status(400).json(buildErrorEnvelope(400, 'INVALID_PARAMS', 'Transaction hash or receipt identifier is required', req));
    }

    try {
      const proof = blockchainService.getReceiptProof(txHash);
      const json = proof.toJSON();
      return res.json(buildEnvelope(json, {
        requestId: req.id || req.headers['x-request-id'] || json.requestId,
        finality: json.finality
      }));
    } catch (err) {
      if (err.code === MERKLE_ERROR_CODES.PROOF_NOT_FOUND) {
        return res.status(404).json(buildErrorEnvelope(404, err.code, err.message, req));
      }
      if (err.code === MERKLE_ERROR_CODES.COMMITMENT_MISMATCH) {
        return res.status(400).json(buildErrorEnvelope(400, err.code, err.message, req));
      }
      return res.status(500).json(buildErrorEnvelope(500, 'INTERNAL_ERROR', err.message, req));
    }
  },

  /**
   * GET /api/v1/proofs/events/:eventId
   */
  async getEventProof(req, res) {
    const { eventId } = req.params;
    if (!eventId) {
      return res.status(400).json(buildErrorEnvelope(400, 'INVALID_PARAMS', 'Event ID is required', req));
    }

    try {
      const proofData = blockchainService.getEventProof(eventId);
      return res.json(buildEnvelope(proofData, {
        requestId: req.id || req.headers['x-request-id'],
        finality: proofData.finality
      }));
    } catch (err) {
      if (err.code === MERKLE_ERROR_CODES.PROOF_NOT_FOUND) {
        return res.status(404).json(buildErrorEnvelope(404, err.code, err.message, req));
      }
      return res.status(500).json(buildErrorEnvelope(500, 'INTERNAL_ERROR', err.message, req));
    }
  },

  /**
   * POST /api/v1/proofs/verify
   * Request body: { proof: object, leaf?: string, expectedRoot?: string }
   */
  async verifyProof(req, res) {
    const { proof, leaf, expectedRoot } = req.body || {};
    if (!proof || typeof proof !== 'object') {
      return res.status(400).json(buildErrorEnvelope(400, 'MALFORMED_PROOF', 'Request body must contain a valid "proof" object', req));
    }

    const t0 = Date.now();
    const result = verifyMerkleProof(proof, leaf, expectedRoot);
    const durationMs = Date.now() - t0;

    blockchainService.proofMetrics.recordVerification(result.valid, durationMs, Boolean(result.reason === MERKLE_ERROR_CODES.MALFORMED_PROOF));

    return res.json(buildEnvelope(result, {
      requestId: req.id || req.headers['x-request-id'] || null,
      verifiedAt: new Date().toISOString()
    }));
  },

  /**
   * GET /api/v1/proofs/blocks/:identifier/tree
   */
  async getBlockTree(req, res) {
    const { identifier } = req.params;
    const treeData = blockchainService.getBlockTree(identifier);

    if (!treeData) {
      return res.status(404).json(buildErrorEnvelope(404, 'BLOCK_NOT_FOUND', `Block '${identifier}' not found`, req));
    }

    return res.json(buildEnvelope(treeData, {
      requestId: req.id || req.headers['x-request-id']
    }));
  },

  /**
   * GET /api/v1/proofs/status
   */
  async getProofStatus(req, res) {
    const status = blockchainService.getProofStatus();
    return res.json(buildEnvelope(status, {
      requestId: req.id || req.headers['x-request-id']
    }));
  }
};

module.exports = proofController;

