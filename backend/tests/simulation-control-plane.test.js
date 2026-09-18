/**
 * PDSChain Simulation Control Plane Tests (Phase 20)
 * 
 * Verifies PRNG determinism, SimulationContext lifecycle, InvariantMonitor assertions,
 * ScenarioRegistry catalogs, and SimulationRunner execution.
 */

const fs = require('fs');
const {
  DeterministicPRNG,
  SimulationContext,
  InvariantMonitor,
  InvariantViolationError,
  ScenarioRegistry,
  SimulationRunner
} = require('../src/simulation');

describe('Simulation Control Plane Engine', () => {
  beforeAll(() => {
    process.env.SIMULATION_MODE = 'true';
    process.env.NODE_ENV = 'test';
  });

  describe('Deterministic PRNG', () => {
    test('Produces identical sequence from same seed', () => {
      const prng1 = new DeterministicPRNG(12345);
      const prng2 = new DeterministicPRNG(12345);

      const seq1 = [prng1.random(), prng1.randomInt(1, 100), prng1.random()];
      const seq2 = [prng2.random(), prng2.randomInt(1, 100), prng2.random()];

      expect(seq1).toEqual(seq2);
    });

    test('Shuffles arrays deterministically with seed', () => {
      const prng1 = new DeterministicPRNG('my-test-seed');
      const prng2 = new DeterministicPRNG('my-test-seed');

      const array = [1, 2, 3, 4, 5, 6, 7, 8];
      expect(prng1.shuffle(array)).toEqual(prng2.shuffle(array));
    });
  });

  describe('SimulationContext Lifecycle', () => {
    test('Initializes sandbox, records events, and executes guaranteed cleanup', async () => {
      const ctx = new SimulationContext({
        scenarioId: 'TEST-001',
        name: 'Lifecycle Verification Test',
        seed: 42
      });

      await ctx.initialize();
      expect(fs.existsSync(ctx.sandboxPath)).toBe(true);

      // Baseline capture
      ctx.captureBaseline({ ledgerHeight: 100 });
      expect(ctx.baselineSnapshot.ledgerHeight).toBe(100);

      // Cleanup hook registration
      let hookRan = false;
      ctx.registerCleanup(async () => {
        hookRan = true;
      });

      // Post recovery capture
      ctx.capturePostRecovery({ ledgerHeight: 100 });
      expect(ctx.metrics.rpoBlocks).toBe(0);

      // Cleanup
      await ctx.cleanup();
      expect(hookRan).toBe(true);
      expect(fs.existsSync(ctx.sandboxPath)).toBe(false);
      expect(ctx.cleanedUp).toBe(true);
    });
  });

  describe('Invariant Monitor', () => {
    test('Monotonic height assertion passes on increment and fails on regression', () => {
      expect(InvariantMonitor.assertMonotonicHeight(100, 101).passed).toBe(true);
      expect(InvariantMonitor.assertMonotonicHeight(100, 100).passed).toBe(true);

      expect(() => {
        InvariantMonitor.assertMonotonicHeight(100, 99);
      }).toThrow(InvariantViolationError);
    });

    test('Immutable block hash assertion', () => {
      const hash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
      expect(InvariantMonitor.assertImmutableBlockHash(hash, hash).passed).toBe(true);

      expect(() => {
        InvariantMonitor.assertImmutableBlockHash(hash, '0xdeadbeef');
      }).toThrow(InvariantViolationError);
    });

    test('Sequence continuity assertion', () => {
      const validChain = [{ height: 1 }, { height: 2 }, { height: 3 }];
      expect(InvariantMonitor.assertSequenceContinuity(validChain).passed).toBe(true);

      const brokenChain = [{ height: 1 }, { height: 3 }];
      expect(() => {
        InvariantMonitor.assertSequenceContinuity(brokenChain);
      }).toThrow(InvariantViolationError);
    });

    test('Parent hash continuity assertion', () => {
      const chain = [
        { hash: '0x111' },
        { hash: '0x222', previousHash: '0x111' },
        { hash: '0x333', previousHash: '0x222' }
      ];
      expect(InvariantMonitor.assertParentHashContinuity(chain).passed).toBe(true);

      const broken = [
        { hash: '0x111' },
        { hash: '0x222', previousHash: '0x999' }
      ];
      expect(() => {
        InvariantMonitor.assertParentHashContinuity(broken);
      }).toThrow(InvariantViolationError);
    });

    test('Atomic rollback assertion', () => {
      expect(InvariantMonitor.assertAtomicRollback(5, 5).passed).toBe(true);
      expect(() => {
        InvariantMonitor.assertAtomicRollback(5, 6);
      }).toThrow(InvariantViolationError);
    });

    test('Zero secret leakage scanner', () => {
      expect(InvariantMonitor.assertZeroSecretLeakage({ status: 'ok', count: 12 }).passed).toBe(true);

      const leakyObject = {
        user: 'admin',
        private_key: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
      };
      expect(() => {
        InvariantMonitor.assertZeroSecretLeakage(leakyObject);
      }).toThrow(InvariantViolationError);
    });
  });

  describe('Scenario Registry', () => {
    test('Contains built-in scenarios across all 8 domains', () => {
      const registry = new ScenarioRegistry();
      expect(registry.size).toBe(29);

      const categories = ['AUTH', 'INPUT', 'CONSENSUS', 'NETWORK', 'DATABASE', 'RESOURCE', 'OBSERVABILITY', 'RECOVERY'];
      for (const cat of categories) {
        const scenarios = registry.getByCategory(cat);
        expect(scenarios.length).toBeGreaterThanOrEqual(3);
      }
    });
  });

  describe('Simulation Runner', () => {
    test('Runs scenario, collects evidence, and adds to history', async () => {
      const runner = new SimulationRunner();

      const evidence = await runner.runScenario('AUTH-001', { seed: 12345 });
      expect(evidence.simulationId).toBeDefined();
      expect(evidence.scenarioId).toBe('AUTH-001');
      expect(evidence.result).toBe('PASSED');
      expect(evidence.cleanedUp).toBe(true);

      // Verify history
      const history = runner.getHistory(5);
      expect(history.length).toBeGreaterThanOrEqual(1);
      expect(history[0].simulationId).toBe(evidence.simulationId);

      // Verify getEvidence
      const retrieved = runner.getEvidence(evidence.simulationId);
      expect(retrieved).not.toBeNull();
      expect(retrieved.scenarioId).toBe('AUTH-001');
    });

    test('Handles scenario timeout safely', async () => {
      const registry = new ScenarioRegistry();
      registry.register({
        id: 'TIMEOUT-001',
        name: 'Simulated Long Operation',
        category: 'RESOURCE',
        runtimeBudgetMs: 50,
        handler: async () => {
          await new Promise(resolve => setTimeout(resolve, 200));
          return { success: true };
        }
      });

      const runner = new SimulationRunner({ registry });
      const evidence = await runner.runScenario('TIMEOUT-001', { timeoutMs: 50 });

      expect(evidence.result).toBe('FAILED_TIMEOUT');
      expect(evidence.cleanedUp).toBe(true);
    });
  });
});

