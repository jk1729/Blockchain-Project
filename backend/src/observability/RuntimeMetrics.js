/**
 * PDSChain Node.js Runtime Telemetry (Phase 19)
 * 
 * Collects process uptime, event-loop lag, memory footprint (heap/RSS),
 * CPU consumption, and active asynchronous handles.
 */

const { defaultMetricsRegistry } = require('./MetricsRegistry');

class RuntimeMetrics {
  constructor(registry = defaultMetricsRegistry) {
    this.registry = registry;
    this.timer = null;
    this.lastCpuUsage = process.cpuUsage();
    this.lastCpuTime = Date.now();

    this.processUptimeSeconds = this.registry.registerGauge(
      'pds_process_uptime_seconds',
      'Total uptime of the Node.js process in seconds'
    );

    this.eventLoopLagSeconds = this.registry.registerGauge(
      'pds_runtime_event_loop_lag_seconds',
      'Measured event-loop delay in seconds'
    );

    this.heapUsedBytes = this.registry.registerGauge(
      'pds_runtime_heap_used_bytes',
      'V8 heap memory currently used in bytes'
    );

    this.heapTotalBytes = this.registry.registerGauge(
      'pds_runtime_heap_total_bytes',
      'Total V8 heap memory allocated in bytes'
    );

    this.rssBytes = this.registry.registerGauge(
      'pds_runtime_rss_bytes',
      'Resident Set Size memory in bytes'
    );

    this.cpuUserSeconds = this.registry.registerCounter(
      'pds_runtime_cpu_user_seconds_total',
      'Total user CPU time consumed in seconds'
    );

    this.cpuSystemSeconds = this.registry.registerCounter(
      'pds_runtime_cpu_system_seconds_total',
      'Total system CPU time consumed in seconds'
    );

    this.activeHandles = this.registry.registerGauge(
      'pds_runtime_active_handles',
      'Number of active libuv resource handles'
    );

    this.activeRequests = this.registry.registerGauge(
      'pds_runtime_active_requests',
      'Number of active libuv asynchronous requests'
    );
  }

  /**
   * Take a synchronous snapshot of runtime statistics
   */
  sample() {
    // 1. Process uptime
    this.processUptimeSeconds.set(Math.floor(process.uptime()));

    // 2. Memory
    const mem = process.memoryUsage();
    this.heapUsedBytes.set(mem.heapUsed);
    this.heapTotalBytes.set(mem.heapTotal);
    this.rssBytes.set(mem.rss);

    // 3. CPU
    const currentCpu = process.cpuUsage(this.lastCpuUsage);
    this.lastCpuUsage = process.cpuUsage();
    if (currentCpu.user > 0) {
      this.cpuUserSeconds.inc(currentCpu.user / 1e6);
    }
    if (currentCpu.system > 0) {
      this.cpuSystemSeconds.inc(currentCpu.system / 1e6);
    }

    // 4. Handles & Requests
    if (typeof process._getActiveHandles === 'function') {
      try {
        const handles = process._getActiveHandles();
        this.activeHandles.set(handles ? handles.length : 0);
      } catch (_) {}
    }
    if (typeof process._getActiveRequests === 'function') {
      try {
        const requests = process._getActiveRequests();
        this.activeRequests.set(requests ? requests.length : 0);
      } catch (_) {}
    }

    // 5. Measure Event-Loop Lag
    const start = process.hrtime();
    setImmediate(() => {
      const delta = process.hrtime(start);
      const lagSec = delta[0] + delta[1] / 1e9;
      this.eventLoopLagSeconds.set(lagSec);
    });
  }

  /**
   * Start periodic sampling
   * @param {number} [intervalMs=5000] 
   */
  startSampling(intervalMs = 5000) {
    if (this.timer) return;
    this.sample();
    this.timer = setInterval(() => this.sample(), intervalMs);
    if (this.timer.unref) this.timer.unref(); // Prevent timer from keeping event loop alive in tests
  }

  /**
   * Stop periodic sampling
   */
  stopSampling() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

const defaultRuntimeMetrics = new RuntimeMetrics();

module.exports = {
  RuntimeMetrics,
  defaultRuntimeMetrics
};

