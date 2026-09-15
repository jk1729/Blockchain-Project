/**
 * PDSChain Entitlement Rule
 * 
 * Deterministically validates citizen eligibility, monthly quota allowances,
 * and manages quota deductions without floating-point inaccuracies.
 */

const BaseRule = require('./BaseRule');
const AuthorizationRule = require('./AuthorizationRule');
const { ExecutionErrorCodes, ExecutionError } = require('../errors/ExecutionErrors');

class EntitlementRule extends BaseRule {
  /**
   * Validate entitlement preconditions without mutating state.
   */
  async validate(context, stateManager, options = {}) {
    AuthorizationRule.validateAuthorization(context);

    const { beneficiaryId, commodity, quantity, unit } = context;

    if (!beneficiaryId || beneficiaryId === 'SYSTEM') {
      throw new ExecutionError(
        ExecutionErrorCodes.BENEFICIARY_NOT_FOUND,
        'Valid beneficiary ID is required for entitlement validation.'
      );
    }

    if (!commodity) {
      throw new ExecutionError(
        ExecutionErrorCodes.COMMODITY_NOT_FOUND,
        'Commodity name is required for entitlement validation.'
      );
    }

    const qty = typeof quantity === 'number' ? quantity : parseFloat(quantity);
    if (isNaN(qty) || qty <= 0) {
      throw new ExecutionError(
        ExecutionErrorCodes.INVALID_QUANTITY,
        `Quantity must be greater than zero. Provided: ${quantity}`
      );
    }

    // 1. Fetch Beneficiary State
    let ben;
    try {
      ben = await stateManager.getBeneficiaryState(beneficiaryId, options.dbTransaction);
    } catch (err) {
      throw new ExecutionError(
        ExecutionErrorCodes.BENEFICIARY_NOT_FOUND,
        `Beneficiary '${beneficiaryId}' not found in state.`
      );
    }

    // 2. Check Eligibility Status
    if (ben.status !== 'Active' || !ben.eligibilityStatus) {
      throw new ExecutionError(
        ExecutionErrorCodes.BENEFICIARY_INELIGIBLE,
        `Beneficiary '${beneficiaryId}' is not eligible for distribution (Status: ${ben.status}).`
      );
    }

    // 3. Quota Evaluation
    const entitlements = ben.monthlyEntitlement || {};
    const claimed = ben.currentMonthClaimed || {};

    const maxQuota = parseFloat(entitlements[commodity] || entitlements[commodity.toLowerCase()] || 0);
    const alreadyClaimed = parseFloat(claimed[commodity] || claimed[commodity.toLowerCase()] || 0);
    const remainingQuota = Math.max(0, Math.round((maxQuota - alreadyClaimed) * 100) / 100);

    if (maxQuota <= 0) {
      throw new ExecutionError(
        ExecutionErrorCodes.INSUFFICIENT_ENTITLEMENT,
        `Beneficiary '${beneficiaryId}' has zero entitlement for commodity '${commodity}'.`
      );
    }

    if (qty > remainingQuota) {
      throw new ExecutionError(
        ExecutionErrorCodes.INSUFFICIENT_ENTITLEMENT,
        `Requested quantity (${qty} ${unit}) exceeds remaining monthly quota (${remainingQuota} ${unit}).`,
        { maxQuota, alreadyClaimed, remainingQuota, requested: qty }
      );
    }

    const newClaimed = Math.round((alreadyClaimed + qty) * 100) / 100;

    return {
      valid: true,
      beneficiary: ben,
      maxQuota,
      alreadyClaimed,
      remainingQuota,
      predictedChanges: [
        {
          entity: 'beneficiary',
          id: ben.beneficiaryId,
          field: `currentMonthClaimed.${commodity}`,
          before: alreadyClaimed,
          after: newClaimed,
          delta: qty,
          unit: unit || 'KG'
        }
      ]
    };
  }

  /**
   * Atomically apply entitlement quota deduction.
   */
  async execute(context, stateManager, options = {}) {
    const validation = await this.validate(context, stateManager, options);
    const { beneficiaryId, commodity, quantity, unit } = context;

    const result = await stateManager.applyEntitlementDeduction(
      beneficiaryId,
      commodity,
      quantity,
      options.dbTransaction
    );

    return {
      success: true,
      result,
      stateChanges: validation.predictedChanges
    };
  }
}

module.exports = EntitlementRule;
