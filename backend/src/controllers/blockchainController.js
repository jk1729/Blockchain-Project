const blockchainService = require('../services/blockchainService');
const transactionService = require('../services/transactionService');
const consensusService = require('../services/consensusService');
const ConsensusCertificate = require('../consensus/ConsensusCertificate');
const { getPublicParticipantInfo } = require('../blockchain/identity/keyManager');
const { verifyTransactionSignature } = require('../blockchain/identity/signature');
const stateManager = require('../execution/StateManager');
const { NotFoundError, ValidationError } = require('../utils/errors');

class BlockchainController {
  getBlockchain(req, res) {
    const chainData = blockchainService.getChain();
    res.status(200).json({
      success: true,
      ...chainData
    });
  }

  getBlocks(req, res) {
    const blocks = blockchainService.getBlocks();
    res.status(200).json({
      success: true,
      count: blocks.length,
      blocks
    });
  }

  getBlockByNumber(req, res, next) {
    try {
      const number = req.params.number;
      const block = blockchainService.getBlockByNumber(number);
      if (!block) {
        throw new NotFoundError(`Block #${number} not found.`);
      }

      res.status(200).json({
        success: true,
        block
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * Phase 6 Block Consensus Details
   * GET /api/blockchain/blocks/:number/consensus
   */
  getBlockConsensus(req, res, next) {
    try {
      const number = req.params.number;
      const block = blockchainService.getBlockByNumber(number);
      if (!block) {
        throw new NotFoundError(`Block #${number} not found.`);
      }

      res.status(200).json({
        success: true,
        blockNumber: block.blockNumber,
        blockHash: block.blockHash,
        proposerId: block.proposerId,
        proposerAddress: block.proposerAddress,
        proposerSignature: block.proposerSignature,
        proposalId: block.proposalId,
        round: block.round,
        consensusStatus: block.consensusStatus,
        consensusCertificate: block.consensusCertificate,
        validatorSignatures: block.validatorSignatures,
        isFinalized: block.consensusStatus === 'FINALIZED' || block.consensusStatus === 'VERIFIED'
      });
    } catch (err) {
      next(err);
    }
  }

  getTransactionById(req, res, next) {
    try {
      const txId = req.params.transactionId;
      const result = blockchainService.getTransactionById(txId);
      if (!result) {
        throw new NotFoundError(`Transaction '${txId}' not found on blockchain.`);
      }

      res.status(200).json({
        success: true,
        ...result
      });
    } catch (err) {
      next(err);
    }
  }

  validate(req, res) {
    const validation = blockchainService.validateChain();
    res.status(200).json({
      success: true,
      ...validation
    });
  }

  /**
   * Safe Public Cryptographic Identity Query
   * GET /api/blockchain/identity/:idOrAddress
   */
  getIdentity(req, res, next) {
    try {
      const { idOrAddress } = req.params;
      const info = getPublicParticipantInfo(idOrAddress);
      if (!info) {
        throw new NotFoundError(`Identity not found for '${idOrAddress}'.`);
      }

      const nextNonce = stateManager.getExpectedNonce(info.address);

      res.status(200).json({
        success: true,
        identity: {
          ...info,
          nextNonce
        }
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * Digital Signature & Transaction Verification
   * POST /api/blockchain/transactions/verify
   */
  verifyTransaction(req, res, next) {
    try {
      const transactionPayload = req.body;
      if (!transactionPayload) {
        throw new ValidationError('Transaction payload is required for verification.');
      }

      const result = verifyTransactionSignature(transactionPayload);

      res.status(200).json({
        success: true,
        ...result
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * Safe Mempool Transactions Query
   * GET /api/blockchain/mempool
   */
  getMempool(req, res, next) {
    try {
      const { status } = req.query;
      const transactions = transactionService.getMempoolTransactions(status ? status.toUpperCase() : null);
      const stats = transactionService.getMempoolStats();
      res.status(200).json({
        success: true,
        count: transactions.length,
        stats,
        transactions
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * Mempool Live Metrics
   * GET /api/blockchain/mempool/stats
   */
  getMempoolStats(req, res, next) {
    try {
      const stats = transactionService.getMempoolStats();
      res.status(200).json({
        success: true,
        stats
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * Query single Mempool Entry by Transaction ID
   * GET /api/blockchain/mempool/:transactionId
   */
  getMempoolTransaction(req, res, next) {
    try {
      const { transactionId } = req.params;
      const entry = transactionService.getMempoolTransactionById(transactionId);
      res.status(200).json({
        success: true,
        transaction: entry
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * Phase 5 Deterministic State Root Query
   * GET /api/blockchain/state/root
   */
  async getStateRoot(req, res, next) {
    try {
      const stateRoot = await blockchainService.getCurrentStateRoot();
      const latestBlock = blockchainService.blockchain.getLatestBlock();
      res.status(200).json({
        success: true,
        stateRoot,
        blockHeight: latestBlock ? latestBlock.blockNumber : 0,
        algorithm: 'SHA-256',
        version: 1
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * Phase 5 Consensus State Snapshot Query
   * GET /api/blockchain/state/snapshot
   */
  async getConsensusState(req, res, next) {
    try {
      const snapshot = await blockchainService.getConsensusStateSnapshot();
      res.status(200).json({
        success: true,
        snapshot
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * Phase 6 Standalone Consensus Certificate Verification
   * POST /api/blockchain/consensus/verify
   */
  verifyConsensusCertificate(req, res, next) {
    try {
      const { certificate, block } = req.body;
      if (!certificate || !block) {
        throw new ValidationError('Both certificate and block payloads are required for verification.');
      }

      const result = consensusService.verifyCertificate(certificate, block);
      res.status(200).json({
        success: true,
        ...result
      });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new BlockchainController();
