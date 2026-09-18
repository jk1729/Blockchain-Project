const fs = require('fs');
const path = require('path');
const { StorageLayout, StorageLockError } = require('../src/storage/StorageLayout');
const { BackupManager, BackupError } = require('../src/storage/BackupManager');

describe('PHASE 11: Storage Layout, Volume Isolation & Disaster Recovery Suite', () => {
  const tmpRoot = path.resolve(__dirname, 'tmp-storage-test');

  beforeAll(() => {
    if (!fs.existsSync(tmpRoot)) {
      fs.mkdirSync(tmpRoot, { recursive: true });
    }
  });

  afterAll(() => {
    if (fs.existsSync(tmpRoot)) {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  describe('1. Storage Layout & Path Isolation', () => {
    it('1.1 should construct isolated directories for VAL-01', () => {
      const layout = new StorageLayout('VAL-01', path.join(tmpRoot, 'VAL-01'));
      layout.ensureDirectories();

      expect(fs.existsSync(layout.databaseDir)).toBe(true);
      expect(fs.existsSync(layout.journalDir)).toBe(true);
      expect(fs.existsSync(layout.checkpointDir)).toBe(true);
      expect(fs.existsSync(layout.backupsDir)).toBe(true);
    });

    it('1.2 should verify path containment and detect directory traversal attempts', () => {
      const layout = new StorageLayout('VAL-01', path.join(tmpRoot, 'VAL-01'));
      expect(layout.isPathContained(path.join(tmpRoot, 'VAL-01', 'database', 'pdschain.sqlite'))).toBe(true);
      expect(layout.isPathContained(path.join(tmpRoot, 'VAL-02', 'pdschain.sqlite'))).toBe(false);
      expect(layout.isPathContained(path.join(tmpRoot, 'VAL-01', '..', 'VAL-02'))).toBe(false);
    });

    it('1.3 should acquire and release PID lock successfully', () => {
      const layout = new StorageLayout('VAL-01', path.join(tmpRoot, 'VAL-01'));
      layout.acquirePidLock();
      expect(fs.existsSync(layout.pidPath)).toBe(true);
      expect(parseInt(fs.readFileSync(layout.pidPath, 'utf8').trim(), 10)).toBe(process.pid);

      layout.releasePidLock();
      expect(fs.existsSync(layout.pidPath)).toBe(false);
    });

    it('1.4 should reject duplicate instance when PID lock is held by an active process', () => {
      const layout1 = new StorageLayout('VAL-01', path.join(tmpRoot, 'VAL-01'));
      layout1.acquirePidLock();

      const layout2 = new StorageLayout('VAL-01', path.join(tmpRoot, 'VAL-01'));
      // Simulate existing active process lock
      expect(() => layout2.acquirePidLock()).toThrow(StorageLockError);

      layout1.releasePidLock();
    });
  });

  describe('2. Backup Creation, Verification & Restore', () => {
    it('2.1 should create a verified backup snapshot and manifest', () => {
      const layout = new StorageLayout('VAL-01', path.join(tmpRoot, 'VAL-01'));
      layout.ensureDirectories();

      // Create dummy sqlite and journal files
      fs.writeFileSync(layout.dbPath, 'SQLITE-TEST-BLOCKCHAIN-DATA');
      fs.writeFileSync(layout.journalPath, '{"type":"PROPOSAL","round":1}\n');

      const { backupPath, manifest } = BackupManager.createBackup({
        storageLayout: layout,
        blockHeight: 10,
        blockHash: '0xabc123',
        networkId: 'pdschain-testnet',
        chainId: 1729
      });

      expect(fs.existsSync(backupPath)).toBe(true);
      expect(manifest.validatorId).toBe('VAL-01');
      expect(manifest.blockHeight).toBe(10);
      expect(manifest.files.length).toBe(2);

      const verification = BackupManager.verifyBackup(backupPath);
      expect(verification.valid).toBe(true);
    });

    it('2.2 should strictly exclude private identity from automated backup', () => {
      const layout = new StorageLayout('VAL-01', path.join(tmpRoot, 'VAL-01'));
      fs.writeFileSync(layout.identityPath, 'SECRET_PRIVATE_KEY_DATA');

      const { backupPath } = BackupManager.createBackup({
        storageLayout: layout,
        blockHeight: 10
      });

      expect(fs.existsSync(path.join(backupPath, 'identity.json'))).toBe(false);
    });

    it('2.3 should detect tampered file in backup during verification', () => {
      const layout = new StorageLayout('VAL-01', path.join(tmpRoot, 'VAL-01'));
      const { backupPath } = BackupManager.createBackup({
        storageLayout: layout,
        blockHeight: 10
      });

      // Tamper with backed-up sqlite file
      fs.appendFileSync(path.join(backupPath, 'pdschain.sqlite'), '-CORRUPTED-BITS');
      expect(() => BackupManager.verifyBackup(backupPath)).toThrow(/Checksum mismatch/);
    });

    it('2.4 should restore backup into a clean target storage directory', () => {
      const srcLayout = new StorageLayout('VAL-01', path.join(tmpRoot, 'VAL-01'));
      fs.writeFileSync(srcLayout.dbPath, 'ORIGINAL-CHAIN-DATA-HEIGHT-15');
      fs.writeFileSync(srcLayout.journalPath, 'ORIGINAL-JOURNAL-ENTRY\n');

      const { backupPath } = BackupManager.createBackup({
        storageLayout: srcLayout,
        blockHeight: 15,
        networkId: 'pdschain-testnet',
        chainId: 1729
      });

      const destLayout = new StorageLayout('VAL-01-RESTORED', path.join(tmpRoot, 'VAL-01-RESTORED'));
      destLayout.ensureDirectories();

      const res = BackupManager.restoreBackup(backupPath, destLayout, {
        expectedNetworkId: 'pdschain-testnet',
        expectedChainId: 1729
      });

      expect(res.restored).toBe(true);
      expect(fs.readFileSync(destLayout.dbPath, 'utf8')).toBe('ORIGINAL-CHAIN-DATA-HEIGHT-15');
      expect(fs.readFileSync(destLayout.journalPath, 'utf8')).toBe('ORIGINAL-JOURNAL-ENTRY\n');
    });

    it('2.5 should reject restore if networkId or chainId mismatches', () => {
      const srcLayout = new StorageLayout('VAL-01', path.join(tmpRoot, 'VAL-01'));
      const { backupPath } = BackupManager.createBackup({
        storageLayout: srcLayout,
        networkId: 'pdschain-mainnet',
        chainId: 1729
      });

      const destLayout = new StorageLayout('VAL-01-DIFF', path.join(tmpRoot, 'VAL-01-DIFF'));
      destLayout.ensureDirectories();

      expect(() => BackupManager.restoreBackup(backupPath, destLayout, { expectedNetworkId: 'pdschain-testnet' }))
        .toThrow(/Cannot restore backup from network/);
    });
  });
});

