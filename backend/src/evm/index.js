const evmRuntime = require('./EVMRuntime');
const contractRegistry = require('./ContractRegistry');
const EVMStateAdapter = require('./EVMStateAdapter');
const EVMReceipt = require('./EVMReceipt');
const ABIEncoder = require('./ABIEncoder');
const { GAS_LIMITS, GasLimitExceededError, validateAndCapGas } = require('./ExecutionGasPolicy');
const { deriveEVMAddress, resolveEVMCaller, SYSTEM_EVM_ACCOUNTS } = require('./identityBridge');

module.exports = {
  evmRuntime,
  contractRegistry,
  EVMStateAdapter,
  EVMReceipt,
  ABIEncoder,
  GAS_LIMITS,
  GasLimitExceededError,
  validateAndCapGas,
  deriveEVMAddress,
  resolveEVMCaller,
  SYSTEM_EVM_ACCOUNTS
};

