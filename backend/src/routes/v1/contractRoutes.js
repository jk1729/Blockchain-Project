/**
 * PDSChain v1 Contract Routes (Phase 14)
 */

const express = require('express');
const router = express.Router();
const { contractRegistry, evmRuntime } = require('../../evm');
const { sendSuccess, sendError } = require('../../api/ResponseEnvelope');
const { optionalAuthMiddleware } = require('../../middleware/authMiddleware');

// GET /api/v1/contracts
router.get('/', async (req, res, next) => {
  try {
    await evmRuntime.initialize();
    const all = contractRegistry.getAllContracts().map(c => ({
      name: c.name,
      address: c.address,
      codeHash: c.codeHash,
      methodsCount: c.abi ? c.abi.filter(i => i.type === 'function').length : 0,
      eventsCount: c.abi ? c.abi.filter(i => i.type === 'event').length : 0
    }));

    const stateRoot = await evmRuntime.getStateRoot();
    return sendSuccess(res, {
      chainId: 1729,
      evmStateRoot: stateRoot,
      contracts: all
    }, { finality: 'FINALIZED' });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/contracts/:address
router.get('/:address', async (req, res, next) => {
  try {
    await evmRuntime.initialize();
    const param = req.params.address;
    let contract = null;
    if (param.startsWith('0x')) {
      contract = contractRegistry.getContractByAddress(param);
    } else {
      contract = contractRegistry.getContract(param);
    }

    if (!contract) {
      return sendError(res, 'CONTRACT_NOT_FOUND', `Contract '${param}' not found.`, null, 404);
    }

    return sendSuccess(res, {
      name: contract.name,
      address: contract.address,
      codeHash: contract.codeHash,
      abi: contract.abi
    }, { finality: 'FINALIZED' });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/contracts/:address/events
router.get('/:address/events', async (req, res, next) => {
  try {
    await evmRuntime.initialize();
    const events = evmRuntime.getEvents(req.params.address);
    return sendSuccess(res, events, { finality: 'FINALIZED' });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/contracts/call
router.post('/call', optionalAuthMiddleware, async (req, res, next) => {
  try {
    const { contractAddress, method, args = [], isView = false } = req.body;
    if (!contractAddress) {
      return sendError(res, 'VALIDATION_ERROR', 'contractAddress is required.', null, 422);
    }

    await evmRuntime.initialize();

    if (isView) {
      const result = await evmRuntime.executeViewCall({
        contractAddress,
        method,
        args,
        caller: req.user ? req.user.address : null
      });
      return sendSuccess(res, result, { isView: true, finality: 'FINALIZED' });
    }

    // State-modifying call
    const receipt = await evmRuntime.executeContractCall({
      transactionId: '0x' + Date.now().toString(16),
      caller: req.user ? req.user.address : evmRuntime.adminAddress,
      contractAddress,
      method,
      args
    });

    return sendSuccess(res, receipt.toJSON ? receipt.toJSON() : receipt, { finality: 'COMMITTED' });
  } catch (err) {
    return sendError(res, 'CONTRACT_EXECUTION_ERROR', err.message, null, 400);
  }
});

module.exports = router;

