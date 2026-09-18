/**
 * PDSChain Workload Registry Tests (Phase 21 - Stage C, D)
 * 
 * Verifies catalog of workloads across the 6 operational domains,
 * query filtering, validation of custom workloads, and metadata sanitization.
 */

const { WorkloadRegistry, defaultWorkloadRegistry } = require('../src/performance');

describe('Performance Workload Registry', () => {
  test('Contains all 9 built-in workloads across 6 domains', () => {
    expect(defaultWorkloadRegistry.size).toBeGreaterThanOrEqual(9);

    const expectedWorkloads = [
      'API-001',
      'API-002',
      'TX-001',
      'TX-002',
      'CONS-001',
      'DB-001',
      'DB-002',
      'SYNC-001',
      'RES-001'
    ];

    for (const id of expectedWorkloads) {
      expect(defaultWorkloadRegistry.has(id)).toBe(true);
      const w = defaultWorkloadRegistry.get(id);
      expect(w).toBeDefined();
      expect(w.id).toBe(id);
      expect(typeof w.name).toBe('string');
      expect(typeof w.category).toBe('string');
      expect(typeof w.taskFn).toBe('function');
      expect(w.targetRps).toBeGreaterThan(0);
      expect(w.concurrency).toBeGreaterThan(0);
      expect(w.slo).toBeDefined();
      expect(typeof w.slo.maxP95LatencyMs).toBe('number');
      expect(typeof w.slo.maxErrorRate).toBe('number');
    }
  });

  test('Filters workloads accurately by category', () => {
    const apiWorkloads = defaultWorkloadRegistry.getByCategory('API_PUBLIC_DISTRIBUTION');
    expect(apiWorkloads.length).toBe(2);
    expect(apiWorkloads.map(w => w.id)).toEqual(['API-001', 'API-002']);

    const txWorkloads = defaultWorkloadRegistry.getByCategory('BLOCKCHAIN_TRANSACTIONS');
    expect(txWorkloads.length).toBe(2);
    expect(txWorkloads.map(w => w.id)).toEqual(['TX-001', 'TX-002']);

    const consWorkloads = defaultWorkloadRegistry.getByCategory('CONSENSUS_FINALITY');
    expect(consWorkloads.length).toBe(1);
    expect(consWorkloads[0].id).toBe('CONS-001');

    const dbWorkloads = defaultWorkloadRegistry.getByCategory('DATABASE_STORAGE');
    expect(dbWorkloads.length).toBe(2);
    expect(dbWorkloads.map(w => w.id)).toEqual(['DB-001', 'DB-002']);

    const syncWorkloads = defaultWorkloadRegistry.getByCategory('SYNC_NETWORKING');
    expect(syncWorkloads.length).toBe(1);
    expect(syncWorkloads[0].id).toBe('SYNC-001');

    const resWorkloads = defaultWorkloadRegistry.getByCategory('RESOURCE_SATURATION');
    expect(resWorkloads.length).toBe(1);
    expect(resWorkloads[0].id).toBe('RES-001');
  });

  test('Produces sanitized metadata list without internal taskFn references', () => {
    const list = defaultWorkloadRegistry.list();
    expect(Array.isArray(list)).toBe(true);
    expect(list.length).toBe(defaultWorkloadRegistry.size);

    for (const item of list) {
      expect(item.id).toBeDefined();
      expect(item.name).toBeDefined();
      expect(item.category).toBeDefined();
      expect(item.targetRps).toBeDefined();
      expect(item.taskFn).toBeUndefined(); // Internal function should not be in public list
    }
  });

  test('Supports registering valid custom workloads and rejects invalid registrations', () => {
    const registry = new WorkloadRegistry();

    // Valid registration
    registry.register({
      id: 'CUSTOM-TEST',
      name: 'Custom Test Workload',
      category: 'CUSTOM',
      taskFn: async () => {}
    });

    expect(registry.has('CUSTOM-TEST')).toBe(true);
    expect(registry.has('custom-test')).toBe(true); // Case-insensitive lookup

    // Rejects missing id
    expect(() => {
      registry.register({ taskFn: async () => {} });
    }).toThrow('must provide a valid "id"');

    // Rejects missing taskFn
    expect(() => {
      registry.register({ id: 'NO-TASK' });
    }).toThrow('must define an async taskFn');
  });
});

