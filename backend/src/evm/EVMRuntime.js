let _createVM = null;
let _createAddressFromString = null;

async function getEVMModules() {
  if (!_createVM) {
    const vmMod = await import('@ethereumjs/vm');
    _createVM = vmMod.createVM;
  }
  if (!_createAddressFromString) {
    const utilMod = await import('@ethereumjs/util');
    _createAddressFromString = utilMod.createAddressFromString;
  }
  return { createVM: _createVM, createAddressFromString: _createAddressFromString };
}

const { ethers } = require('ethers');
const contractRegistry = require('./ContractRegistry');
const EVMStateAdapter = require('./EVMStateAdapter');
const EVMReceipt = require('./EVMReceipt');
const ABIEncoder = require('./ABIEncoder');
const { GAS_LIMITS, validateAndCapGas } = require('./ExecutionGasPolicy');
const { SYSTEM_EVM_ACCOUNTS } = require('./identityBridge');
const logger = require('../utils/logger');

/**
 * PDSChain Embedded EVM Runtime
 * 
 * Provides deterministic EVM smart contract execution embedded directly in PDSChain nodes.
 */
class EVMRuntime {
  constructor() {
    this.vm = null;
    this.stateAdapter = new EVMStateAdapter();
    this.isInitialized = false;
    this.chainId = 1729n;
    this.adminAddress = SYSTEM_EVM_ACCOUNTS.ADMIN;
    this.historicalReceipts = new Map(); // txId -> EVMReceipt
    this.contractEvents = []; // historical decoded events
  }

  /**
   * Helper to convert hex address string to EthereumJS Address
   */
  toAddress(addrStr) {
    const clean = (addrStr || '0x0').startsWith('0x') ? addrStr.substring(2) : addrStr;
    if (_createAddressFromString) {
      return _createAddressFromString(`0x${clean.padStart(40, '0')}`);
    }
    return {
      toString: () => `0x${clean.padStart(40, '0').toLowerCase()}`
    };
  }

  /**
   * Initialize VM instance and deploy/bootstrap the 8 PDS contracts
   */
  async initialize() {
    if (this.isInitialized && this.vm) {
      return this;
    }

    logger.info('Initializing PDSChain Embedded EVM Runtime (Chain ID: 1729)...');

    // Dynamically load EVM modules
    const { createVM } = await getEVMModules();

    // Create EVM instance
    this.vm = await createVM();
    this.stateAdapter.setVM(this.vm);

    // Bootstrap deterministic deployment of all 8 PDS contracts
    await this.bootstrapContracts();

    this.isInitialized = true;
    logger.info('PDSChain EVM Runtime initialized successfully with 8 smart contracts.');
    return this;
  }

  /**
   * Deploy contract with constructor execution in the EVM
   */
  async deployContract(meta, constructorArgs = [], deployerAddress = this.adminAddress) {
    const deployerAddr = this.toAddress(deployerAddress);

    let encodedConstructor = '';
    if (constructorArgs.length > 0 && meta.abi) {
      const ctor = meta.abi.find(item => item.type === 'constructor');
      if (ctor && ctor.inputs) {
        encodedConstructor = ethers.AbiCoder.defaultAbiCoder().encode(
          ctor.inputs.map(i => i.type),
          constructorArgs
        );
      }
    }

    const initData = Buffer.concat([
      Buffer.from(meta.bytecode.replace(/^0x/, ''), 'hex'),
      Buffer.from(encodedConstructor.replace(/^0x/, ''), 'hex')
    ]);

    const deployResult = await this.vm.evm.runCall({
      caller: deployerAddr,
      data: initData,
      gasLimit: 5_000_000n
    });

    if (deployResult.execResult.exceptionError) {
      throw new Error(`Deployment of ${meta.name} failed: ${deployResult.execResult.exceptionError.error}`);
    }

    const deployedAddress = deployResult.createdAddress.toString();
    contractRegistry.setContractAddress(meta.name, deployedAddress);
    return deployedAddress;
  }

