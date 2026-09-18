/**
 * PDSChain v1 Blockchain Routes (Phase 14)
 */

const express = require('express');
const router = express.Router();
const blockchainService = require('../../services/blockchainService');
const { sendSuccess, sendError } = require('../../api/ResponseEnvelope');
const { paginateArray } = require('../../api/CursorPagination');

// GET /api/v1/blockchain
router.get('/', (req, res) => {
  const chainData = blockchainService.getChain();
  return sendSuccess(res, chainData, { finality: 'FINALIZED' });
});

// GET /api/v1/blockchain/blocks (cursor-paginated)
router.get('/blocks', (req, res) => {
  const rawBlocks = blockchainService.getBlocks();
  const paginated = paginateArray(rawBlocks, {
    cursor: req.query.cursor,
    limit: req.query.limit || 20
  });

  return sendSuccess(res, paginated.items, {
    pagination: paginated.pageInfo,
    finality: 'FINALIZED'
  });
});

// GET /api/v1/blockchain/blocks/:number
router.get('/blocks/:number', (req, res) => {
  const num = req.params.number;
  const block = blockchainService.getBlockByNumber(num);
  if (!block) {
    return sendError(res, 'BLOCK_NOT_FOUND', `Block #${num} not found.`, null, 404);
  }
  return sendSuccess(res, block, { finality: 'FINALIZED' });
});

// GET /api/v1/blockchain/blocks/:number/consensus
router.get('/blocks/:number/consensus', (req, res) => {
  const num = req.params.number;
  const block = blockchainService.getBlockByNumber(num);
  if (!block) {
    return sendError(res, 'BLOCK_NOT_FOUND', `Block #${num} not found.`, null, 404);
  }

  return sendSuccess(res, {
    blockNumber: block.blockNumber,
    blockHash: block.blockHash,
    consensusCertificate: block.consensusCertificate || null,
    fbaRound: block.fbaRound || 0,
    validatorsCount: block.fbaValidators || 12
  }, { finality: 'FINALIZED' });
});

// GET /api/v1/blockchain/validate
router.get('/validate', (req, res) => {
  const validation = blockchainService.validateChain();
  return sendSuccess(res, validation, { finality: 'FINALIZED' });
});

// GET /api/v1/blockchain/mempool
router.get('/mempool', (req, res) => {
  const txs = blockchainService.mempool ? blockchainService.mempool.getAllTransactions() : [];
  return sendSuccess(res, txs, { finality: 'PENDING' });
});

// GET /api/v1/blockchain/mempool/stats
router.get('/mempool/stats', (req, res) => {
  const stats = blockchainService.mempool ? blockchainService.mempool.getStats() : { size: 0, bytes: 0 };
  return sendSuccess(res, stats, { finality: 'PENDING' });
});

// GET /api/v1/blockchain/state/root
router.get('/state/root', (req, res) => {
  const latest = blockchainService.blockchain ? blockchainService.blockchain.getLatestBlock() : null;
  return sendSuccess(res, {
    stateRoot: latest ? latest.stateRoot : null,
    blockNumber: latest ? latest.blockNumber : 0
  }, { finality: 'FINALIZED' });
});

module.exports = router;

