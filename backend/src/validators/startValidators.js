const { fork } = require('child_process');
const path = require('path');
const { DEFAULT_12_VALIDATORS, resolveValidatorId } = require('../consensus/consensusConfig');
const { createValidatorApp } = require('./validatorServer');
const logger = require('../utils/logger');

const runningProcesses = new Map(); // validatorId -> { validatorId, shortId, port, pid, child, server, status, startedAt, restartCount }

/**
 * Start a single validator as an isolated OS child process (default) or in-process server
 */
function startSingleValidator(vConfig, options = {}) {
  const useChildProcess = options.multiProcess !== false;
  const validatorId = vConfig.validatorId;

  if (runningProcesses.has(validatorId)) {
    const existing = runningProcesses.get(validatorId);
    if (existing.status === 'ONLINE') {
      return Promise.resolve(existing);
    }
  }

  if (!useChildProcess) {
    return new Promise((resolve) => {
      const { app, state } = createValidatorApp(vConfig);
      const server = app.listen(vConfig.port, '127.0.0.1', () => {
        const rec = {
          validatorId: vConfig.validatorId,
          shortId: vConfig.shortId,
          port: vConfig.port,
          pid: process.pid,
          mode: 'in-process',
          status: 'ONLINE',
          startedAt: new Date().toISOString(),
          restartCount: 0,
          server
        };
        runningProcesses.set(validatorId, rec);
        logger.info(`[VALIDATOR-NODE] ${state.validatorId} (${vConfig.shortId} - ${state.name}) online on port ${vConfig.port}`);
        resolve(rec);
      });
      server.on('error', () => {
        resolve({ validatorId, shortId: vConfig.shortId, port: vConfig.port, pid: process.pid, status: 'PORT_IN_USE' });
      });
    });
  }

  return new Promise((resolve) => {
    const workerScript = path.resolve(__dirname, 'validatorWorker.js');
    const child = fork(workerScript, [validatorId], {
      env: {
        ...process.env,
        VALIDATOR_ID: validatorId,
        API_PORT: String(vConfig.port),
        PORT: String(vConfig.port),
        P2P_PORT: String(vConfig.p2pPort || (vConfig.port + 1000))
      },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc']
    });

    const prevRestartCount = runningProcesses.get(validatorId)?.restartCount || 0;
    const rec = {
      validatorId: vConfig.validatorId,
      shortId: vConfig.shortId,
      name: vConfig.name,
      org: vConfig.org,
      port: vConfig.port,
      p2pPort: vConfig.p2pPort,
      pid: child.pid,
      mode: 'isolated-os-process',
      status: 'STARTING',
      startedAt: new Date().toISOString(),
      restartCount: prevRestartCount,
      expectedShutdown: false,
      child
    };
    runningProcesses.set(validatorId, rec);

    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        rec.status = 'ONLINE';
        resolve(rec);
      }
    }, 3000);

    child.on('message', (msg) => {
      if (msg && msg.type === 'VALIDATOR_READY') {
        clearTimeout(timer);
        rec.status = 'ONLINE';
        rec.pid = msg.pid || child.pid;
        rec.publicKey = msg.publicKey;
        rec.address = msg.address;
        logger.info(`[VALIDATOR-PROCESS] ${rec.validatorId} (${rec.shortId}) online [PID: ${rec.pid}, Port: ${rec.port}]`);
        if (!settled) {
          settled = true;
          resolve(rec);
        }
      } else if (msg && msg.type === 'VALIDATOR_ERROR') {
        clearTimeout(timer);
        if (msg.code === 'EADDRINUSE') {
          rec.status = 'EXTERNAL_PROCESS_ONLINE';
        } else {
          rec.status = 'ERROR';
        }
        if (!settled) {
          settled = true;
          resolve(rec);
        }
      }
    });

    child.on('exit', (code) => {
      clearTimeout(timer);
      if (rec.status !== 'EXTERNAL_PROCESS_ONLINE') {
        rec.status = 'STOPPED';
      }
      if (!settled) {
        settled = true;
        resolve(rec);
      }
      if (!rec.expectedShutdown && options.autoRestart !== false && rec.status !== 'EXTERNAL_PROCESS_ONLINE' && rec.restartCount < 5) {
        rec.restartCount += 1;
        setTimeout(() => {
          if (!rec.expectedShutdown) {
            startSingleValidator(vConfig, options).catch(() => {});
          }
        }, 500 * rec.restartCount);
      }
    });
  });
}

