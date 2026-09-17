const { contractRegistry, evmRuntime } = require('../evm');
const transactionService = require('../services/transactionService');
const { NotFoundError, ValidationError } = require('../utils/errors');

class ContractController {
  /**
   * GET /api/contracts
   * List all deployed contracts and their addresses
   */
  async getContracts(req, res, next) {
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

      res.status(200).json({
        success: true,
        evmStateRoot: stateRoot,
        chainId: 1729,
        contracts: all
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/contracts/:addressOrName
   * Retrieve contract details, ABI, and bytecode metadata
   */
  async getContractDetails(req, res, next) {
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
        throw new NotFoundError(`Contract '${param}' not found.`);
      }

      res.status(200).json({
        success: true,
        contract: {
          name: contract.name,
          address: contract.address,
          codeHash: contract.codeHash,
          abi: contract.abi
        }
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/contracts/:address/events
   * Retrieve historical decoded events emitted by this contract
   */
  async getContractEvents(req, res, next) {
    try {
      const address = req.params.address;
      const events = evmRuntime.getEvents(address);

      res.status(200).json({
        success: true,
        contractAddress: address,
        count: events.length,
        events
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/contracts/transactions/:id/receipt
   * GET /api/transactions/:id/receipt
   * Retrieve execution receipt for a transaction
   */
  async getTransactionReceipt(req, res, next) {
    try {
      const transactionId = req.params.id;
      const receipt = evmRuntime.getReceipt(transactionId);

      if (!receipt) {
        throw new NotFoundError(`Execution receipt for transaction '${transactionId}' not found.`);
      }

      res.status(200).json({
        success: true,
        receipt: receipt.toJSON ? receipt.toJSON() : receipt
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/contracts/call
   * Execute view call (read-only) or state-changing contract transaction through consensus
   */
  async callContract(req, res, next) {
    try {
      const { contractAddress, method, args = [], calldata, isView = false } = req.body;

      if (!contractAddress) {
        throw new ValidationError('contractAddress is required.');
      }

      await evmRuntime.initialize();

      if (isView) {
        // Read-only view method
        const result = await evmRuntime.executeViewCall({
          contractAddress,
          method,
          args,
          caller: req.user ? req.user.address : null
        });

        return res.status(200).json({
          success: true,
          mode: 'VIEW',
          contractAddress,
          method,
          result
        });
      }

      // State-changing transaction: submit through transactionService (mempool + FBA consensus)
      const result = await transactionService.processContractCall(req.body, req.user);
      return res.status(200).json({
        success: true,
        mode: 'TRANSACTION',
        ...result
      });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new ContractController();

