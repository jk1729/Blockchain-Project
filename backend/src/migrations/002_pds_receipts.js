/**
 * Migration: 002_pds_receipts.js
 * Non-destructive, idempotent creation of the dedicated `pds_receipts` table
 * and its required indexes (`transactionId` unique index, `blockNumber` index).
 */

const { DataTypes } = require('sequelize');
const crypto = require('crypto');
const { sequelize } = require('../config/database');
const logger = require('../utils/logger');

const MIGRATION_VERSION = 2;
const MIGRATION_NAME = '002_pds_receipts';
const MIGRATION_CHECKSUM = crypto
  .createHash('sha256')
  .update(`${MIGRATION_VERSION}:${MIGRATION_NAME}:create_table_pds_receipts_v1`)
  .digest('hex');

const REQUIRED_COLUMNS = [
  'id',
  'transactionId',
  'receiptNumber',
  'blockNumber',
  'blockHash',
  'receiptData',
  'createdAt',
  'updatedAt'
];

async function tableExists(queryInterface, tableName, transaction = undefined) {
  const tables = await queryInterface.showAllTables(transaction ? { transaction } : {});
  return tables.some((t) => {
    const name = typeof t === 'string' ? t : (t && (t.tableName || t.name));
    return String(name).toLowerCase() === String(tableName).toLowerCase();
  });
}

async function verifyTableColumns(queryInterface, tableName, transaction = undefined) {
  const desc = await queryInterface.describeTable(tableName, transaction ? { transaction } : {});
  for (const col of REQUIRED_COLUMNS) {
    if (!desc[col]) {
      throw new Error(`Existing table '${tableName}' is missing required column '${col}'.`);
    }
  }
  return desc;
}

async function ensureIndexes(queryInterface, transaction = undefined) {
  const txOpts = transaction ? { transaction } : {};
  let existingIndexes = [];
  try {
    existingIndexes = await queryInterface.showIndex('pds_receipts', txOpts);
  } catch (_err) {
    existingIndexes = [];
  }

  const hasTxIdUniqueIndex = existingIndexes.some(
    (idx) =>
      idx.name === 'pds_receipts_transaction_id_unique' ||
      (idx.unique === true &&
        Array.isArray(idx.fields) &&
        idx.fields.length === 1 &&
        (idx.fields[0].attribute === 'transactionId' || idx.fields[0].name === 'transactionId'))
  );

  if (!hasTxIdUniqueIndex) {
    await queryInterface.addIndex('pds_receipts', ['transactionId'], {
      name: 'pds_receipts_transaction_id_unique',
      unique: true,
      ...txOpts
    });
  }

  const hasBlockNumberIndex = existingIndexes.some(
    (idx) =>
      idx.name === 'pds_receipts_block_number_idx' ||
      (Array.isArray(idx.fields) &&
        idx.fields.length === 1 &&
        (idx.fields[0].attribute === 'blockNumber' || idx.fields[0].name === 'blockNumber'))
  );

  if (!hasBlockNumberIndex) {
    await queryInterface.addIndex('pds_receipts', ['blockNumber'], {
      name: 'pds_receipts_block_number_idx',
      unique: false,
      ...txOpts
    });
  }
}

async function up(seq = sequelize, options = {}) {
  const activeSequelize = seq || sequelize;
  const queryInterface = activeSequelize.getQueryInterface();
  const transaction = options && options.transaction ? options.transaction : undefined;
  const txOpts = transaction ? { transaction } : {};

  logger.info('Running database migration: 002_pds_receipts...');

  const exists = await tableExists(queryInterface, 'pds_receipts', transaction);
  if (!exists) {
    await queryInterface.createTable(
      'pds_receipts',
      {
        id: {
          type: DataTypes.INTEGER,
          primaryKey: true,
          autoIncrement: true,
          allowNull: false
        },
        transactionId: {
          type: DataTypes.STRING(64),
          allowNull: false,
          unique: true
        },
        receiptNumber: {
          type: DataTypes.STRING(64),
          allowNull: true
        },
        blockNumber: {
          type: DataTypes.INTEGER,
          allowNull: false
        },
        blockHash: {
          type: DataTypes.STRING(66),
          allowNull: false
        },
        receiptData: {
          type: DataTypes.JSON,
          allowNull: false
        },
        createdAt: {
          type: DataTypes.DATE,
          allowNull: false
        },
        updatedAt: {
          type: DataTypes.DATE,
          allowNull: false
        }
      },
      txOpts
    );
  } else {
    await verifyTableColumns(queryInterface, 'pds_receipts', transaction);
  }

  await ensureIndexes(queryInterface, transaction);

  logger.info('Migration 002_pds_receipts applied successfully.');
}

async function down(seq = sequelize, options = {}) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Rollback of 002_pds_receipts is forbidden in production environments.');
  }

  const activeSequelize = seq || sequelize;
  const queryInterface = activeSequelize.getQueryInterface();
  const transaction = options && options.transaction ? options.transaction : undefined;
  const txOpts = transaction ? { transaction } : {};

  logger.info('Rolling back database migration: 002_pds_receipts...');

  const exists = await tableExists(queryInterface, 'pds_receipts', transaction);
  if (exists) {
    await queryInterface.dropTable('pds_receipts', txOpts);
  }

  logger.info('Migration 002_pds_receipts rolled back (only pds_receipts dropped).');
}

module.exports = {
  version: MIGRATION_VERSION,
  name: MIGRATION_NAME,
  checksum: MIGRATION_CHECKSUM,
  useTransaction: true,
  up,
  down
};
