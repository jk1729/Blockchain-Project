/**
 * PDSChain Simulation Safety Guard Tests (Phase 20)
 * 
 * Verifies strict anti-production protections, host fencing, resource limits,
 * and emergency stop mechanisms.
 */

const { SafetyGuard, SafetyGuardError } = require('../src/simulation/SafetyGuard');

describe('Simulation Safety Guard', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    SafetyGuard.resetEmergencyStop();
  });

  afterAll(() => {
    process.env = originalEnv;
    SafetyGuard.resetEmergencyStop();
  });

  test('Refuses execution when SIMULATION_MODE is not active', () => {
    delete process.env.SIMULATION_MODE;
    expect(SafetyGuard.isSimulationModeActive()).toBe(false);

    expect(() => {
      SafetyGuard.validateExecutionSafety();
    }).toThrow(SafetyGuardError);

    try {
      SafetyGuard.validateExecutionSafety();
    } catch (err) {
      expect(err.code).toBe('E_SIMULATION_MODE_DISABLED');
    }
  });

  test('Refuses execution when NODE_ENV is production', () => {
    process.env.SIMULATION_MODE = 'true';
    process.env.NODE_ENV = 'production';

    expect(SafetyGuard.isProductionEnvironment()).toBe(true);

    expect(() => {
      SafetyGuard.validateExecutionSafety();
    }).toThrow(SafetyGuardError);

    try {
      SafetyGuard.validateExecutionSafety();
    } catch (err) {
      expect(err.code).toBe('E_SIMULATION_PROD_ENV_REFUSED');
    }
  });

  test('Refuses production database keywords and external cloud hosts', () => {
    process.env.SIMULATION_MODE = 'true';
    process.env.NODE_ENV = 'test';

    const unsafeDbUrls = [
      'sqlite://./data/prod-database.db',
      'postgres://user:pass@db.mainnet.pdschain.org/pdschain',
      'postgres://user:pass@pds-cluster.rds.amazonaws.com/pdschain'
    ];

    for (const url of unsafeDbUrls) {
      expect(() => {
        SafetyGuard.validateDatabaseTarget(url);
      }).toThrow(SafetyGuardError);
    }

    // Safe targets
    expect(SafetyGuard.validateDatabaseTarget(':memory:')).toBe(true);
    expect(SafetyGuard.validateDatabaseTarget('./data/tmp-sim-123/pdschain.db')).toBe(true);
  });

  test('Refuses non-loopback targets unless explicitly allowlisted', () => {
    expect(SafetyGuard.isAllowedHost('localhost')).toBe(true);
    expect(SafetyGuard.isAllowedHost('127.0.0.1')).toBe(true);
    expect(SafetyGuard.isAllowedHost('http://127.0.0.1:5000')).toBe(true);

    expect(SafetyGuard.isAllowedHost('api.production.pdschain.org')).toBe(false);
    expect(SafetyGuard.isAllowedHost('http://192.168.1.100:5000')).toBe(false);

    // With explicit allowlist
    process.env.SIMULATION_ALLOWED_HOSTS = 'staging-node-1.local,staging-node-2.local';
    expect(SafetyGuard.isAllowedHost('staging-node-1.local')).toBe(true);
    expect(SafetyGuard.isAllowedHost('rogue-host.com')).toBe(false);
  });

  test('Refuses unsafe filesystem paths not matching tmp-sim-*', () => {
    expect(() => {
      SafetyGuard.validateSandboxPath('/etc/pdschain');
    }).toThrow(SafetyGuardError);

    expect(() => {
      SafetyGuard.validateSandboxPath('C:\\Windows\\System32');
    }).toThrow(SafetyGuardError);

    expect(SafetyGuard.validateSandboxPath('/tmp/pdschain-simulations/tmp-sim-12345')).toBe(true);
  });

  test('Enforces global emergency stop', () => {
    process.env.SIMULATION_MODE = 'true';
    process.env.NODE_ENV = 'test';

    expect(SafetyGuard.isEmergencyStopActive()).toBe(false);

    SafetyGuard.triggerEmergencyStop('Manual test abort');
    expect(SafetyGuard.isEmergencyStopActive()).toBe(true);

    const details = SafetyGuard.getEmergencyStopDetails();
    expect(details.active).toBe(true);
    expect(details.reason).toBe('Manual test abort');

    expect(() => {
      SafetyGuard.validateExecutionSafety();
    }).toThrow(SafetyGuardError);

    try {
      SafetyGuard.validateExecutionSafety();
    } catch (err) {
      expect(err.code).toBe('E_SIMULATION_EMERGENCY_STOP_ACTIVE');
    }

    SafetyGuard.resetEmergencyStop();
    expect(SafetyGuard.isEmergencyStopActive()).toBe(false);
    expect(SafetyGuard.validateExecutionSafety()).toBe(true);
  });

  test('Enforces duration, payload, and concurrency caps', () => {
    process.env.SIMULATION_MODE = 'true';
    process.env.NODE_ENV = 'test';

    // Exceeded duration
    expect(() => {
      SafetyGuard.validateExecutionSafety({ durationMs: 999999 });
    }).toThrow(/duration .* exceeds maximum/i);

    // Exceeded payload
    expect(() => {
      SafetyGuard.validateExecutionSafety({ payloadSizeBytes: 10 * 1024 * 1024 });
    }).toThrow(/payload size .* exceeds limit/i);

    // Exceeded concurrency
    expect(() => {
      SafetyGuard.validateExecutionSafety({ concurrency: 50 });
    }).toThrow(/concurrency .* exceeds maximum/i);
  });
});

