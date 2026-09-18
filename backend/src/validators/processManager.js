/**
 * PDSChain Multi-Process Validator Manager (Phase 9)
 * 
 * Orchestrates validator daemons running as isolated child operating-system processes.
 * Provides process lifecycle management, health monitoring, crash recovery, and IPC commands.
 */

const { fork } = require('child_process');
const path = require('path');
const EventEmitter = require('events');
const { DEFAULT_12_VALIDATORS } = require('../consensus/consensusConfig');
const logger = require('../utils/logger');

class ProcessManager extends EventEmitter {
  /**
   * @param {object} [options]
   * @param {boolean} [options.autoRestart=false]
   * @param {number} [options.startupTimeoutMs=8000]
   */
  constructor(options = {}) {
    super();
    this.autoRestart = Boolean(options.autoRestart);
    this.startupTimeoutMs = options.startupTimeoutMs || 8000;
    this.maxRestarts = options.maxRestarts !== undefined ? options.maxRestarts : 5;
    
    // validatorId -> { child, pid, status, p2pPort, apiPort, restartCount, startedAt, expectedShutdown }
    this.processes = new Map();
    this.pendingStatusRequests = new Map();
  }

  /**
   * Start a single validator as an isolated child OS process
   * @param {string} validatorId - e.g. 'VAL-01'
   * @param {object} [options]
   * @returns {Promise<object>} Process metadata including PID
   */
  async startValidator(validatorId, options = {}) {
    const vId = String(validatorId).toUpperCase().trim();
    if (this.processes.has(vId) && this.processes.get(vId).status === 'ONLINE') {
      return this.processes.get(vId);
    }

    const vConfig = DEFAULT_12_VALIDATORS.find(v => v.validatorId === vId) || {
      validatorId: vId,
      port: 4001,
      p2pPort: 5001
    };

    const apiPort = options.apiPort || options.port || vConfig.port;
    const p2pPort = options.p2pPort || vConfig.p2pPort;
    const scriptPath = path.resolve(__dirname, 'validatorProcess.js');

    const env = {
      ...process.env,
      VALIDATOR_ID: vId,
      API_PORT: String(apiPort),
      PORT: String(apiPort),
      P2P_PORT: String(p2pPort),
      P2P_USE_TLS: options.useTLS ? 'true' : (options.useTLS === false ? 'false' : (process.env.P2P_USE_TLS || 'false')),
      NETWORK_ID: options.networkId || process.env.NETWORK_ID || 'pdschain-devnet',
      DATA_DIR: options.dataDir || process.env.DATA_DIR || path.resolve(process.cwd(), 'database', 'validators', vId),
      DATABASE_STORAGE: options.dbStorage || `database/validators/${vId}/pdschain.sqlite`,
      CONSENSUS_JOURNAL: options.journalPath || `database/validators/${vId}/consensus_journal.jsonl`,
      NODE_ENV: process.env.NODE_ENV || 'test'
    };

    return new Promise((resolve, reject) => {
      logger.info(`[ProcessManager] Spawning isolated OS child process for ${vId} (API: ${apiPort}, P2P: ${p2pPort})...`);

      const child = fork(scriptPath, [vId], {
        env,
        stdio: ['ignore', 'pipe', 'pipe', 'ipc']
      });

      const procRecord = {
        validatorId: vId,
        child,
        pid: child.pid,
        status: 'STARTING',
        apiPort,
        p2pPort,
        restartCount: (this.processes.get(vId)?.restartCount || 0),
        startedAt: Date.now(),
        expectedShutdown: false
      };

      this.processes.set(vId, procRecord);

      let isReady = false;
      const startupTimer = setTimeout(() => {
        if (!isReady) {
          logger.warn(`[ProcessManager] Startup timeout for ${vId} (PID: ${child.pid})`);
          this.stopValidator(vId).catch(() => {});
          reject(new Error(`Validator ${vId} timed out during startup after ${this.startupTimeoutMs}ms`));
        }
      }, this.startupTimeoutMs);

      // Handle child stdout & stderr
      if (child.stdout) {
        child.stdout.on('data', (chunk) => {
          if (process.env.DEBUG_VALIDATORS) {
            process.stdout.write(`[${vId}:${child.pid}] ${chunk}`);
          }
        });
      }
      if (child.stderr) {
        child.stderr.on('data', (chunk) => {
          if (process.env.DEBUG_VALIDATORS) {
            process.stderr.write(`[${vId}:${child.pid}:ERR] ${chunk}`);
          }
        });
      }

      // Handle IPC messages from child
      child.on('message', (msg) => {
        if (!msg || typeof msg !== 'object') return;

        if (msg.type === 'READY') {
          isReady = true;
          clearTimeout(startupTimer);
          procRecord.status = 'ONLINE';
          logger.info(`[ProcessManager] Validator ${vId} confirmed READY (PID: ${child.pid})`);
          this.emit('validator_ready', procRecord);
          resolve(procRecord);
        }

        if (msg.type === 'STATUS_RESPONSE') {
          const correlationId = msg.correlationId;
          if (correlationId && this.pendingStatusRequests.has(correlationId)) {
            const cb = this.pendingStatusRequests.get(correlationId);
            this.pendingStatusRequests.delete(correlationId);
            cb(msg.data);
          }
        }
      });

      // Handle process exit
      child.on('exit', (code, signal) => {
        clearTimeout(startupTimer);
        const wasExpected = procRecord.expectedShutdown;
        procRecord.status = 'STOPPED';
        logger.info(`[ProcessManager] Validator ${vId} (PID: ${child.pid}) exited (code: ${code}, signal: ${signal}, expected: ${wasExpected})`);
        this.emit('validator_exit', vId, code, signal, wasExpected);

        // Auto-restart if unexpected and within bounded retry limit
        if (!wasExpected && this.autoRestart) {
          if (procRecord.restartCount >= this.maxRestarts) {
            procRecord.status = 'FAILED_PERMANENT';
            logger.error(`[ProcessManager] Validator ${vId} reached maximum restart limit (${this.maxRestarts}). Halting restarts.`);
            this.emit('validator_failed_permanent', vId, procRecord.restartCount);
            return;
          }

          procRecord.restartCount++;
          const backoffDelay = Math.min(8000, 500 * Math.pow(2, procRecord.restartCount - 1));
          logger.warn(`[ProcessManager] Unexpected exit for ${vId}. Auto-restarting with backoff in ${backoffDelay}ms (attempt #${procRecord.restartCount}/${this.maxRestarts})...`);
          setTimeout(() => {
            this.startValidator(vId, options).catch(err => {
              logger.error(`[ProcessManager] Failed to auto-restart ${vId}: ${err.message}`);
            });
          }, backoffDelay);
        }
      });

      child.on('error', (err) => {
        logger.error(`[ProcessManager] Child process error for ${vId}: ${err.message}`);
        this.emit('validator_error', vId, err);
      });
    });
  }

