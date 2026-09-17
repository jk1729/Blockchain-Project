/**
 * PDSChain Execution Gas & Resource Policy
 * 
 * In PDSChain, Gas is NOT a cryptocurrency fee mechanism.
 * There are NO tokens, ETH, or gas payments.
 * 
 * Instead, Gas serves strictly as a deterministic computational execution budget
 * to prevent infinite loops, halt malicious runaway bytecode, and guarantee identical
 * validator execution boundaries.
 */

const GAS_LIMITS = {
  // Maximum gas budget allowed per individual contract call transaction
  TRANSACTION_GAS_LIMIT: 1_000_000n,

  // Default gas allocated if unspecified
  DEFAULT_CALL_GAS: 500_000n,

  // Maximum cumulative gas across all transactions in a candidate block
  BLOCK_GAS_LIMIT: 10_000_000n,

  // Maximum calldata size in bytes (128 KB) to guard against bandwidth exhaustion
  MAX_CALLDATA_BYTES: 131_072,

  // Local safety execution watchdog timeout in milliseconds (non-consensus)
  WATCHDOG_TIMEOUT_MS: 5_000
};

class GasLimitExceededError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'GasLimitExceededError';
    this.code = 'GAS_LIMIT_EXCEEDED';
    this.details = details;
  }
}

/**
 * Validate that a transaction's requested gas complies with network policy.
 * @param {bigint|number} gasRequested 
 * @returns {bigint} Approved gas limit
 */
function validateAndCapGas(gasRequested) {
  const requested = gasRequested !== undefined && gasRequested !== null
    ? BigInt(gasRequested)
    : GAS_LIMITS.DEFAULT_CALL_GAS;

  if (requested <= 0n) {
    throw new GasLimitExceededError('Gas limit must be greater than zero.');
  }

  if (requested > GAS_LIMITS.TRANSACTION_GAS_LIMIT) {
    throw new GasLimitExceededError(
      `Requested gas (${requested}) exceeds transaction gas limit (${GAS_LIMITS.TRANSACTION_GAS_LIMIT}).`,
      { requested: requested.toString(), max: GAS_LIMITS.TRANSACTION_GAS_LIMIT.toString() }
    );
  }

  return requested;
}

module.exports = {
  GAS_LIMITS,
  GasLimitExceededError,
  validateAndCapGas
};

