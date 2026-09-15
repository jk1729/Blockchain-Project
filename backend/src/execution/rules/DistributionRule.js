/**
 * PDSChain Distribution Rule
 * 
 * Composite smart-contract-like rule orchestrating atomic grain distributions:
 * 1. Beneficiary Entitlement Quota Deduction
 * 2. Fair Price Shop Inventory Stock Deduction
 * 
 * Guarantees atomicity: Both state transitions commit together or fail completely.
 */

const BaseRule = require('./BaseRule');
const EntitlementRule = require('./EntitlementRule');
const InventoryRule = require('./InventoryRule');
const AuthorizationRule = require('./AuthorizationRule');

class DistributionRule extends BaseRule {
  constructor() {
    super();
    this.entitlementRule = new EntitlementRule();
    this.inventoryRule = new InventoryRule();
  }

  /**
   * Validate both entitlement and shop stock without mutating state.
   */
  async validate(context, stateManager, options = {}) {
    AuthorizationRule.validateAuthorization(context);

    // 1. Validate Entitlement
    const entitlementValidation = await this.entitlementRule.validate(context, stateManager, options);

    // 2. Validate Shop Inventory
    const inventoryValidation = await this.inventoryRule.validate(context, stateManager, options);

    const combinedChanges = [
      ...entitlementValidation.predictedChanges,
      ...inventoryValidation.predictedChanges
    ];

    return {
      valid: true,
      beneficiary: entitlementValidation.beneficiary,
      maxQuota: entitlementValidation.maxQuota,
      alreadyClaimed: entitlementValidation.alreadyClaimed,
      remainingQuota: entitlementValidation.remainingQuota,
      shopInventory: inventoryValidation.shopInventory,
      availableStock: inventoryValidation.availableStock,
      predictedChanges: combinedChanges
    };
  }

  /**
   * Execute atomic multi-entity distribution state transition.
   */
  async execute(context, stateManager, options = {}) {
    const validation = await this.validate(context, stateManager, options);
    const { beneficiaryId, shopId, commodity, quantity } = context;

    // 1. Apply Quota State Transition
    const quotaResult = await stateManager.applyEntitlementDeduction(
      beneficiaryId,
      commodity,
      quantity,
      options.dbTransaction
    );

    // 2. Apply Shop Stock State Transition
    const stockResult = await stateManager.applyShopStockDeduction(
      shopId,
      commodity,
      quantity,
      options.dbTransaction
    );

    return {
      success: true,
      quotaResult,
      stockResult,
      stateChanges: validation.predictedChanges
    };
  }
}

module.exports = DistributionRule;

