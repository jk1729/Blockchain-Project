/**
 * PDSChain Performance Safety Guard Tests (Phase 21)
 * 
 * Verifies anti-production safety gates, mode checks, sandbox directory rules,
 * and emergency stop for performance tests.
 */

const { SafetyGuard, SafetyGuardError } = require('../src/simulation/SafetyGuard');

describe('Performance Safety Guard Tests', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    SafetyGuard.resetEmergencyStop();
  });

  afterAll(() => {
    process.env = originalEnv;
    SafetyGuard.resetEmergencyStop();
  });

  test('Refuses execution when PERFORMANCE_TEST_MODE is disabled', () => {
    delete process.env.PERFORMANCE_TEST_MODE;
    delete process.env.SIMULATION_MODE;

    expect(SafetyGuard.isPerformanceModeActive()).toBe(false);

    expect(() => {
      SafetyGuard.validateExecutionSafety({ isPerformanceTest: true });
    }).toThrow(SafetyGuardError);

    try {
      SafetyGuard.validateExecutionSafety({ isPerformanceTest: true });
    } catch (err) {
      expect(err.code).toBe('E_PERFORMANCE_MODE_DISABLED');
    }
  });

  test('Accepts execution when PERFORMANCE_TEST_MODE is true', () => {
    process.env.PERFORMANCE_TEST_MODE = 'true';
    process.env.NODE_ENV = 'test';

    expect(SafetyGuard.isPerformanceModeActive()).toBe(true);
    expect(SafetyGuard.validateExecutionSafety({ isPerformanceTest: true })).toBe(true);
  });

  test('Refuses execution when NODE_ENV is production even if PERFORMANCE_TEST_MODE is true', () => {
    process.env.PERFORMANCE_TEST_MODE = 'true';
    process.env.NODE_ENV = 'production';

    expect(() => {
      SafetyGuard.validateExecutionSafety({ isPerformanceTest: true });
    }).toThrow(SafetyGuardError);

    try {
      SafetyGuard.validateExecutionSafety({ isPerformanceTest: true });
    } catch (err) {
      expect(err.code).toBe('E_SIMULATION_PROD_ENV_REFUSED');
    }
  });

  test('Authorizes tmp-perf-* sandbox directories and rejects unsafe directories', () => {
    expect(SafetyGuard.validateSandboxPath('/tmp/pdschain-performance/tmp-perf-12345')).toBe(true);

    expect(() => {
      SafetyGuard.validateSandboxPath('/var/lib/pdschain/production');
    }).toThrow(SafetyGuardError);
  });

  test('Enforces emergency stop instantly for performance runs', () => {
    process.env.PERFORMANCE_TEST_MODE = 'true';
    process.env.NODE_ENV = 'test';

    SafetyGuard.triggerEmergencyStop('Manual performance test abort');
    expect(SafetyGuard.isEmergencyStopActive()).toBe(true);

    expect(() => {
      SafetyGuard.validateExecutionSafety({ isPerformanceTest: true });
    }).toThrow(SafetyGuardError);

    SafetyGuard.resetEmergencyStop();
    expect(SafetyGuard.isEmergencyStopActive()).toBe(false);
  });
});

