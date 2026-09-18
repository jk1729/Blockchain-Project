const http = require('http');
const path = require('path');
const fs = require('fs');
const ProcessManager = require('../src/validators/processManager');

function fetchJson(port, pathName) {
  return new Promise((resolve, reject) => {
    const req = http.get({
      host: '127.0.0.1',
      port,
      path: pathName,
      timeout: 3000
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
  });
}

describe('PHASE 9: Multi-Process Validator Runtime & Process Isolation Test Suite', () => {
  let pm;
  const testVal1 = 'VAL-01';
  const testVal2 = 'VAL-02';

  // Dedicated test ports to avoid port conflicts with other tests
  const portApi1 = 14001;
  const portP2p1 = 15101;
  const portApi2 = 14002;
  const portP2p2 = 15102;

  beforeAll(() => {
    pm = new ProcessManager({ startupTimeoutMs: 10000 });
  });

  afterAll(async () => {
    if (pm) {
      await pm.stopAll();
    }
  }, 15000);

  test('1. should spawn validators as isolated child OS processes with distinct PIDs', async () => {
    const proc1 = await pm.startValidator(testVal1, {
      apiPort: portApi1,
      p2pPort: portP2p1,
      dbStorage: `database/validators/${testVal1}/pdschain.sqlite`,
      journalPath: `database/validators/${testVal1}/consensus_journal.jsonl`
    });

    const proc2 = await pm.startValidator(testVal2, {
      apiPort: portApi2,
      p2pPort: portP2p2,
      dbStorage: `database/validators/${testVal2}/pdschain.sqlite`,
      journalPath: `database/validators/${testVal2}/consensus_journal.jsonl`
    });

    expect(proc1.pid).toBeDefined();
    expect(proc2.pid).toBeDefined();
    expect(proc1.pid).not.toBe(process.pid);
    expect(proc2.pid).not.toBe(process.pid);
    expect(proc1.pid).not.toBe(proc2.pid);

    expect(pm.isOnline(testVal1)).toBe(true);
    expect(pm.isOnline(testVal2)).toBe(true);
  }, 12000);

  test('2. should verify filesystem storage directory isolation per validator', () => {
    const dir1 = path.resolve(process.cwd(), 'database', 'validators', testVal1);
    const dir2 = path.resolve(process.cwd(), 'database', 'validators', testVal2);

    expect(fs.existsSync(dir1)).toBe(true);
    expect(fs.existsSync(dir2)).toBe(true);
    expect(dir1).not.toBe(dir2);
  });

  test('3. should query child process HTTP status API directly', async () => {
    const res1 = await fetchJson(portApi1, '/status');
    expect(res1.status).toBe(200);
    expect(res1.body.validatorId).toBe(testVal1);
    expect(res1.body.pid).toBe(pm.getStatus(testVal1).pid);
    expect(res1.body.status).toBe('Online');

    const res2 = await fetchJson(portApi2, '/status');
    expect(res2.status).toBe(200);
    expect(res2.body.validatorId).toBe(testVal2);
    expect(res2.body.pid).toBe(pm.getStatus(testVal2).pid);
  });

  test('4. should request live status from child daemon via IPC', async () => {
    const liveStatus = await pm.requestLiveStatus(testVal1);
    expect(liveStatus).toBeDefined();
    expect(liveStatus.validatorId).toBe(testVal1);
    expect(liveStatus.pid).toBe(pm.getStatus(testVal1).pid);
    expect(liveStatus.apiPort).toBe(portApi1);
    expect(liveStatus.p2pPort).toBe(portP2p1);
  });

  test('5. should cleanly terminate and restart an isolated child process', async () => {
    const oldPid = pm.getStatus(testVal1).pid;
    await pm.stopValidator(testVal1);

    expect(pm.isOnline(testVal1)).toBe(false);

    // Restart VAL-01
    const newProc = await pm.startValidator(testVal1, {
      apiPort: portApi1,
      p2pPort: portP2p1
    });

    expect(newProc.pid).not.toBe(oldPid);
    expect(pm.isOnline(testVal1)).toBe(true);
  }, 12000);
});

