const BaseRule = require('./BaseRule');
const { evmRuntime, resolveEVMCaller } = require('../../evm');
const { ExecutionError, ExecutionErrorCodes } = require('../errors/ExecutionErrors');

/**
 * PDSChain ContractCallRule
 * 
 * Execution rule for CONTRACT_CALL transactions invoking Solidity smart contracts on the EVM.
 */
class ContractCallRule extends BaseRule {
  /**
   * Pure side-effect-free simulation of smart contract call against parent state.
   */
  async validate(context, stateManager, options = {}) {
    const payload = context.payload || {};
    const contractAddress = payload.contractAddress || context.receiver;

    if (!contractAddress || typeof contractAddress !== 'string' || !contractAddress.startsWith('0x') || contractAddress.length !== 42) {
      throw new ExecutionError(
        ExecutionErrorCodes.INVALID_TRANSACTION_TYPE,
        `Invalid contractAddress: '${contractAddress}'. Must be a 20-byte hex address.`
      );
    }

    if (!payload.method && !payload.calldata) {
      throw new ExecutionError(
        ExecutionErrorCodes.INVALID_TRANSACTION_TYPE,
        'Contract call transaction must specify either method or calldata.'
      );
    }

    const caller = resolveEVMCaller(context.transaction || context);

    // Run side-effect-free simulation in isolated checkpoint
    await evmRuntime.stateAdapter.checkpoint();
    let simReceipt;
    try {
      simReceipt = await evmRuntime.executeContractCall({
        transactionId: context.transactionId,
        caller,
        contractAddress,
        method: payload.method,
        args: payload.args || [],
        calldata: payload.calldata,
        gasLimit: payload.gasLimit || 500000,
        blockNumber: options.blockNumber || 1,
        timestamp: context.timestamp
      });
    } finally {
      // Strictly revert simulation changes so parent state remains untouched
      await evmRuntime.stateAdapter.revert();
    }

    if (simReceipt.isRevert()) {
      throw new ExecutionError(
        ExecutionErrorCodes.BUSINESS_RULE_VIOLATION,
        `Contract call pre-execution simulation reverted: ${simReceipt.revertReason || 'Reverted'}`
      );
    }

    return {
      valid: true,
      predictedChanges: [
        {
          type: 'EVM_CONTRACT_CALL',
          contractAddress,
          method: payload.method,
          gasUsed: simReceipt.gasUsed,
          receiptHash: simReceipt.receiptHash
        }
      ]
    };
  }

  /**
   * Atomic execution of contract call on EVM state.
   */
  async execute(context, stateManager, options = {}) {
    const payload = context.payload || {};
    const contractAddress = payload.contractAddress || context.receiver;
    const caller = resolveEVMCaller(context.transaction || context);

    const receipt = await evmRuntime.executeContractCall({
      transactionId: context.transactionId,
      caller,
      contractAddress,
      method: payload.method,
      args: payload.args || [],
      calldata: payload.calldata,
      gasLimit: payload.gasLimit || 500000,
      blockNumber: options.blockNumber || 1,
      timestamp: context.timestamp
    });

    if (receipt.isRevert()) {
      throw new ExecutionError(
        ExecutionErrorCodes.EXECUTION_FAILED,
        `Contract call execution reverted: ${receipt.revertReason || 'Reverted'}`
      );
    }

    return {
      success: true,
      receipt,
      stateChanges: [
        {
          type: 'EVM_CONTRACT_CALL',
          contractAddress,
          method: payload.method,
          gasUsed: receipt.gasUsed,
          receiptHash: receipt.receiptHash,
          returnData: receipt.returnData
        }
      ]
    };
  }
}

module.exports = ContractCallRule;

