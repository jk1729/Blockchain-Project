/**
 * PDSChain Production Database Backup & Disaster Recovery Manager (Phase 18)
 * 
 * Supports:
 * - Atomic database snapshots with SHA-256 integrity verification
 * - AES-256-GCM backup encryption with detached manifest
 * - Cross-chain and network ID mismatch guards
 * - Staged restoration with rollback protection
 * - Strict secret exclusion (zero private keys or keystore passphrases)
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const logger = require('../utils/logger');

class DatabaseBackupError extends Error {
  constructor(message, code = 'BACKUP_ERROR', details = {}) {
    super(message);
    this.name = 'DatabaseBackupError';
    this.code = code;
    this.details = details;
  }
}

class DatabaseBackupManager {
  constructor(options = {}) {
    this.logger = options.logger || logger;
  }

  /**
   * Compute SHA-256 hash of a file
   */
  static computeFileHash(filePath) {
    if (!fs.existsSync(filePath)) return null;
    const content = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  /**
   * Create an atomic encrypted or verified backup
   * @param {object} params
   * @param {string} params.dbPath - Path to database file
   * @param {string} params.outputDir - Target backup destination
   * @param {string} params.validatorId - Node validator ID
   * @param {number} [params.blockHeight=0]
   * @param {string} [params.blockHash='']
   * @param {number} [params.chainId=1729]
   * @param {string} [params.networkId='pdschain-mainnet']
   * @param {string} [params.encryptionPassphrase=null] - Optional AES-256-GCM encryption
   */
  createBackup({
    dbPath,
    outputDir,
    validatorId,
    blockHeight = 0,
    blockHash = '',
    chainId = 1729,
    networkId = 'pdschain-mainnet',
    encryptionPassphrase = null
  }) {
    if (!dbPath || !fs.existsSync(dbPath)) {
      throw new DatabaseBackupError(`Database file not found: ${dbPath}`, 'DB_FILE_NOT_FOUND');
    }
    if (!outputDir) {
      throw new DatabaseBackupError('Output directory is required', 'MISSING_OUTPUT_DIR');
    }

    const timestamp = Date.now();
    const backupId = `backup-${validatorId}-H${blockHeight}-${timestamp}`;
    const backupFolder = path.join(outputDir, backupId);
    fs.mkdirSync(backupFolder, { recursive: true });

    const rawHash = DatabaseBackupManager.computeFileHash(dbPath);
    let targetFileName = 'pdschain.sqlite';
    let targetFilePath = path.join(backupFolder, targetFileName);
    let isEncrypted = false;
    let authTag = null;
    let iv = null;

    if (encryptionPassphrase) {
      isEncrypted = true;
      targetFileName = 'pdschain.sqlite.enc';
      targetFilePath = path.join(backupFolder, targetFileName);

      const dbBytes = fs.readFileSync(dbPath);
      const salt = crypto.randomBytes(16);
      const key = crypto.pbkdf2Sync(encryptionPassphrase, salt, 100000, 32, 'sha256');
      const cipherIv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', key, cipherIv);

      const encrypted = Buffer.concat([cipher.update(dbBytes), cipher.final()]);
      authTag = cipher.getAuthTag().toString('hex');
      iv = cipherIv.toString('hex');

      // Store salt + encrypted bytes
      fs.writeFileSync(targetFilePath, Buffer.concat([salt, encrypted]));
    } else {
      fs.copyFileSync(dbPath, targetFilePath);
    }

    const manifest = {
      backupId,
      validatorId,
      blockHeight,
      blockHash,
      chainId,
      networkId,
      timestamp,
      createdAt: new Date(timestamp).toISOString(),
      isEncrypted,
      authTag,
      iv,
      files: [
        {
          name: targetFileName,
          rawHash,
          sizeBytes: fs.statSync(targetFilePath).size
        }
      ]
    };

    const manifestPath = path.join(backupFolder, 'manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    this.logger.info(`[DatabaseBackupManager] Backup ${backupId} successfully generated.`);
    return {
      backupId,
      backupPath: backupFolder,
      manifest
    };
  }

  /**
   * Verify backup integrity and manifest compliance
   * @param {string} backupDir 
   * @returns {object} Manifest
   */
  verifyBackup(backupDir) {
    const manifestPath = path.join(backupDir, 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
      throw new DatabaseBackupError('Backup manifest missing', 'MANIFEST_NOT_FOUND');
    }

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

    for (const file of manifest.files) {
      const filePath = path.join(backupDir, file.name);
      if (!fs.existsSync(filePath)) {
        throw new DatabaseBackupError(`Backup file missing: ${file.name}`, 'FILE_MISSING');
      }

      if (!manifest.isEncrypted) {
        const hash = DatabaseBackupManager.computeFileHash(filePath);
        if (hash !== file.rawHash) {
          throw new DatabaseBackupError(`Checksum mismatch for file ${file.name}`, 'CORRUPT_BACKUP');
        }
      }
    }

    return manifest;
  }

  /**
   * Restore a backup into target directory with network and chain guards
   * @param {object} params
   * @param {string} params.backupDir
   * @param {string} params.targetDir
   * @param {number} [params.expectedChainId=1729]
   * @param {string} [params.expectedNetworkId='pdschain-mainnet']
   * @param {string} [params.expectedValidatorId=null]
   * @param {string} [params.encryptionPassphrase=null]
   */
  restoreBackup({
    backupDir,
    targetDir,
    expectedChainId = 1729,
    expectedNetworkId = 'pdschain-mainnet',
    expectedValidatorId = null,
    encryptionPassphrase = null
  }) {
    const manifest = this.verifyBackup(backupDir);

    // 1. Guard against wrong chain or network restore
    if (manifest.chainId !== expectedChainId) {
      throw new DatabaseBackupError(
        `Chain ID mismatch: backup is ${manifest.chainId}, expected ${expectedChainId}`,
        'CHAIN_ID_MISMATCH'
      );
    }

    if (manifest.networkId !== expectedNetworkId) {
      throw new DatabaseBackupError(
        `Network ID mismatch: backup is ${manifest.networkId}, expected ${expectedNetworkId}`,
        'NETWORK_ID_MISMATCH'
      );
    }

    if (expectedValidatorId && manifest.validatorId !== expectedValidatorId) {
      throw new DatabaseBackupError(
        `Validator ID mismatch: backup is for ${manifest.validatorId}, expected ${expectedValidatorId}`,
        'VALIDATOR_ID_MISMATCH'
      );
    }

    // 2. Stage files into isolated restore folder
    const stagingDir = path.join(targetDir, 'restored');
    fs.mkdirSync(stagingDir, { recursive: true });

    for (const file of manifest.files) {
      const srcPath = path.join(backupDir, file.name);
      const destPath = path.join(stagingDir, 'pdschain.sqlite');

      if (manifest.isEncrypted) {
        if (!encryptionPassphrase) {
          throw new DatabaseBackupError('Passphrase required to restore encrypted backup', 'PASSPHRASE_REQUIRED');
        }
        const fileBytes = fs.readFileSync(srcPath);
        const salt = fileBytes.subarray(0, 16);
        const cipherBytes = fileBytes.subarray(16);
        const key = crypto.pbkdf2Sync(encryptionPassphrase, salt, 100000, 32, 'sha256');

        const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(manifest.iv, 'hex'));
        decipher.setAuthTag(Buffer.from(manifest.authTag, 'hex'));

        const decrypted = Buffer.concat([decipher.update(cipherBytes), decipher.final()]);
        fs.writeFileSync(destPath, decrypted);

        // Verify decrypted hash matches original rawHash
        const decHash = DatabaseBackupManager.computeFileHash(destPath);
        if (decHash !== file.rawHash) {
          throw new DatabaseBackupError('Decrypted database hash does not match original manifest hash', 'CORRUPT_BACKUP');
        }
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }

    this.logger.info(`[DatabaseBackupManager] Backup ${manifest.backupId} successfully restored to ${stagingDir}.`);
    return {
      success: true,
      manifest,
      restoredDbPath: path.join(stagingDir, 'pdschain.sqlite')
    };
  }
}

module.exports = {
  DatabaseBackupManager,
  DatabaseBackupError
};

