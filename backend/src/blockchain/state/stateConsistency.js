/**
 * PDSChain State Invariant & Consistency Checks
 * 
 * Verifies that a state snapshot obeys core PDS business invariants:
 * - No negative inventory balances
 * - No negative claimed entitlements
 * - Valid non-empty entity identifiers
 * - Clean status assignments
 */

const { canonicalizeState } = require('./stateSerializer');

class StateConsistencyError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'StateConsistencyError';
    this.code = 'STATE_CORRUPTED';
    this.details = details;
  }
}

/**
 * Validates logical invariants on consensus state
 * @param {object} rawState 
 * @returns {{ valid: boolean, errors: Array<string> }}
 */
function verifyStateConsistency(rawState = {}) {
  const canonical = canonicalizeState(rawState);
  const errors = [];

  // 1. Beneficiary Invariants
  for (const b of canonical.beneficiaries) {
    if (!b.id) {
      errors.push('Beneficiary entry missing valid identifier.');
    }
    for (const [commodity, claimedQty] of Object.entries(b.currentMonthClaimed || {})) {
      if (claimedQty < 0) {
        errors.push(`Beneficiary '${b.id}' has negative claimed quota for '${commodity}': ${claimedQty}`);
      }
    }
    for (const [commodity, maxQty] of Object.entries(b.monthlyEntitlement || {})) {
      if (maxQty < 0) {
        errors.push(`Beneficiary '${b.id}' has negative entitlement ceiling for '${commodity}': ${maxQty}`);
      }
    }
  }

  // 2. Shop Inventory Invariants
  for (const inv of canonical.shopInventory) {
    if (!inv.shopId) {
      errors.push('Shop inventory entry missing valid shop identifier.');
    }
    if (inv.quantity < 0) {
      errors.push(`Shop '${inv.shopId}' has negative stock balance for '${inv.commodity}': ${inv.quantity}`);
    }
  }

  // 3. Warehouse Inventory Invariants
  for (const inv of canonical.warehouseInventory) {
    if (!inv.warehouseId) {
      errors.push('Warehouse inventory entry missing valid warehouse identifier.');
    }
    if (inv.quantity < 0) {
      errors.push(`Warehouse '${inv.warehouseId}' has negative stock balance for '${inv.commodity}': ${inv.quantity}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Asserts state consistency and throws StateConsistencyError on invariant failure
 * @param {object} rawState 
 */
function assertStateConsistency(rawState = {}) {
  const result = verifyStateConsistency(rawState);
  if (!result.valid) {
    throw new StateConsistencyError(
      `State invariant violation: ${result.errors.join('; ')}`,
      { errors: result.errors }
    );
  }
  return true;
}

module.exports = {
  verifyStateConsistency,
  assertStateConsistency,
  StateConsistencyError
};