  /**
   * Stop a running validator process gracefully
   * @param {string} validatorId 
   * @param {number} [timeoutMs=4000]
   */
  async stopValidator(validatorId, timeoutMs = 4000) {
    const vId = String(validatorId).toUpperCase().trim();
    const procRecord = this.processes.get(vId);
    if (!procRecord || !procRecord.child) return;

    procRecord.expectedShutdown = true;

    return new Promise((resolve) => {
      const child = procRecord.child;

      if (child.exitCode !== null || child.killed) {
        procRecord.status = 'STOPPED';
        return resolve();
      }

      let forceKillTimer = setTimeout(() => {
        if (child.exitCode === null && !child.killed) {
          logger.warn(`[ProcessManager] Forcing SIGKILL on ${vId} (PID: ${child.pid})`);
          child.kill('SIGKILL');
        }
        resolve();
      }, timeoutMs);

      child.once('exit', () => {
        clearTimeout(forceKillTimer);
        procRecord.status = 'STOPPED';
        resolve();
      });

      try {
        if (child.connected) {
          child.send({ type: 'STOP' });
        } else {
          child.kill('SIGTERM');
        }
      } catch (err) {
        child.kill('SIGTERM');
      }
    });
  }

  /**
   * Restart a validator process
   * @param {string} validatorId 
   * @param {object} [options]
   */
  async restartValidator(validatorId, options = {}) {
    await this.stopValidator(validatorId);
    return this.startValidator(validatorId, options);
  }

