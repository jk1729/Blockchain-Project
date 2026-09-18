const path = require('path');
const fs = require('fs');
const ProcessManager = require('../src/validators/processManager');
const { StorageLayout } = require('../src/storage/StorageLayout');

describe('PHASE 11: Multi-Validator Network Deployment & Acceptance Suite', () => {
  let manager;
  const nodes = ['VAL-01', 'VAL-02', 'VAL-03'];
  const testRoot = path.resolve(__dirname, 'tmp-multivalidator-network');

  beforeAll(async () => {
    if (!fs.existsSync(testRoot)) {
      fs.mkdirSync(testRoot, { recursive: true });
    }
    manager = new ProcessManager({ autoRestart: false, startupTimeoutMs: 12000 });
  });

  afterAll(async () => {
    if (manager) {
      await manager.stopAll();
    }
    if (fs.existsSync(testRoot)) {
      fs.rmSync(testRoot, { recursive: true, force: true });
    }
  });

  it('1. should start a 3-validator network with isolated storage and unique ports', async () => {
    const started = [];
    for (let i = 0; i < nodes.length; i++) {
      const vId = nodes[i];
      const apiPort = 4301 + i;
      const p2pPort = 5301 + i;
      const nodeDir = path.join(testRoot, vId);

      const res = await manager.startValidator(vId, {
        apiPort,
        p2pPort,
        dataDir: nodeDir,
        dbStorage: path.join(nodeDir, 'pdschain.sqlite'),
        journalPath: path.join(nodeDir, 'consensus_journal.jsonl')
      });
      started.push(res);
    }

    expect(started.length).toBe(3);

    // Verify unique PIDs
    const pids = new Set(started.map(s => s.pid));
    expect(pids.size).toBe(3);

    // Verify unique API & P2P ports
    const apiPorts = new Set(started.map(s => s.apiPort));
    expect(apiPorts.size).toBe(3);

    // Verify each validator holds its own PID lockfile in isolated storage
    for (const vId of nodes) {
      const layout = new StorageLayout(vId, path.join(testRoot, vId));
      expect(fs.existsSync(layout.pidPath)).toBe(true);
      expect(fs.existsSync(layout.databaseDir)).toBe(true);
      expect(fs.existsSync(layout.journalDir)).toBe(true);
    }
  }, 25000);

  it('2. should verify health and liveness probes across all running validators', async () => {
    for (const vId of nodes) {
      const live = await manager.checkLiveness(vId);
      expect(live.statusCode).toBe(200);
      expect(live.body.status).toBe('LIVE');
      expect(live.body.validatorId).toBe(vId);

      const ready = await manager.checkReadiness(vId);
      expect(ready.statusCode).toBe(200);
      expect(ready.body.status).toBe('READY');

      const version = await manager.getVersion(vId);
      expect(version.statusCode).toBe(200);
      expect(version.body.protocolVersion).toBe(1);
    }
  }, 10000);

  it('3. should stop one validator and restart it cleanly without affecting others', async () => {
    // Stop VAL-03
    await manager.stopValidator('VAL-03');
    expect(manager.isOnline('VAL-03')).toBe(false);

    // VAL-01 and VAL-02 must remain online and responsive
    expect(manager.isOnline('VAL-01')).toBe(true);
    expect(manager.isOnline('VAL-02')).toBe(true);

    const live01 = await manager.checkLiveness('VAL-01');
    expect(live01.statusCode).toBe(200);

    // Restart VAL-03
    const nodeDir = path.join(testRoot, 'VAL-03');
    const restarted = await manager.startValidator('VAL-03', {
      apiPort: 4303,
      p2pPort: 5303,
      dataDir: nodeDir,
      dbStorage: path.join(nodeDir, 'pdschain.sqlite'),
      journalPath: path.join(nodeDir, 'consensus_journal.jsonl')
    });

    expect(restarted.status).toBe('ONLINE');
    expect(manager.isOnline('VAL-03')).toBe(true);

    const live03 = await manager.checkLiveness('VAL-03');
    expect(live03.statusCode).toBe(200);
  }, 15000);

  it('4. should gracefully stop all validators and release all PID locks', async () => {
    await manager.stopAll();

    for (const vId of nodes) {
      expect(manager.isOnline(vId)).toBe(false);
      const layout = new StorageLayout(vId, path.join(testRoot, vId));
      expect(fs.existsSync(layout.pidPath)).toBe(false);
    }
  }, 10000);
});

