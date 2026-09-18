/**
 * PDSChain Simulation Scenario Registry (Phase 20 - Stage C, O)
 * 
 * Central catalog of all registered attack and failure scenarios across 8 domains.
 */

const { authScenarios } = require('./scenarios/authScenarios');
const { inputScenarios } = require('./scenarios/inputScenarios');
const { consensusScenarios } = require('./scenarios/consensusScenarios');
const { networkScenarios } = require('./scenarios/networkScenarios');
const { databaseScenarios } = require('./scenarios/databaseScenarios');
const { resourceScenarios } = require('./scenarios/resourceScenarios');
const { observabilityScenarios } = require('./scenarios/observabilityScenarios');
const { recoveryScenarios } = require('./scenarios/recoveryScenarios');

class ScenarioRegistry {
  constructor() {
    this.scenarios = new Map();
    this._registerBuiltins();
  }

  _registerBuiltins() {
    const allBuiltins = [
      ...authScenarios,
      ...inputScenarios,
      ...consensusScenarios,
      ...networkScenarios,
      ...databaseScenarios,
      ...resourceScenarios,
      ...observabilityScenarios,
      ...recoveryScenarios
    ];

    for (const sc of allBuiltins) {
      this.register(sc);
    }
  }

  /**
   * Register a scenario definition.
   */
  register(scenario) {
    if (!scenario || !scenario.id) {
      throw new Error('Invalid scenario definition: missing required "id"');
    }
    if (typeof scenario.handler !== 'function') {
      throw new Error(`Scenario ${scenario.id} must define an async executable handler function`);
    }

    this.scenarios.set(scenario.id.toUpperCase(), {
      id: scenario.id.toUpperCase(),
      name: scenario.name || scenario.id,
      category: (scenario.category || 'GENERAL').toUpperCase(),
      severity: (scenario.severity || 'MEDIUM').toUpperCase(),
      description: scenario.description || '',
      preconditions: scenario.preconditions || [],
      runtimeBudgetMs: scenario.runtimeBudgetMs || 10000,
      expectedOutcome: scenario.expectedOutcome || 'PASSED',
      invariants: scenario.invariants || [],
      handler: scenario.handler
    });
  }

  /**
   * Check if a scenario is registered.
   */
  has(id) {
    if (!id) return false;
    return this.scenarios.has(String(id).toUpperCase());
  }

  /**
   * Get a scenario definition by ID.
   */
  get(id) {
    if (!id) return null;
    return this.scenarios.get(String(id).toUpperCase()) || null;
  }

  /**
   * Get all scenarios.
   */
  getAll() {
    return Array.from(this.scenarios.values());
  }

  /**
   * Get scenarios by category (AUTH, INPUT, CONSENSUS, NETWORK, DATABASE, RESOURCE, OBSERVABILITY, RECOVERY).
   */
  getByCategory(category) {
    if (!category) return [];
    const catUpper = String(category).toUpperCase();
    return this.getAll().filter(s => s.category === catUpper);
  }

  /**
   * List sanitized metadata of all scenarios (excluding handler functions).
   */
  list() {
    return this.getAll().map(s => ({
      id: s.id,
      name: s.name,
      category: s.category,
      severity: s.severity,
      description: s.description,
      preconditions: s.preconditions,
      runtimeBudgetMs: s.runtimeBudgetMs,
      expectedOutcome: s.expectedOutcome,
      invariants: s.invariants
    }));
  }

  /**
   * Count of registered scenarios.
   */
  get size() {
    return this.scenarios.size;
  }
}

const defaultScenarioRegistry = new ScenarioRegistry();

module.exports = {
  ScenarioRegistry,
  defaultScenarioRegistry
};