  /**
   * Start multiple validator processes
   * @param {string[]} validatorIds 
   * @param {object} [options]
   */
  async startAll(validatorIds = null, options = {}) {
    const ids = Array.isArray(validatorIds) && validatorIds.length > 0
      ? validatorIds
      : DEFAULT_12_VALIDATORS.map(v => v.validatorId);

    logger.info(`[ProcessManager] Starting ${ids.length} isolated validator processes...`);
    const results = [];

    for (const vId of ids) {
      const res = await this.startValidator(vId, options);
      results.push(res);
    }

    logger.info(`[ProcessManager] All ${results.length} isolated validator processes are ONLINE!`);
    return results;
  }

  /**
   * Stop all active validator processes
   */
  async stopAll() {
    logger.info(`[ProcessManager] Stopping all running validator processes...`);
    const promises = [];
    for (const vId of this.processes.keys()) {
      promises.push(this.stopValidator(vId));
    }
    await Promise.all(promises);
    this.processes.clear();
    logger.info(`[ProcessManager] All validator processes stopped.`);
  }

  getStatus(validatorId) {
    const vId = String(validatorId).toUpperCase().trim();
    const p = this.processes.get(vId);
    if (!p) return null;
    return {
      validatorId: p.validatorId,
      pid: p.pid,
      status: p.status,
      apiPort: p.apiPort,
      p2pPort: p.p2pPort,
      restartCount: p.restartCount,
      uptimeSeconds: p.startedAt ? Math.floor((Date.now() - p.startedAt) / 1000) : 0
    };
  }

  getAllStatuses() {
    const statuses = [];
    for (const vId of this.processes.keys()) {
      statuses.push(this.getStatus(vId));
    }
    return statuses;
  }

  isOnline(validatorId) {
    const p = this.processes.get(String(validatorId).toUpperCase().trim());
    return Boolean(p && p.status === 'ONLINE' && p.child && p.child.exitCode === null);
  }

  async requestLiveStatus(validatorId, timeoutMs = 3000) {
    const vId = String(validatorId).toUpperCase().trim();
    const p = this.processes.get(vId);
    if (!p || !p.child || !p.child.connected) {
      return this.getStatus(vId);
    }

    return new Promise((resolve) => {
      const correlationId = `REQ-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const timer = setTimeout(() => {
        this.pendingStatusRequests.delete(correlationId);
        resolve(this.getStatus(vId));
      }, timeoutMs);

      this.pendingStatusRequests.set(correlationId, (data) => {
        clearTimeout(timer);
        resolve(data);
      });

      p.child.send({ type: 'GET_STATUS', correlationId });
    });
  }

  async checkHealth(validatorId, endpoint = '/health') {
    const vId = String(validatorId).toUpperCase().trim();
    const p = this.processes.get(vId);
    if (!p || !p.apiPort) return { error: 'Validator not found or offline', statusCode: 503 };

    try {
      const http = require('http');
      return new Promise((resolve) => {
        const req = http.get(`http://127.0.0.1:${p.apiPort}${endpoint}`, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            try {
              resolve({ statusCode: res.statusCode, body: JSON.parse(data) });
            } catch (e) {
              resolve({ statusCode: res.statusCode, body: data });
            }
          });
        });
        req.on('error', (err) => resolve({ error: err.message, statusCode: 503 }));
        req.setTimeout(2000, () => {
          req.destroy();
          resolve({ error: 'Timeout', statusCode: 504 });
        });
      });
    } catch (e) {
      return { error: e.message, statusCode: 500 };
    }
  }

  async checkLiveness(validatorId) {
    return this.checkHealth(validatorId, '/health/live');
  }

  async checkReadiness(validatorId) {
    return this.checkHealth(validatorId, '/health/ready');
  }

  async checkConsensusReadiness(validatorId) {
    return this.checkHealth(validatorId, '/health/consensus');
  }

  async getVersion(validatorId) {
    return this.checkHealth(validatorId, '/version');
  }
}

module.exports = ProcessManager;

