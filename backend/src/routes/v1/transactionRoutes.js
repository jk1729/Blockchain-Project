/**
 * PDSChain v1 Transaction Routes (Phase 14)
 */

const express = require('express');
const router = express.Router();
const transactionService = require('../../services/transactionService');
const contractController = require('../../controllers/contractController');
const { authMiddleware, optionalAuthMiddleware } = require('../../middleware/authMiddleware');
const roleMiddleware = require('../../middleware/roleMiddleware');
const { sendSuccess, sendError } = require('../../api/ResponseEnvelope');
const { paginateArray } = require('../../api/CursorPagination');
const { defaultIdempotencyManager } = require('../../api/IdempotencyManager');
const { evmRuntime } = require('../../evm');

// GET /api/v1/transactions
router.get('/', optionalAuthMiddleware, async (req, res, next) => {
  try {
    const list = await transactionService.getAllTransactions(req.query.limit || 100);
    const paginated = paginateArray(list.map(t => t.toJSON ? t.toJSON() : t), {
      cursor: req.query.cursor,
      limit: req.query.limit || 20
    });

    return sendSuccess(res, paginated.items, {
      pagination: paginated.pageInfo,
      finality: 'COMMITTED'
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/transactions/:id/receipt
router.get('/:id/receipt', async (req, res, next) => {
  try {
    const txId = req.params.id;
    const receipt = evmRuntime.getReceipt(txId);
    if (!receipt) {
      return sendError(res, 'RECEIPT_NOT_FOUND', `Execution receipt for transaction '${txId}' not found.`, null, 404);
    }
    return sendSuccess(res, receipt.toJSON ? receipt.toJSON() : receipt, { finality: 'FINALIZED' });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/transactions/:id
router.get('/:id', optionalAuthMiddleware, async (req, res, next) => {
  try {
    const tx = await transactionService.getTransactionById(req.params.id);
    if (!tx) {
      return sendError(res, 'TRANSACTION_NOT_FOUND', `Transaction '${req.params.id}' not found.`, null, 404);
    }
    return sendSuccess(res, tx.toJSON ? tx.toJSON() : tx, {
      finality: tx.blockNumber ? 'FINALIZED' : 'COMMITTED'
    });
  } catch (err) {
    return sendError(res, 'TRANSACTION_NOT_FOUND', `Transaction '${req.params.id}' not found.`, null, 404);
  }
});

// POST /api/v1/transactions
router.post('/',
  authMiddleware,
  roleMiddleware('SHOP', 'ADMIN'),
  defaultIdempotencyManager.middleware(),
  async (req, res, next) => {
    try {
      const result = await transactionService.processDistributionTransaction(req.body, req.user);
      return sendSuccess(res, result, { finality: result.blockNumber ? 'FINALIZED' : 'COMMITTED' }, 201);
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;