  /**
   * Deterministically deploy and wire all 8 PDS contracts in sequence
   */
  async bootstrapContracts() {
    contractRegistry.loadAllArtifacts();
    const adminAddr = this.toAddress(this.adminAddress);

    // Give admin account sufficient gas balance
    await this.vm.stateManager.modifyAccountFields(adminAddr, {
      balance: 100_000_000_000_000_000_000n // 100 ETH
    });

    // 1. Deploy PDSRegistry (Master Registry)
    const pdsMeta = contractRegistry.getContract('PDSRegistry');
    if (!pdsMeta) throw new Error('PDSRegistry contract artifact not found');
    const pdsAddr = await this.deployContract(pdsMeta, []);

    // 2. Deploy Subsystem Registries and Managers
    const benMeta = contractRegistry.getContract('BeneficiaryRegistry');
    const benAddr = await this.deployContract(benMeta, [pdsAddr]);

    const shopMeta = contractRegistry.getContract('ShopRegistry');
    const shopAddr = await this.deployContract(shopMeta, [pdsAddr]);

    const whMeta = contractRegistry.getContract('WarehouseRegistry');
    const whAddr = await this.deployContract(whMeta, [pdsAddr]);

    const comMeta = contractRegistry.getContract('CommodityRegistry');
    const comAddr = await this.deployContract(comMeta, [pdsAddr]);

    const invMeta = contractRegistry.getContract('InventoryManager');
    const invAddr = await this.deployContract(invMeta, [pdsAddr]);

    const entMeta = contractRegistry.getContract('EntitlementManager');
    const entAddr = await this.deployContract(entMeta, [pdsAddr]);

    const distMeta = contractRegistry.getContract('DistributionManager');
    const distAddr = await this.deployContract(distMeta, [pdsAddr]);

    // 3. Wire Subsystem Addresses in PDSRegistry
    const setters = [
      { method: 'setBeneficiaryRegistry', addr: benAddr },
      { method: 'setShopRegistry', addr: shopAddr },
      { method: 'setWarehouseRegistry', addr: whAddr },
      { method: 'setCommodityRegistry', addr: comAddr },
      { method: 'setInventoryManager', addr: invAddr },
      { method: 'setEntitlementManager', addr: entAddr },
      { method: 'setDistributionManager', addr: distAddr }
    ];

    for (const s of setters) {
      const calldata = ABIEncoder.encodeCall(pdsMeta.abi, s.method, [s.addr]);
      await this.rawCall({
        caller: this.adminAddress,
        to: pdsAddr,
        data: calldata,
        gasLimit: 500_000n
      });
    }

    logger.info(`PDS Contracts Deployed & Wired in EVM: PDSRegistry=${pdsAddr}`);
  }

  /**
   * Low-level raw EVM call execution against current state
   */
  async rawCall({ caller, to, data, gasLimit = GAS_LIMITS.DEFAULT_CALL_GAS, value = 0n }) {
    if (!this.vm) await this.initialize();

    const callerAddr = this.toAddress(caller);
    const toAddr = to ? this.toAddress(to) : undefined;
    const dataBuffer = Buffer.isBuffer(data) ? data : Buffer.from((data || '0x').replace(/^0x/, ''), 'hex');

    const result = await this.vm.evm.runCall({
      caller: callerAddr,
      to: toAddr,
      data: dataBuffer,
      gasLimit: BigInt(gasLimit),
      value: BigInt(value)
    });

    return result;
  }

