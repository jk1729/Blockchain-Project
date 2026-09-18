/**
 * PDSChain Simulation Module (Phase 20)
 * 
 * Aggregates and exports all simulation control plane components:
 * - SafetyGuard: Environment and runtime safety protection
 * - SimulationContext: Sandboxed execution lifecycle and PRNG
 * - InvariantMonitor: Ledger, consensus, db, security, and observability invariant checks
 * - ScenarioRegistry: Scenario definitions and catalog
 * - SimulationRunner: Scenario execution and evidence orchestration
 */

const { SafetyGuard, SafetyGuardError } = require('./SafetyGuard');
const { SimulationContext, DeterministicPRNG } = require('./SimulationContext');
const { InvariantMonitor, InvariantViolationError } = require('./InvariantMonitor');
const { ScenarioRegistry, defaultScenarioRegistry } = require('./ScenarioRegistry');
const { SimulationRunner, defaultSimulationRunner } = require('./SimulationRunner');

module.exports = {
  SafetyGuard,
  SafetyGuardError,
  SimulationContext,
  DeterministicPRNG,
  InvariantMonitor,
  InvariantViolationError,
  ScenarioRegistry,
  defaultScenarioRegistry,
  SimulationRunner,
  defaultSimulationRunner
};

