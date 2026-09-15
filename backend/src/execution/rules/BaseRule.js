/**
 * PDSChain Base Execution Rule
 * 
 * Abstract base class for deterministic smart-contract-like execution rules.
 */

class BaseRule {
  /**
   * Side-effect-free validation of transaction preconditions against state.
   * @param {ExecutionContext} context 
   * @param {StateManager} stateManager 
   * @param {object} [options] 
   * @returns {Promise<{ valid: boolean, predictedChanges?: Array<object> }>}
   */
  async validate(context, stateManager, options = {}) {
    throw new Error(`validate() method must be implemented by ${this.constructor.name}`);
  }

  /**
   * Atomic execution of state transition and mutation.
   * @param {ExecutionContext} context 
   * @param {StateManager} stateManager 
   * @param {object} [options] 
   * @returns {Promise<{ success: boolean, stateChanges: Array<object> }>}
   */
  async execute(context, stateManager, options = {}) {
    throw new Error(`execute() method must be implemented by ${this.constructor.name}`);
  }
}

module.exports = BaseRule;

