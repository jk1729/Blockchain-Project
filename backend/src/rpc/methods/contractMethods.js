/**
 * PDSChain JSON-RPC 2.0 Smart Contract Methods (Phase 14)
 */

const { evmRuntime, contractRegistry, ABIEncoder } = require('../../evm');
const { RPC_ERRORS, JsonRpcError } = require('../JsonRpcErrors');

const contractMethods = {
  /**
   * pds_call
   * params: [callObject, blockTag]
   */
  async pds_call(params, context) {
    if (!params || !params[0]) {
      throw new JsonRpcError(RPC_ERRORS.INVALID_PARAMS, 'Expected [callObject, blockTag]');
    }

    const callObj = params[0];
    const contractAddress = callObj.to || callObj.contractAddress;
    if (!contractAddress) {
      throw new JsonRpcError(RPC_ERRORS.INVALID_PARAMS, 'Missing required "to" or "contractAddress" field');
    }

    await evmRuntime.initialize();

    // If method & args are passed, execute view call with decoding
    if (callObj.method) {
      try {
        const result = await evmRuntime.executeViewCall({
          contractAddress,
          method: callObj.method,
          args: callObj.args || [],
          caller: callObj.from || null
        });
        return result;
      } catch (err) {
        throw new JsonRpcError(RPC_ERRORS.EXECUTION_ERROR, `Contract call reverted: ${err.message}`, { details: err.message });
      }
    }

    // Direct calldata execution via rawCall
    try {
      await evmRuntime.stateAdapter.checkpoint();
      try {
        const callerAddr = callObj.from || evmRuntime.adminAddress;
        const calldata = callObj.data || callObj.calldata || '0x';
        const rawRes = await evmRuntime.rawCall({
          caller: callerAddr,
          to: contractAddress,
          data: calldata,
          gasLimit: BigInt(callObj.gas || 500000)
        });

        const exec = rawRes.execResult;
        if (exec.exceptionError) {
          const reason = ABIEncoder.decodeRevertReason(exec.returnValue);
          throw new Error(reason);
        }
        return '0x' + Buffer.from(exec.returnValue || []).toString('hex');
      } finally {
        await evmRuntime.stateAdapter.revert();
      }
    } catch (err) {
      throw new JsonRpcError(RPC_ERRORS.EXECUTION_ERROR, `Execution error: ${err.message}`, { details: err.message });
    }
  },

  /**
   * pds_getCode
   * params: [address]
   */
  async pds_getCode(params, context) {
    if (!params || !params[0]) {
      throw new JsonRpcError(RPC_ERRORS.INVALID_PARAMS, 'Expected [address]');
    }

    const address = String(params[0]).toLowerCase();
    const contract = contractRegistry.getContractByAddress(address);
    if (contract && contract.bytecode) {
      return contract.bytecode.startsWith('0x') ? contract.bytecode : '0x' + contract.bytecode;
    }
    return '0x';
  },

  /**
   * pds_getStorageAt
   * params: [address, position]
   */
  async pds_getStorageAt(params, context) {
    return '0x0000000000000000000000000000000000000000000000000000000000000000';
  },

  /**
   * pds_getLogs
   * params: [filterObject]
   */
  async pds_getLogs(params, context) {
    const filter = (params && params[0]) || {};
    const address = filter.address ? String(filter.address).toLowerCase() : null;
    const allEvents = evmRuntime.getEvents(address);

    let filtered = allEvents;
    if (filter.fromBlock !== undefined) {
      const from = parseInt(filter.fromBlock, 10);
      filtered = filtered.filter(e => !e.blockNumber || e.blockNumber >= from);
    }
    if (filter.toBlock !== undefined) {
      const to = parseInt(filter.toBlock, 10);
      filtered = filtered.filter(e => !e.blockNumber || e.blockNumber <= to);
    }

    return filtered.map((e, idx) => ({
      logIndex: idx,
      blockNumber: e.blockNumber || null,
      transactionHash: e.transactionId || null,
      address: e.contractAddress,
      eventName: e.eventName || e.name || null,
      args: e.args || e.params || {},
      data: e.data || '0x',
      topics: e.topics || []
    }));
  }
};

module.exports = contractMethods;

