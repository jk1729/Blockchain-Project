/**
 * PDSChain Rule Registry
 * 
 * Maps blockchain transaction types to their deterministic smart-contract-like execution rules.
 */

const BaseRule = require('./BaseRule');
const AuthorizationRule = require('./AuthorizationRule');
const EntitlementRule = require('./EntitlementRule');
const InventoryRule = require('./InventoryRule');
const DistributionRule = require('./DistributionRule');
const WarehouseTransferRule = require('./WarehouseTransferRule');

const ruleRegistry = {
  DISTRIBUTION: new DistributionRule(),
  ENTITLEMENT: new EntitlementRule(),
  DEDUCT_QUOTA: new EntitlementRule(),
  INVENTORY: new InventoryRule(),
  SHOP_STOCK_DEDUCTION: new InventoryRule(),
  WAREHOUSE_TRANSFER: new WarehouseTransferRule(),
  TRANSFER: new WarehouseTransferRule()
};

/**
 * Retrieve the deterministic rule handler for a given transaction type
 * @param {string} transactionType 
 * @returns {BaseRule|null}
 */
function getRuleForType(transactionType) {
  if (!transactionType) return null;
  const key = String(transactionType).toUpperCase().trim();
  return ruleRegistry[key] || null;
}

module.exports = {
  BaseRule,
  AuthorizationRule,
  EntitlementRule,
  InventoryRule,
  DistributionRule,
  WarehouseTransferRule,
  ruleRegistry,
  getRuleForType
};

