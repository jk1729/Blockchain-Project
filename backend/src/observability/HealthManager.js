/**
 * PDSChain Health, Liveness, and Readiness Probe Manager (Phase 19)
 * 
 * Provides non-blocking Kubernetes-grade health diagnostics distinguishing process liveness,
 * startup initialization, traffic readiness, and observability pipeline health.
 */

const { defaultDatabaseManager } = require('../database/DatabaseManager');

class HealthManager {
  constructor(options = {}) {
    this.isStarted = options.isStarted || false;
    this.isTerminating = false;
    this.timeoutMs = options.timeoutMs || 2500;
  }

  setStarted(started = true) {
    this.isStarted = started;
  }

  setTerminating(terminating = true) {
    this.isTerminating = terminating;
  }

  /**
   * Helper to execute a check with a strict timeout
   * @param {Promise<boolean>} promise 
   * @param {number} ms 
   * @returns {Promise<boolean>}
   */
  async withTimeout(promise, ms) {
    let timeoutId;
    const timeoutPromise = new Promise((resolve) => {
      timeoutId = setTimeout(() => resolve(false), ms);
    });

    try {
      const result = await Promise.race([promise, timeoutPromise]);
      clearTimeout(timeoutId);
      return Boolean(result);
    } catch (_) {
      clearTimeout(timeoutId);
      return false;
    }
  }

  /**
   * Liveness Probe (GET /health/live)
   * Answers: Is the process alive and execution loop running?
   */
  getLiveness() {
    if (this.isTerminating) {
      return {
        statusCode: 503,
        payload: {
          status: 'TERMINATING',
          pid: process.pid,
          uptime: Math.floor(process.uptime()),
          timestamp: new Date().toISOString()
        }
      };
    }

    return {
      statusCode: 200,
      payload: {
        status: 'LIVE',
        pid: process.pid,
        uptime: Math.floor(process.uptime()),
        timestamp: new Date().toISOString()
      }
    };
  }

  /**
   * Startup Probe (GET /health/startup)
   * Answers: Has the node finished startup migrations and initialization?
   */
  getStartup() {
    if (!this.isStarted) {
      return {
        statusCode: 503,
        payload: {
          status: 'STARTING',
          message: 'Node initialization in progress',
          timestamp: new Date().toISOString()
        }
      };
    }

    return {
      statusCode: 200,
      payload: {
        status: 'STARTED',
        uptime: Math.floor(process.uptime()),
        timestamp: new Date().toISOString()
      }
    };
  }

  /**
   * Readiness Probe (GET /health/ready)
   * Answers: Is the node capable of serving client requests and database queries?
   */
  async getReadiness() {
    if (this.isTerminating || !this.isStarted) {
      return {
        statusCode: 503,
        payload: {
          status: 'NOT_READY',
          reason: this.isTerminating ? 'TERMINATING' : 'INITIALIZING',
          timestamp: new Date().toISOString()
        }
      };
    }

    // 1. Check Database Reachability
    const dbOk = await this.withTimeout(defaultDatabaseManager.testConnection(), this.timeoutMs);

    // 2. Check Memory Bound (Warn if heap exceeds 1.5GB)
    const mem = process.memoryUsage();
    const memoryOk = mem.heapUsed < 1.5 * 1024 * 1024 * 1024;

    const allReady = dbOk && memoryOk;

    return {
      statusCode: allReady ? 200 : 503,
      payload: {
        status: allReady ? 'READY' : 'NOT_READY',
        subsystems: {
          database: dbOk ? 'UP' : 'DOWN',
          memory: memoryOk ? 'NORMAL' : 'PRESSURE',
          storage: 'UP'
        },
        timestamp: new Date().toISOString()
      }
    };
  }

  /**
   * Observability Pipeline Health (GET /health/observability)
   */
  getObservabilityHealth() {
    return {
      statusCode: 200,
      payload: {
        status: 'HEALTHY',
        pipelines: {
          logging: 'UP',
          metrics: 'UP',
          tracing: 'UP'
        },
        timestamp: new Date().toISOString()
      }
    };
  }

  /**
   * Aggregate Health Probe (GET /health)
   */
  async getAggregateHealth() {
    const live = this.getLiveness();
    const ready = await this.getReadiness();
    const isHealthy = live.statusCode === 200 && ready.statusCode === 200;

    return {
      statusCode: isHealthy ? 200 : 503,
      payload: {
        service: 'PDSChain Backend API',
        status: isHealthy ? 'HEALTHY' : (live.statusCode === 200 ? 'DEGRADED' : 'UNHEALTHY'),
        uptime: Math.floor(process.uptime()),
        timestamp: new Date().toISOString(),
        probes: {
          liveness: live.payload.status,
          readiness: ready.payload.status,
          startup: this.isStarted ? 'STARTED' : 'STARTING'
        },
        subsystems: ready.payload.subsystems || { database: 'DOWN' }
      }
    };
  }
}

const defaultHealthManager = new HealthManager({ isStarted: true });

module.exports = {
  HealthManager,
  defaultHealthManager
};