  /**
   * Execute a contract invocation with standard receipt generation, gas accounting,
   * and event log decoding.
   */
  async executeContractCall({
    transactionId,
    caller,
    contractAddress,
    method,
    args = [],
    calldata = null,
    gasLimit = GAS_LIMITS.DEFAULT_CALL_GAS,
    blockNumber = 1,
    timestamp = null
  }) {
    if (!this.vm) await this.initialize();

    let approvedGas;
    try {
      approvedGas = validateAndCapGas(gasLimit);
    } catch (err) {
      return EVMReceipt.revert({
        transactionId,
        contractAddress,
        gasUsed: 0,
        revertReason: err.message,
        blockNumber
      });
    }
    const contractMeta = contractRegistry.getContractByAddress(contractAddress);

    // Resolve calldata: use provided calldata or encode via ABI
    let encodedData = calldata;
    if (!encodedData && contractMeta && contractMeta.abi && method) {
      encodedData = ABIEncoder.encodeCall(contractMeta.abi, method, args);
    }

    if (!encodedData) {
      return EVMReceipt.revert({
        transactionId,
        contractAddress,
        gasUsed: 0,
        revertReason: 'Missing method calldata or contract ABI',
        blockNumber
      });
    }

    try {
      const runResult = await this.rawCall({
        caller,
        to: contractAddress,
        data: encodedData,
        gasLimit: approvedGas
      });

      const exec = runResult.execResult;
      const gasUsed = Number(exec.executionGasUsed);
      const returnDataHex = '0x' + Buffer.from(exec.returnValue || []).toString('hex');
      const hasError = !!exec.exceptionError;

      if (hasError) {
        const reason = ABIEncoder.decodeRevertReason(exec.returnValue);
        const revertReceipt = EVMReceipt.revert({
          transactionId,
          contractAddress,
          gasUsed,
          revertReason: reason,
          returnData: returnDataHex,
          blockNumber
        });
        this.historicalReceipts.set(transactionId, revertReceipt);
        return revertReceipt;
      }

      // Decode emitted logs if ABI available
      const rawLogs = exec.logs || [];
      const decodedLogs = contractMeta && contractMeta.abi
        ? ABIEncoder.decodeLogs(contractMeta.abi, rawLogs)
        : [];

      // Record decoded events
      for (const ev of decodedLogs) {
        this.contractEvents.push({
          ...ev,
          contractAddress,
          transactionId,
          blockNumber,
          timestamp: timestamp || new Date().toISOString()
        });
      }

      const receipt = EVMReceipt.success({
        transactionId,
        contractAddress,
        gasUsed,
        returnData: returnDataHex,
        logs: decodedLogs,
        blockNumber
      });

      this.historicalReceipts.set(transactionId, receipt);
      return receipt;
    } catch (err) {
      const failReceipt = EVMReceipt.revert({
        transactionId,
        contractAddress,
        gasUsed: Number(approvedGas),
        revertReason: err.message || 'EVM execution exception',
        blockNumber
      });
      this.historicalReceipts.set(transactionId, failReceipt);
      return failReceipt;
    }
  }

  /**
   * Execute read-only view / pure contract method (zero side-effects)
   */
  async executeViewCall({ contractAddress, method, args = [], caller = null }) {
    if (!this.vm) await this.initialize();

    const contractMeta = contractRegistry.getContractByAddress(contractAddress);
    if (!contractMeta || !contractMeta.abi) {
      throw new Error(`Contract at ${contractAddress} not found in registry.`);
    }

    const calldata = ABIEncoder.encodeCall(contractMeta.abi, method, args);
    const callerAddr = caller || this.adminAddress;

    // Execute in isolated checkpoint so view call has zero side-effects
    await this.stateAdapter.checkpoint();
    try {
      const rawRes = await this.rawCall({
        caller: callerAddr,
        to: contractAddress,
        data: calldata,
        gasLimit: 500_000n
      });

      const exec = rawRes.execResult;
      if (exec.exceptionError) {
        const reason = ABIEncoder.decodeRevertReason(exec.returnValue);
        throw new Error(`View call reverted: ${reason}`);
      }

      const returnDataHex = '0x' + Buffer.from(exec.returnValue || []).toString('hex');
      const decoded = ABIEncoder.decodeReturn(contractMeta.abi, method, returnDataHex);
      return decoded;
    } finally {
      await this.stateAdapter.revert();
    }
  }

  getReceipt(transactionId) {
    return this.historicalReceipts.get(transactionId) || null;
  }

  getEvents(contractAddress = null) {
    if (!contractAddress) return this.contractEvents;
    const target = contractAddress.toLowerCase();
    return this.contractEvents.filter(e => e.contractAddress.toLowerCase() === target);
  }

  async getStateRoot() {
    return await this.stateAdapter.getEVMStateRoot();
  }
}

module.exports = new EVMRuntime();
