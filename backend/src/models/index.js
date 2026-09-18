const { sequelize, testConnection } = require('../config/database');
const User = require('./User');
const Beneficiary = require('./Beneficiary');
const Shop = require('./Shop');
const Warehouse = require('./Warehouse');
const Commodity = require('./Commodity');
const Inventory = require('./Inventory');
const Transaction = require('./Transaction');
const Block = require('./Block');
const Validator = require('./Validator');
const StockTransfer = require('./StockTransfer');
const Receipt = require('./Receipt');
const EventRecord = require('./EventRecord');
const CheckpointRecord = require('./CheckpointRecord');
const SchemaMigration = require('./SchemaMigration');
const DatabaseAuditRecord = require('./DatabaseAuditRecord');

const db = {
  sequelize,
  testConnection,
  User,
  Beneficiary,
  Shop,
  Warehouse,
  Commodity,
  Inventory,
  Transaction,
  Block,
  Validator,
  StockTransfer,
  Receipt,
  EventRecord,
  CheckpointRecord,
  SchemaMigration,
  DatabaseAuditRecord
};

module.exports = db;

