/**
 * PDSChain Storage Layout & Volume Isolation Manager (Phase 11)
 * 
 * Enforces strict per-validator directory boundaries, path containment,
 * permissions, and single-instance PID locking to prevent storage corruption.
 */

const fs = require('fs');
const path = require('path');

class StorageLockError extends Error {
  constructor(message, code = 'STORAGE_LOCK_CONFLICT') {
    super(message);
    this.name = 'StorageLockError';
    this.code = code;
  }
}

class StorageLayout {
  /**
   * @param {string} validatorId - e.g. 'VAL-01'
   * @param {string} [baseDir] - Root data directory
   */
  constructor(validatorId, baseDir = null) {
    this.validatorId = String(validatorId || '').toUpperCase().trim();
    if (!this.validatorId) {
      throw new Error('validatorId is required for StorageLayout');
    }

    const defaultRoot = path.resolve(process.cwd(), 'database', 'validators', this.validatorId);
    this.dataDir = path.resolve(baseDir || defaultRoot);

    // Standardized isolated directory tree
    this.databaseDir = path.join(this.dataDir, 'database');
    this.journalDir = path.join(this.dataDir, 'journal');
    this.checkpointDir = path.join(this.dataDir, 'checkpoints');
    this.evmDir = path.join(this.dataDir, 'evm');
    this.logsDir = path.join(this.dataDir, 'logs');
    this.backupsDir = path.join(this.dataDir, 'backups');
    this.tmpDir = path.join(this.dataDir, 'tmp');

    // Default canonical file paths
    this.dbPath = path.join(this.dataDir, 'pdschain.sqlite');
    this.journalPath = path.join(this.dataDir, 'consensus_journal.jsonl');
    this.eventsPath = path.join(this.dataDir, 'events_journal.jsonl');
    this.checkpointPath = path.join(this.checkpointDir, 'checkpoint.json');
    this.identityPath = path.join(this.dataDir, 'identity.json');
    this.pidPath = path.join(this.dataDir, 'validator.pid');

    this.hasPidLock = false;
  }

  /**
   * Ensure all isolated directory paths exist
   */
  ensureDirectories() {
    const dirs = [
      this.dataDir,
      this.databaseDir,
      this.journalDir,
      this.checkpointDir,
      this.evmDir,
      this.logsDir,
      this.backupsDir,
      this.tmpDir
    ];

    for (const dir of dirs) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      }
    }

    return true;
  }

  /**
   * Verify that a given path is securely contained inside this validator's dataDir (anti-traversal)
   * @param {string} targetPath 
   * @returns {boolean}
   */
  isPathContained(targetPath) {
    const resolved = path.resolve(targetPath);
    const relative = path.relative(this.dataDir, resolved);
    return !relative.startsWith('..') && !path.isAbsolute(relative);
  }

  /**
   * Acquire single-instance PID lockfile
   * Throws StorageLockError if another running process holds the lock.
   */
  acquirePidLock() {
    this.ensureDirectories();

    if (fs.existsSync(this.pidPath)) {
      try {
        const existingPid = parseInt(fs.readFileSync(this.pidPath, 'utf8').trim(), 10);
        if (!isNaN(existingPid)) {
          if (this.hasPidLock && existingPid === process.pid) {
            return true;
          }

          // Check if process is alive
          let isAlive = false;
          try {
            // Signal 0 tests for existence without killing
            process.kill(existingPid, 0);
            isAlive = true;
          } catch (e) {
            isAlive = e.code === 'EPERM'; // Exists but no permission to signal
          }

          if (isAlive) {
            throw new StorageLockError(
              `Validator ${this.validatorId} storage is already locked by running process (PID ${existingPid}). Cannot start duplicate instance.`,
              'DUPLICATE_INSTANCE'
            );
          } else {
            // Stale PID lockfile, can be overwritten safely
            try { fs.unlinkSync(this.pidPath); } catch (e) {}
          }
        }
      } catch (err) {
        if (err instanceof StorageLockError) throw err;
      }
    }

    fs.writeFileSync(this.pidPath, String(process.pid), { encoding: 'utf8', mode: 0o600 });
    this.hasPidLock = true;
    return true;
  }

  /**
   * Release PID lockfile on shutdown
   */
  releasePidLock() {
    if (this.hasPidLock && fs.existsSync(this.pidPath)) {
      try {
        const storedPid = parseInt(fs.readFileSync(this.pidPath, 'utf8').trim(), 10);
        if (storedPid === process.pid) {
          fs.unlinkSync(this.pidPath);
        }
      } catch (e) {}
      this.hasPidLock = false;
    }
  }

  /**
   * Clean temporary directory
   */
  cleanTmp() {
    if (fs.existsSync(this.tmpDir)) {
      const files = fs.readdirSync(this.tmpDir);
      for (const file of files) {
        try {
          fs.unlinkSync(path.join(this.tmpDir, file));
        } catch (e) {}
      }
    }
  }
}

module.exports = {
  StorageLayout,
  StorageLockError
};
