const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const StockTransfer = sequelize.define('StockTransfer', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true
  },
  transferId: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true
  },
  warehouseId: {
    type: DataTypes.STRING,
    allowNull: false
  },
  shopId: {
    type: DataTypes.STRING,
    allowNull: false
  },
  commodity: {
    type: DataTypes.STRING,
    allowNull: false
  },
  quantity: {
    type: DataTypes.FLOAT,
    allowNull: false
  },
  unit: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: 'KG'
  },
  status: {
    type: DataTypes.ENUM('Pending', 'Completed', 'Cancelled'),
    allowNull: false,
    defaultValue: 'Completed'
  },
  transactionId: {
    type: DataTypes.STRING,
    allowNull: true
  },
  blockNumber: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  blockHash: {
    type: DataTypes.STRING,
    allowNull: true
  },
  transactionHash: {
    type: DataTypes.STRING,
    allowNull: true
  },
  idempotencyKey: {
    type: DataTypes.STRING,
    allowNull: true
  },
  timestamp: {
    type: DataTypes.STRING,
    allowNull: false
  }
}, {
  tableName: 'stock_transfers',
  timestamps: true,
  indexes: [
    { fields: ['warehouseId', 'idempotencyKey'], unique: true }
  ]
});

module.exports = StockTransfer;
