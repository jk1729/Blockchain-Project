/**
 * PDSChain Consensus and Byzantine Failure Simulation Tests (Phase 20)
 * 
 * Verifies scenarios CONSENSUS-001 through CONSENSUS-004:
 * - CONSENSUS-001: Double-Voting Equivocator Detection
 * - CONSENSUS-002: Stale Consensus Round Rejection
 * - CONSENSUS-003: Validator Crash, Quorum Loss & Recovery
 * - CONSENSUS-004: Stale Writer Fencing Token Rejection
 */

const { defaultSimulationRunner } = require('../src/simulation');

describe('Consensus and Byzantine Failure Simulations (CONSENSUS-*)', () => {
  beforeAll(() => {
    process.env.SIMULATION_MODE = 'true';
    process.env.NODE_ENV = 'test';
  });

  test('CONSENSUS-001: Detects double-voting validator equivocation', async () => {
    const evidence = await defaultSimulationRunner.runScenario('CONSENSUS-001');
    expect(evidence.result).toBe('PASSED');
    expect(evidence.cleanedUp).toBe(true);
    expect(evidence.invariants.every(inv => inv.passed)).toBe(true);
  });

  test('CONSENSUS-002: Rejects messages from stale prior rounds', async () => {
    const evidence = await defaultSimulationRunner.runScenario('CONSENSUS-002');
    expect(evidence.result).toBe('PASSED');
    expect(evidence.cleanedUp).toBe(true);
    expect(evidence.invariants.every(inv => inv.passed)).toBe(true);
  });

  test('CONSENSUS-003: Preserves safety during validator crash & restores block finalization on return', async () => {
    const evidence = await defaultSimulationRunner.runScenario('CONSENSUS-003');
    expect(evidence.result).toBe('PASSED');
    expect(evidence.cleanedUp).toBe(true);
    expect(evidence.invariants.every(inv => inv.passed)).toBe(true);
    expect(evidence.postRecoverySnapshot.ledgerHeight).toBeGreaterThan(evidence.baselineSnapshot.ledgerHeight);
  });

  test('CONSENSUS-004: Rejects stale writer fencing token, preventing split-brain database writes', async () => {
    const evidence = await defaultSimulationRunner.runScenario('CONSENSUS-004');
    expect(evidence.result).toBe('PASSED');
    expect(evidence.cleanedUp).toBe(true);
    expect(evidence.invariants.every(inv => inv.passed)).toBe(true);
  });
});