async function startAllValidators(options = {}) {
  logger.info('Starting 12 Independent FBA Validator OS Processes (V1..V12 / VAL-01..VAL-12)...');
  const results = await Promise.all(
    DEFAULT_12_VALIDATORS.map(vConfig => startSingleValidator(vConfig, options))
  );
  logger.info(`All ${results.length} FBA Validator Processes initialized!`);
  return results;
}

async function stopValidatorProcess(validatorId) {
  const vId = resolveValidatorId(validatorId);
  const rec = runningProcesses.get(vId);
  if (!rec) return false;
  rec.expectedShutdown = true;
  if (rec.server) {
    try { rec.server.close(); } catch (e) {}
    rec.status = 'STOPPED';
    return true;
  }
  if (rec.child && rec.child.exitCode === null && !rec.child.killed) {
    await new Promise((resolve) => {
      const killTimer = setTimeout(() => {
        try { rec.child.kill('SIGKILL'); } catch (e) {}
        resolve();
      }, 2000);
      rec.child.once('exit', () => {
        clearTimeout(killTimer);
        resolve();
      });
      try {
        if (rec.child.connected) {
          rec.child.send({ type: 'STOP' });
        } else {
          rec.child.kill('SIGTERM');
        }
      } catch (e) {
        try { rec.child.kill('SIGTERM'); } catch (_) {}
        resolve();
      }
    });
  }
  rec.status = 'STOPPED';
  return true;
}

async function restartValidatorProcess(validatorId, options = {}) {
  const vId = resolveValidatorId(validatorId);
  await stopValidatorProcess(vId);
  const vConfig = DEFAULT_12_VALIDATORS.find(v => v.validatorId === vId);
  if (!vConfig) throw new Error(`Unknown validator ${validatorId}`);
  return await startSingleValidator(vConfig, options);
}

async function stopAllValidators() {
  const ids = Array.from(runningProcesses.keys());
  await Promise.all(ids.map(id => stopValidatorProcess(id)));
  runningProcesses.clear();
  logger.info('All 12 FBA Validator Processes stopped.');
}

function getValidatorProcessStatuses() {
  return DEFAULT_12_VALIDATORS.map(v => {
    const rec = runningProcesses.get(v.validatorId);
    const isRunning = Boolean(rec && (rec.status === 'ONLINE' || rec.status === 'EXTERNAL_PROCESS_ONLINE'));
    return {
      validatorId: v.validatorId,
      shortId: v.shortId,
      name: v.name,
      org: v.org,
      port: v.port,
      p2pPort: v.p2pPort,
      pid: rec ? rec.pid : null,
      running: isRunning,
      mode: rec ? rec.mode : 'not-started',
      processStatus: rec ? rec.status : 'NOT_STARTED',
      startedAt: rec ? rec.startedAt : null,
      restartCount: rec ? rec.restartCount : 0
    };
  });
}

if (require.main === module) {
  startAllValidators({ multiProcess: true, autoRestart: true });

  process.on('SIGINT', async () => {
    logger.info('Shutting down 12 validator processes...');
    await stopAllValidators();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    await stopAllValidators();
    process.exit(0);
  });
}

module.exports = {
  startAllValidators,
  stopAllValidators,
  startSingleValidator,
  stopValidatorProcess,
  restartValidatorProcess,
  getValidatorProcessStatuses
};
