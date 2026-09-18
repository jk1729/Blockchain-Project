/**
 * PDSChain Load Controller (Phase 21 - Stage B, C)
 * 
 * Manages arrival rate pacing (RPS), worker concurrency, and lifecycle phases
 * (WARMUP -> STEADY_STATE -> COOLDOWN) during load tests.
 */

class LoadController {
  constructor(options = {}) {
    this.maxConcurrency = options.maxConcurrency || 20;
    this.activeWorkers = 0;
    this.currentPhase = 'INIT';
    this.isStopped = false;
    this.stopReason = null;
  }

  /**
   * Stop or cancel active load generation.
   */
  stop(reason = 'Operator stop') {
    this.isStopped = true;
    this.stopReason = reason;
  }

  /**
   * Execute a workload task function under controlled rate and concurrency.
   * 
   * @param {object} params
   * @param {Function} params.taskFn - Async function (workerId, phase) => Promise<void>
   * @param {number} [params.targetRps=50] - Desired requests per second
   * @param {number} [params.concurrency=5] - Maximum parallel workers
   * @param {number} [params.durationMs=2000] - Total test duration in milliseconds
   * @param {number} [params.warmupMs=200] - Warmup duration in milliseconds
   * @param {number} [params.cooldownMs=100] - Cooldown drain duration in milliseconds
   */
  async executeWorkload(params = {}) {
    const taskFn = params.taskFn;
    if (typeof taskFn !== 'function') {
      throw new Error('LoadController requires an executable async taskFn');
    }

    const concurrency = Math.min(params.concurrency || 5, this.maxConcurrency);
    const targetRps = params.targetRps || 50;
    const durationMs = params.durationMs || 2000;
    const warmupMs = params.warmupMs || 200;
    const cooldownMs = params.cooldownMs || 100;

    const intervalMs = targetRps > 0 ? 1000 / targetRps : 10;
    const startTime = Date.now();
    const endTime = startTime + durationMs;
    const warmupEndTime = startTime + warmupMs;
    const cooldownStartTime = endTime - cooldownMs;

    this.isStopped = false;
    this.stopReason = null;
    this.currentPhase = 'WARMUP';

    let workerSeq = 0;
    const activePromises = new Set();

    while (Date.now() < endTime && !this.isStopped) {
      const now = Date.now();

      // Phase update
      if (now < warmupEndTime) {
        this.currentPhase = 'WARMUP';
      } else if (now < cooldownStartTime) {
        this.currentPhase = 'STEADY_STATE';
      } else {
        this.currentPhase = 'COOLDOWN';
      }

      // Check concurrency window
      if (activePromises.size < concurrency) {
        const currentWorkerId = ++workerSeq;
        const phase = this.currentPhase;

        const workerPromise = (async () => {
          try {
            await taskFn(currentWorkerId, phase);
          } catch {
            // Task error handled inside collector
          }
        })();

        activePromises.add(workerPromise);
        workerPromise.finally(() => {
          activePromises.delete(workerPromise);
        });
      }

      // Throttle pace to target RPS
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }

    // Cooldown: wait for in-flight tasks to complete
    this.currentPhase = 'DRAINING';
    await Promise.all(Array.from(activePromises));
    this.currentPhase = 'COMPLETED';

    return {
      completed: true,
      stoppedEarly: this.isStopped,
      stopReason: this.stopReason,
      totalDispatched: workerSeq,
      durationMs: Date.now() - startTime
    };
  }
}

module.exports = { LoadController };

