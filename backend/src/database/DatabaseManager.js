/**
 * PDSChain Production Database Manager (Phase 18)
 * 
 * Manages database initialization, SQLite WAL mode, PostgreSQL pooling,
 * connection health, and diagnostics.
 */

const fs = require('fs');
const path = require('path');
const { Sequelize } = require('sequelize');
const { DatabasePool } = require('./DatabasePool');
const config = require('../config/env');
const logger = require('../utils/logger');

class DatabaseManager {
  constructor(options = {}) {
    this.config = options.config || config;
    this.logger = options.logger || logger;
    this.pool = new DatabasePool({
      maxConnections: parseInt(process.env.DB_POOL_MAX, 10) || 20,
      minConnections: parseInt(process.env.DB_POOL_MIN, 10) || 2,
      acquireTimeoutMs: parseInt(process.env.DB_ACQUIRE_TIMEOUT_MS, 10) || 10000,
      idleTimeoutMs: parseInt(process.env.DB_IDLE_TIMEOUT_MS, 10) || 30000
    });

    this.sequelize = this._initializeSequelize();
    this.isInitialized = false;
    this.dialect = this.sequelize.getDialect();
  }

  _initializeSequelize() {
    if (this.config.DATABASE_URL && this.config.DATABASE_URL.trim() !== '') {
      // PostgreSQL Production Connection
      return new Sequelize(this.config.DATABASE_URL, {
        dialect: 'postgres',
        logging: this.config.NODE_ENV === 'test' ? false : (msg) => this.logger.debug(msg),
        pool: {
          max: this.pool.maxConnections,
          min: this.pool.minConnections,
          acquire: this.pool.acquireTimeoutMs,
          idle: this.pool.idleTimeoutMs
        },
        dialectOptions: this.config.NODE_ENV === 'production' ? {
          ssl: {
            require: true,
            rejectUnauthorized: false
          },
          statement_timeout: 10000,
          idle_in_transaction_session_timeout: 5000
        } : {}
      });
    }

    // SQLite Fallback / Validator-Local Storage
    const storagePath = this.config.DATABASE_STORAGE;
    const storageDir = path.dirname(storagePath);
    if (!fs.existsSync(storageDir)) {
      fs.mkdirSync(storageDir, { recursive: true });
    }

    return new Sequelize({
      dialect: 'sqlite',
      storage: storagePath,
      logging: false,
      pool: {
        max: this.pool.maxConnections,
        min: 1,
        acquire: this.pool.acquireTimeoutMs,
        idle: this.pool.idleTimeoutMs
      }
    });
  }

  /**
   * Initialize database pragmas and establish verified connection
   */
  async init() {
    try {
      await this.pool.acquire();
      await this.sequelize.authenticate();

      // Configure SQLite Write-Ahead Logging (WAL) and durability pragmas
      if (this.dialect === 'sqlite') {
        await this.sequelize.query('PRAGMA journal_mode = WAL;');
        await this.sequelize.query('PRAGMA synchronous = NORMAL;');
        await this.sequelize.query('PRAGMA busy_timeout = 5000;');
        await this.sequelize.query('PRAGMA foreign_keys = ON;');
        this.logger.info('[DatabaseManager] SQLite WAL mode and durability pragmas enabled.');

        // Ensure newly added schema columns exist in blocks
        try {
          const queryInterface = this.sequelize.getQueryInterface();
          const blockCols = await queryInterface.describeTable('blocks');
          if (!blockCols.receiptsRoot) {
            await queryInterface.addColumn('blocks', 'receiptsRoot', {
              type: require('sequelize').DataTypes.STRING,
              allowNull: true
            });
          }
        } catch (e) {
          // Table may not exist yet
        }
        try {
          const queryInterface = this.sequelize.getQueryInterface();
          const transferCols = await queryInterface.describeTable('stock_transfers');
          const transferFields = {
            transactionId: { type: require('sequelize').DataTypes.STRING, allowNull: true },
            blockNumber: { type: require('sequelize').DataTypes.INTEGER, allowNull: true },
            blockHash: { type: require('sequelize').DataTypes.STRING, allowNull: true },
            transactionHash: { type: require('sequelize').DataTypes.STRING, allowNull: true },
            idempotencyKey: { type: require('sequelize').DataTypes.STRING, allowNull: true }
          };
          for (const [name, definition] of Object.entries(transferFields)) {
            if (!transferCols[name]) await queryInterface.addColumn('stock_transfers', name, definition);
          }
          try {
            await queryInterface.addIndex('stock_transfers', ['warehouseId', 'idempotencyKey'], {
              unique: true,
              name: 'stock_transfers_warehouse_idempotency_unique'
            });
          } catch (indexError) {
            // Index may already exist or the legacy table may not have the new column yet.
          }
        } catch (e) {
          // Table may not exist until the initial schema sync
        }
        try {
          const queryInterface = this.sequelize.getQueryInterface();
          try {
            await queryInterface.describeTable('transfer_event_outbox');
          } catch (tableError) {
            const { DataTypes } = require('sequelize');
            await queryInterface.createTable('transfer_event_outbox', {
              id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
              transferId: { type: DataTypes.STRING, allowNull: false },
              eventType: { type: DataTypes.STRING, allowNull: false },
              payload: { type: DataTypes.JSON, allowNull: false },
              attempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
              lastError: { type: DataTypes.TEXT, allowNull: true },
              publishedAt: { type: DataTypes.DATE, allowNull: true },
              createdAt: { type: DataTypes.DATE, allowNull: false },
              updatedAt: { type: DataTypes.DATE, allowNull: false }
            });
            await queryInterface.addIndex('transfer_event_outbox', ['transferId', 'eventType'], { unique: true });
            await queryInterface.addIndex('transfer_event_outbox', ['publishedAt']);
          }
        } catch (e) {
          this.logger.warn(`[DatabaseManager] Could not ensure transfer event outbox schema: ${e.message}`);
        }
      }

      this.pool.recordSuccess();
      this.isInitialized = true;
      return true;
    } catch (err) {
      this.pool.recordFailure(err);
      this.logger.error(`[DatabaseManager] Database initialization failed: ${err.message}`);
      throw err;
    } finally {
      this.pool.release();
    }
  }

  /**
   * Health probe for database connectivity
   */
  async testConnection() {
    try {
      await this.pool.acquire();
      await this.sequelize.authenticate();
      this.pool.recordSuccess();
      return true;
    } catch (err) {
      this.pool.recordFailure(err);
      this.logger.error(`[DatabaseManager] Health probe failed: ${err.message}`);
      return false;
    } finally {
      this.pool.release();
    }
  }

  /**
   * Diagnostic summary (zero credentials exposed)
   */
  getStatus() {
    let storageTarget = 'memory';
    if (this.dialect === 'sqlite') {
      storageTarget = path.basename(this.config.DATABASE_STORAGE);
    } else if (this.dialect === 'postgres') {
      storageTarget = 'postgres-cluster';
    }

    return {
      status: this.isInitialized ? 'HEALTHY' : 'UNINITIALIZED',
      dialect: this.dialect,
      storageTarget,
      pool: this.pool.getStatus(),
      walMode: this.dialect === 'sqlite',
      timestamp: new Date().toISOString()
    };
  }
}

// Default singleton instance
const defaultDatabaseManager = new DatabaseManager();

module.exports = {
  DatabaseManager,
  defaultDatabaseManager
};
