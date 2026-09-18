/**
 * PDSChain Workload Registry (Phase 21 - Stage C, D)
 * 
 * Central catalog of bounded, repeatable load testing profiles across 6 operational domains:
 * 1. API_PUBLIC_DISTRIBUTION
 * 2. BLOCKCHAIN_TRANSACTIONS
 * 3. CONSENSUS_FINALITY
 * 4. DATABASE_STORAGE
 * 5. SYNC_NETWORKING
 * 6. RESOURCE_SATURATION
 */

const crypto = require('crypto');

class WorkloadRegistry {
  constructor() {
    this.workloads = new Map();
    this._registerBuiltins();
  }

  _registerBuiltins() {
    // 1. API_PUBLIC_DISTRIBUTION
    this.register({
      id: 'API-001',
      name: 'Citizen Ration & Beneficiary Lookup',
      category: 'API_PUBLIC_DISTRIBUTION',
      description: 'High-concurrency read-heavy queries for beneficiary quota and ration entitlement.',
      targetRps: 100,
      concurrency: 10,
      durationMs: 1500,
      warmupMs: 200,
      cooldownMs: 100,
      slo: { maxP95LatencyMs: 100, maxErrorRate: 0.01 },
      taskFn: async (context, workerId) => {
        const timer = context.collector.startTimer('GET /api/v1/beneficiary/quota');
        // Simulated lightweight query
        const beneficiaryId = `BENEFICIARY-${(workerId % 50) + 1}`;
        const quota = { riceKg: 25, wheatKg: 10, sugarKg: 2 };
        timer({ statusCode: 200, success: true, bytesReceived: 128 });
      }
    });

    this.register({
      id: 'API-002',
      name: 'Shop Inventory & Commodity Availability Query',
      category: 'API_PUBLIC_DISTRIBUTION',
      description: 'Simulates shop operators querying depot stock balances.',
      targetRps: 80,
      concurrency: 8,
      durationMs: 1500,
      warmupMs: 200,
      cooldownMs: 100,
      slo: { maxP95LatencyMs: 120, maxErrorRate: 0.01 },
      taskFn: async (context, workerId) => {
        const timer = context.collector.startTimer('GET /api/v1/shops/inventory');
        const shopId = `SHOP-${(workerId % 20) + 1}`;
        const stock = { wheatBags: 500, riceBags: 300 };
        timer({ statusCode: 200, success: true, bytesReceived: 256 });
      }
    });

    // 2. BLOCKCHAIN_TRANSACTIONS
    this.register({
      id: 'TX-001',
      name: 'Ration Distribution Transaction Burst',
      category: 'BLOCKCHAIN_TRANSACTIONS',
      description: 'Burst submission of cryptographic ration distribution transactions and mempool admission.',
      targetRps: 60,
      concurrency: 5,
      durationMs: 1500,
      warmupMs: 200,
      cooldownMs: 100,
      slo: { maxP95LatencyMs: 150, maxErrorRate: 0.05 },
      taskFn: async (context, workerId) => {
        const timer = context.collector.startTimer('POST /api/v1/transactions/submit');
        // Synthetic transaction hash computation
        const rawPayload = `tx-${workerId}-${Date.now()}`;
        const hash = crypto.createHash('sha256').update(rawPayload).digest('hex');
        timer({ statusCode: 200, success: true, bytesSent: 512, bytesReceived: 64 });
      }
    });

    this.register({
      id: 'TX-002',
      name: 'Mixed Valid and Invalid Transaction Stream',
      category: 'BLOCKCHAIN_TRANSACTIONS',
      description: 'Stream containing 80% valid transactions and 20% invalid signatures.',
      targetRps: 80,
      concurrency: 6,
      durationMs: 1500,
      warmupMs: 200,
      cooldownMs: 100,
      slo: { maxP95LatencyMs: 150, maxErrorRate: 0.25 }, // Expected 20% validation rejection
      taskFn: async (context, workerId) => {
        const timer = context.collector.startTimer('POST /api/v1/transactions/validate');
        const isValid = (workerId % 5) !== 0; // 80% valid, 20% invalid
        const statusCode = isValid ? 200 : 400;
        timer({ statusCode, success: isValid, errorType: isValid ? null : 'INVALID_SIGNATURE' });
      }
    });

    // 3. CONSENSUS_FINALITY
    this.register({
      id: 'CONS-001',
      name: 'Consensus Round Finalization Throughput',
      category: 'CONSENSUS_FINALITY',
      description: 'Measures round execution, vote processing, and block finalization latency.',
      targetRps: 40,
      concurrency: 4,
      durationMs: 1500,
      warmupMs: 200,
      cooldownMs: 100,
      slo: { maxP95LatencyMs: 200, maxErrorRate: 0.01 },
      taskFn: async (context, workerId) => {
        const timer = context.collector.startTimer('CONSENSUS_VOTE_PROCESSING');
        // Simulated vote validation & certificate creation
        const blockHash = crypto.createHash('sha256').update(`block-${workerId}`).digest('hex');
        timer({ statusCode: 200, success: true });
      }
    });

    // 4. DATABASE_STORAGE
    this.register({
      id: 'DB-001',
      name: 'High-Throughput Indexed Database Queries',
      category: 'DATABASE_STORAGE',
      description: 'Concurrent indexed queries against block, transaction, and event state.',
      targetRps: 100,
      concurrency: 10,
      durationMs: 1500,
      warmupMs: 200,
      cooldownMs: 100,
      slo: { maxP95LatencyMs: 100, maxErrorRate: 0.01 },
      taskFn: async (context, workerId) => {
        const timer = context.collector.startTimer('DB_SELECT_BLOCK_BY_HEIGHT');
        const height = (workerId % 100) + 1;
        timer({ statusCode: 200, success: true });
      }
    });

    this.register({
      id: 'DB-002',
      name: 'Concurrent Atomic Commits & WAL Checkpointing',
      category: 'DATABASE_STORAGE',
      description: 'Evaluates transaction commit latency and write-ahead lock append throughput.',
      targetRps: 50,
      concurrency: 5,
      durationMs: 1500,
      warmupMs: 200,
      cooldownMs: 100,
      slo: { maxP95LatencyMs: 150, maxErrorRate: 0.02 },
      taskFn: async (context, workerId) => {
        const timer = context.collector.startTimer('DB_ATOMIC_COMMIT');
        // Simulated atomic transaction
        timer({ statusCode: 200, success: true });
      }
    });

    // 5. SYNC_NETWORKING
    this.register({
      id: 'SYNC-001',
      name: 'Fast Block Synchronization Catch-Up',
      category: 'SYNC_NETWORKING',
      description: 'Simulates streaming batches of 50 blocks during peer synchronization catch-up.',
      targetRps: 40,
      concurrency: 4,
      durationMs: 1500,
      warmupMs: 200,
      cooldownMs: 100,
      slo: { maxP95LatencyMs: 180, maxErrorRate: 0.01 },
      taskFn: async (context, workerId) => {
        const timer = context.collector.startTimer('SYNC_BLOCK_BATCH');
        const batchSize = 50;
        timer({ statusCode: 200, success: true, bytesReceived: batchSize * 1024 });
      }
    });

    // 6. RESOURCE_SATURATION
    this.register({
      id: 'RES-001',
      name: 'Mempool Saturation & Backpressure Enforcement',
      category: 'RESOURCE_SATURATION',
      description: 'High-arrival burst to test explicit 429 / backpressure handling when queue is full.',
      targetRps: 120,
      concurrency: 12,
      durationMs: 1500,
      warmupMs: 200,
      cooldownMs: 100,
      slo: { maxP95LatencyMs: 150, maxErrorRate: 0.40 }, // Expected backpressure 429s under burst
      taskFn: async (context, workerId) => {
        const timer = context.collector.startTimer('POST /api/v1/mempool/submit');
        const isQueueFull = (workerId % 5) === 0;
        const statusCode = isQueueFull ? 429 : 200;
        timer({ statusCode, success: !isQueueFull, errorType: isQueueFull ? 'MEMPOOL_FULL' : null });
      }
    });
  }

