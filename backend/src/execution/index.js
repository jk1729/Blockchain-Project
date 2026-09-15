/**
 * PDSChain Execution Layer Entry Point
 */

const executionEngine = require('./ExecutionEngine');
const stateManager = require('./StateManager');
const ExecutionContext = require('./ExecutionContext');
const ExecutionReceipt = require('./ExecutionReceipt');
const { ExecutionErrorCodes, ExecutionError } = require('./errors/ExecutionErrors');
const {
  BaseRule,
  AuthorizationRule,
  EntitlementRule,
  InventoryRule,
  DistributionRule,
  WarehouseTransferRule,
  ruleRegistry,
  getRuleForType
} = require('./rules');

module.exports = {
  ExecutionEngine: executionEngine,
  executionEngine,
  StateManager: stateManager,
  stateManager,
  ExecutionContext,
  ExecutionReceipt,
  ExecutionErrorCodes,
  ExecutionError,
  rules: {
    BaseRule,
    AuthorizationRule,
    EntitlementRule,
    InventoryRule,
    DistributionRule,
    WarehouseTransferRule,
    ruleRegistry,
    getRuleForType
  }
};

