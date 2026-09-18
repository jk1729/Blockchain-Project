/**
 * PDSChain Observability and Monitoring Failure Simulation Tests (Phase 20)
 * 
 * Verifies scenarios OBSERVABILITY-001 through OBSERVABILITY-003:
 * - OBSERVABILITY-001: Logger Transport Failure Non-Blocking Isolation
 * - OBSERVABILITY-002: Health Probe Status Degradation Classification
 * - OBSERVABILITY-003: Metrics Scrape Resilience & Fallback Diagnostics
 */

const { defaultSimulationRunner } = require('../src/simulation');

describe('Observability Failure Simulations (OBSERVABILITY-*)', () => {
  beforeAll(() => {
    process.env.SIMULATION_MODE = 'true';
    process.env.NODE_ENV = 'test';
  });

  test('OBSERVABILITY-001: Isolates logging transport failure without blocking consensus execution', async () => {
    const evidence = await defaultSimulationRunner.runScenario('OBSERVABILITY-001');
    expect(evidence.result).toBe('PASSED');
    expect(evidence.cleanedUp).toBe(true);
    expect(evidence.invariants.every(inv => inv.passed)).toBe(true);
  });

  test('OBSERVABILITY-002: Classifies readiness degradation (/health/ready=503) while maintaining liveness (/health/live=200)', async () => {
    const evidence = await defaultSimulationRunner.runScenario('OBSERVABILITY-002');
    expect(evidence.result).toBe('PASSED');
    expect(evidence.cleanedUp).toBe(true);
    expect(evidence.invariants.every(inv => inv.passed)).toBe(true);
  });

  test('OBSERVABILITY-003: Emits fallback diagnostic metric if scrape rendering encounters error', async () => {
    const evidence = await defaultSimulationRunner.runScenario('OBSERVABILITY-003');
    expect(evidence.result).toBe('PASSED');
    expect(evidence.cleanedUp).toBe(true);
    expect(evidence.invariants.every(inv => inv.passed)).toBe(true);
  });
});