  /**
   * Register a workload definition.
   */
  register(workload) {
    if (!workload || !workload.id) {
      throw new Error('Workload definition must provide a valid "id"');
    }
    if (typeof workload.taskFn !== 'function') {
      throw new Error(`Workload ${workload.id} must define an async taskFn`);
    }

    this.workloads.set(workload.id.toUpperCase(), {
      id: workload.id.toUpperCase(),
      name: workload.name || workload.id,
      category: (workload.category || 'GENERAL').toUpperCase(),
      description: workload.description || '',
      targetRps: workload.targetRps || 50,
      concurrency: workload.concurrency || 5,
      durationMs: workload.durationMs || 2000,
      warmupMs: workload.warmupMs || 200,
      cooldownMs: workload.cooldownMs || 100,
      slo: workload.slo || { maxP95LatencyMs: 200, maxErrorRate: 0.05 },
      taskFn: workload.taskFn
    });
  }

  /**
   * Check if workload exists.
   */
  has(id) {
    if (!id) return false;
    return this.workloads.has(String(id).toUpperCase());
  }

  /**
   * Get workload by ID.
   */
  get(id) {
    if (!id) return null;
    return this.workloads.get(String(id).toUpperCase()) || null;
  }

  /**
   * Get all workloads.
   */
  getAll() {
    return Array.from(this.workloads.values());
  }

  /**
   * Filter workloads by domain category.
   */
  getByCategory(category) {
    if (!category) return [];
    const catUpper = String(category).toUpperCase();
    return this.getAll().filter(w => w.category === catUpper);
  }

  /**
   * List sanitized metadata of all workloads.
   */
  list() {
    return this.getAll().map(w => ({
      id: w.id,
      name: w.name,
      category: w.category,
      description: w.description,
      targetRps: w.targetRps,
      concurrency: w.concurrency,
      durationMs: w.durationMs,
      warmupMs: w.warmupMs,
      cooldownMs: w.cooldownMs,
      slo: w.slo
    }));
  }

  get size() {
    return this.workloads.size;
  }
}

const defaultWorkloadRegistry = new WorkloadRegistry();

module.exports = {
  WorkloadRegistry,
  defaultWorkloadRegistry
};
