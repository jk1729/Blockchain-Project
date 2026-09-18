/**
 * Phase 18: Database Pooling, Concurrency & Circuit Breaking Test Suite
 */

const { DatabasePool, DatabasePoolError } = require('../src/database/DatabasePool');

describe('Phase 18: Database Connection Pooling & Concurrency', () => {
  let pool;

  beforeEach(() => {
    pool = new DatabasePool({
      maxConnections: 5,
      minConnections: 1,
      maxCircuitFailures: 3,
      circuitResetTimeMs: 100 // Short for testing
    });
  });

  describe('1. Acquisition and Release Lifecycle', () => {
    test('should acquire connection and decrement available count', async () => {
      const acquired = await pool.acquire();
      expect(acquired).toBe(true);

      const status = pool.getStatus();
      expect(status.activeConnections).toBe(1);
      expect(status.availableConnections).toBe(4);

      pool.release();
      const statusAfter = pool.getStatus();
      expect(statusAfter.activeConnections).toBe(0);
      expect(statusAfter.availableConnections).toBe(5);
    });

    test('should throw POOL_EXHAUSTED when connection limit is reached', async () => {
      // Acquire all 5 connections
      for (let i = 0; i < 5; i++) {
        await pool.acquire();
      }

      const status = pool.getStatus();
      expect(status.activeConnections).toBe(5);
      expect(status.availableConnections).toBe(0);

      // 6th acquire must fail
      await expect(pool.acquire()).rejects.toThrow(DatabasePoolError);
      await expect(pool.acquire()).rejects.toThrow('pool exhausted');
    });
  });

  describe('2. Circuit Breaker Resilience', () => {
    test('should trip circuit breaker after consecutive failures threshold', async () => {
      pool.recordFailure(new Error('Connection timeout 1'));
      pool.recordFailure(new Error('Connection timeout 2'));
      expect(pool.circuitOpen).toBe(false);

      // 3rd failure trips the breaker
      pool.recordFailure(new Error('Connection timeout 3'));
      expect(pool.circuitOpen).toBe(true);

      // Subsequent acquire must fail immediately with CIRCUIT_BREAKER_OPEN
      await expect(pool.acquire()).rejects.toThrow('circuit breaker is OPEN');
    });

    test('should reset circuit breaker after successful operation or cooldown', async () => {
      pool.recordFailure(new Error('Err 1'));
      pool.recordFailure(new Error('Err 2'));
      pool.recordFailure(new Error('Err 3'));
      expect(pool.circuitOpen).toBe(true);

      // Wait for circuit reset timeout (100ms)
      await new Promise(resolve => setTimeout(resolve, 150));

      // Half-open acquire succeeds
      const acquired = await pool.acquire();
      expect(acquired).toBe(true);
      expect(pool.circuitOpen).toBe(false);
      pool.release();
    });
  });

  describe('3. Concurrency Simulation', () => {
    test('should handle concurrent acquire and release waves safely', async () => {
      const operations = Array.from({ length: 20 }, async (_, i) => {
        try {
          await pool.acquire();
          await new Promise(res => setTimeout(res, 5));
          pool.release();
          return true;
        } catch (err) {
          return false;
        }
      });

      const results = await Promise.all(operations);
      expect(results.length).toBe(20);
      expect(pool.activeConnections).toBe(0);
    });
  });
});

