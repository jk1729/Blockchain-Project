const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Receipt = sequelize.define('Receipt', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true
  },
  transactionHash: {
    type: DataTypes.STRING(66),
    allowNull: false,
    unique: true
  },
  transactionId: {
    type: DataTypes.STRING(64),
    allowNull: false
  },
  blockNumber: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  blockHash: {
    type: DataTypes.STRING(66),
    allowNull: false
  },
  transactionIndex: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0
  },
  contractAddress: {
    type: DataTypes.STRING(42),
    allowNull: true
  },
  status: {
    type: DataTypes.STRING(20),
    allowNull: false,
    defaultValue: 'SUCCESS' // 'SUCCESS', 'REVERTED', 'FAILED'
  },
  gasUsed: {
    type: DataTypes.BIGINT,
    allowNull: false,
    defaultValue: 21000
  },
  cumulativeGasUsed: {
    type: DataTypes.BIGINT,
    allowNull: false,
    defaultValue: 21000
  },
  logs: {
    type: DataTypes.JSON,
    allowNull: false,
    defaultValue: []
  },
  logsBloom: {
    type: DataTypes.STRING(514),
    allowNull: true
  },
  receiptHash: {
    type: DataTypes.STRING(66),
    allowNull: false
  },
  revertReason: {
    type: DataTypes.TEXT,
    allowNull: true
  }
}, {
  tableName: 'receipts',
  timestamps: true,
  indexes: [
    { fields: ['transactionHash'], unique: true },
    { fields: ['blockNumber'] },
    { fields: ['contractAddress'] }
  ],
  hooks: {
    beforeUpdate: (instance) => {
      throw new Error(`Receipt for transaction ${instance.transactionHash} is immutable and cannot be updated.`);
    },
    beforeDestroy: (instance) => {
      throw new Error(`Receipt for transaction ${instance.transactionHash} is immutable and cannot be deleted.`);
    }
  }
});

module.exports = Receipt;

