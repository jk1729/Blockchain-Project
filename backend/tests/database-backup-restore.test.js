/**
 * Phase 18: Database Backup, Encryption & Staged Restore Test Suite
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { DatabaseBackupManager, DatabaseBackupError } = require('../src/database/DatabaseBackupManager');

describe('Phase 18: Database Backup, Encryption & Staged Restore', () => {
  let backupManager;
  let tempDir;
  let dummyDbPath;

  beforeEach(() => {
    backupManager = new DatabaseBackupManager();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pds-db-backup-'));
    dummyDbPath = path.join(tempDir, 'source.sqlite');
    fs.writeFileSync(dummyDbPath, 'SQLite format 3\0-mock-database-content-1729');
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (e) {
      // Ignore cleanup error
    }
  });

  describe('1. Atomic Plaintext Backup Creation & Verification', () => {
    test('should create a valid backup with manifest and matching checksum', () => {
      const outputDir = path.join(tempDir, 'backups');
      const res = backupManager.createBackup({
        dbPath: dummyDbPath,
        outputDir,
        validatorId: 'VAL-01',
        blockHeight: 100,
        blockHash: '0xhash100',
        chainId: 1729,
        networkId: 'pdschain-mainnet'
      });

      expect(res.backupId).toBeDefined();
      expect(fs.existsSync(res.backupPath)).toBe(true);

      const verifiedManifest = backupManager.verifyBackup(res.backupPath);
      expect(verifiedManifest.chainId).toBe(1729);
      expect(verifiedManifest.blockHeight).toBe(100);
      expect(verifiedManifest.isEncrypted).toBe(false);
      expect(verifiedManifest.files[0].rawHash).toBeDefined();
    });

    test('verifyBackup should catch tampered file in backup directory', () => {
      const outputDir = path.join(tempDir, 'backups');
      const res = backupManager.createBackup({
        dbPath: dummyDbPath,
        outputDir,
        validatorId: 'VAL-01'
      });

      // Tamper with backed-up database file
      const backupDbPath = path.join(res.backupPath, 'pdschain.sqlite');
      fs.appendFileSync(backupDbPath, 'tampered-extra-bytes');

      expect(() => {
        backupManager.verifyBackup(res.backupPath);
      }).toThrow('Checksum mismatch');
    });
  });

  describe('2. Encrypted Backup (AES-256-GCM)', () => {
    test('should create AES-256-GCM encrypted backup with authTag and iv', () => {
      const outputDir = path.join(tempDir, 'backups');
      const passphrase = 'test-secret-passphrase-2026';

      const res = backupManager.createBackup({
        dbPath: dummyDbPath,
        outputDir,
        validatorId: 'VAL-01',
        encryptionPassphrase: passphrase
      });

      const manifest = backupManager.verifyBackup(res.backupPath);
      expect(manifest.isEncrypted).toBe(true);
      expect(manifest.authTag).toBeDefined();
      expect(manifest.iv).toBeDefined();

      const encFile = path.join(res.backupPath, 'pdschain.sqlite.enc');
      expect(fs.existsSync(encFile)).toBe(true);

      // Raw content in file must not equal plaintext source
      const rawEncBytes = fs.readFileSync(encFile);
      expect(rawEncBytes.includes(Buffer.from('SQLite format 3'))).toBe(false);
    });
  });

  describe('3. Staged Restoration & Security Guards', () => {
    test('should decrypt and restore encrypted backup into isolated staging folder', () => {
      const outputDir = path.join(tempDir, 'backups');
      const targetDir = path.join(tempDir, 'target');
      const passphrase = 'test-secret-passphrase-2026';

      const res = backupManager.createBackup({
        dbPath: dummyDbPath,
        outputDir,
        validatorId: 'VAL-01',
        encryptionPassphrase: passphrase
      });

      const restoreRes = backupManager.restoreBackup({
        backupDir: res.backupPath,
        targetDir,
        expectedChainId: 1729,
        expectedNetworkId: 'pdschain-mainnet',
        encryptionPassphrase: passphrase
      });

      expect(restoreRes.success).toBe(true);
      expect(fs.existsSync(restoreRes.restoredDbPath)).toBe(true);

      // Decrypted content must match original source exactly
      const restoredContent = fs.readFileSync(restoreRes.restoredDbPath, 'utf8');
      expect(restoredContent).toBe('SQLite format 3\0-mock-database-content-1729');
    });

    test('restore should reject backup with wrong chainId or networkId', () => {
      const outputDir = path.join(tempDir, 'backups');
      const targetDir = path.join(tempDir, 'target');

      const res = backupManager.createBackup({
        dbPath: dummyDbPath,
        outputDir,
        validatorId: 'VAL-01',
        chainId: 1729,
        networkId: 'pdschain-mainnet'
      });

      // Attempt restore into testnet
      expect(() => {
        backupManager.restoreBackup({
          backupDir: res.backupPath,
          targetDir,
          expectedChainId: 9999, // Mismatch
          expectedNetworkId: 'pdschain-mainnet'
        });
      }).toThrow('Chain ID mismatch');

      expect(() => {
        backupManager.restoreBackup({
          backupDir: res.backupPath,
          targetDir,
          expectedChainId: 1729,
          expectedNetworkId: 'pdschain-testnet' // Mismatch
        });
      }).toThrow('Network ID mismatch');
    });
  });
});

