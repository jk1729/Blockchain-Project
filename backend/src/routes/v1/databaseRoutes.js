/**
 * PDSChain Database Routes (Phase 18)
 * 
 * Production database health, diagnostics, migration, backup, and integrity APIs
 * protected by Phase 17 granular permissions.
 */

const express = require('express');
const router = express.Router();
const { defaultDatabaseManager } = require('../../database/DatabaseManager');
const { DatabaseIntegrityManager } = require('../../database/DatabaseIntegrityManager');
const { DatabaseBackupManager } = require('../../database/DatabaseBackupManager');
const { DatabaseMigrationManager } = require('../../database/DatabaseMigrationManager');
const { defaultDatabaseMetrics } = require('../../database/DatabaseMetrics');
const { authMiddleware } = require('../../middleware/authMiddleware');
const { requirePermission } = require('../../security/permissions/permissionMiddleware');
const BlockModel = require('../../models/Block');
const config = require('../../config/env');
const path = require('path');

const integrityManager = new DatabaseIntegrityManager();
const backupManager = new DatabaseBackupManager();
const migrationManager = new DatabaseMigrationManager();

/**
 * Public lightweight database health probe
 * GET /api/v1/database/health
 */
router.get('/health', async (req, res) => {
  const isHealthy = await defaultDatabaseManager.testConnection();
  const status = defaultDatabaseManager.getStatus();

  return res.status(isHealthy ? 200 : 503).json({
    success: isHealthy,
    data: {
      status: isHealthy ? 'UP' : 'DOWN',
      dialect: status.dialect,
      storageTarget: status.storageTarget,
      walMode: status.walMode,
      timestamp: new Date().toISOString()
    },
    meta: { finality: 'FINALIZED' },
    error: isHealthy ? null : { code: 'DATABASE_DOWN', message: 'Database connection failed' }
  });
});

/**
 * Detailed database diagnostic & pool status
 * GET /api/v1/database/status
 */
router.get('/status', authMiddleware, requirePermission('operator:read:node-status'), async (req, res) => {
  const status = defaultDatabaseManager.getStatus();
  return res.json({
    success: true,
    data: status,
    meta: { finality: 'FINALIZED' }
  });
});

/**
 * Migration registry and schema validation
 * GET /api/v1/database/schema
 */
router.get('/schema', authMiddleware, requirePermission('operator:read:node-status'), async (req, res) => {
  const applied = await migrationManager.getAppliedMigrations();
  return res.json({
    success: true,
    data: {
      appliedCount: applied.length,
      currentVersion: applied.length > 0 ? applied[applied.length - 1].version : 0,
      migrations: applied
    },
    meta: { finality: 'FINALIZED' }
  });
});

/**
 * Trigger schema migration execution
 * POST /api/v1/database/migrate
 */
router.post('/migrate', authMiddleware, requirePermission('operator:manage:configuration'), async (req, res) => {
  const { dryRun = false } = req.body || {};
  // For demo/API trigger, register initial standard migrations
  const available = [
    {
      version: 1,
      name: '001_initial_schema',
      up: async (seq) => await seq.sync({ alter: false }),
      checksum: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    }
  ];

  const result = await migrationManager.runAllPending(available, {
    dryRun,
    appliedBy: req.user ? req.user.id || req.user.username : 'OPERATOR'
  });

  return res.json({
    success: true,
    data: result,
    meta: { finality: 'FINALIZED' }
  });
});

/**
 * Create an atomic database backup
 * POST /api/v1/database/backup
 */
router.post('/backup', authMiddleware, requirePermission('operator:trigger:backup'), async (req, res) => {
  const { passphrase = null } = req.body || {};
  const dbPath = defaultDatabaseManager.config.DATABASE_STORAGE;
  const outputDir = path.resolve(process.cwd(), 'database', 'backups');

  const latestBlock = await BlockModel.findOne({ order: [['blockNumber', 'DESC']] });
  const blockHeight = latestBlock ? latestBlock.blockNumber : 0;
  const blockHash = latestBlock ? latestBlock.blockHash : '';

  const backupResult = backupManager.createBackup({
    dbPath,
    outputDir,
    validatorId: 'VAL-01',
    blockHeight,
    blockHash,
    chainId: 1729,
    networkId: 'pdschain-mainnet',
    encryptionPassphrase: passphrase
  });

  return res.status(201).json({
    success: true,
    data: {
      backupId: backupResult.backupId,
      backupPath: backupResult.backupPath,
      manifest: backupResult.manifest
    },
    meta: { finality: 'FINALIZED' }
  });
});

/**
 * Run full cryptographic ledger integrity verification
 * POST /api/v1/database/verify-integrity
 */
router.post('/verify-integrity', authMiddleware, requirePermission('operator:read:node-status'), async (req, res) => {
  const blocks = await BlockModel.findAll({ order: [['blockNumber', 'ASC']] });
  const chainPayloads = blocks.map(b => b.toJSON());

  const check = integrityManager.verifyLedgerIntegrity(chainPayloads);
  defaultDatabaseMetrics.recordIntegrityCheck(check.valid);

  return res.json({
    success: true,
    data: check,
    meta: { finality: 'FINALIZED' }
  });
});

/**
 * Export Prometheus metrics for database
 * GET /api/v1/database/metrics
 */
router.get('/metrics', (req, res) => {
  res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
  return res.send(defaultDatabaseMetrics.exportPrometheusMetrics());
});

module.exports = router;
