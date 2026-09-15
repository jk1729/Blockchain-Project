/**
 * PDSChain Blockchain State Module
 * 
 * Exports canonical state serialization, state consistency checks, and state root calculation.
 */

const {
  STATE_ROOT_VERSION,
  canonicalStringify,
  canonicalizeState,
  calculateStateRoot,
  verifyStateRoot
} = require('./stateSerializer');

const {
  verifyStateConsistency,
  assertStateConsistency,
  StateConsistencyError
} = require('./stateConsistency');

module.exports = {
  STATE_ROOT_VERSION,
  canonicalStringify,
  canonicalizeState,
  calculateStateRoot,
  verifyStateRoot,
  verifyStateConsistency,
  assertStateConsistency,
  StateConsistencyError
};

