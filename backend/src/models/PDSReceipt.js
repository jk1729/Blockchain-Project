const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const PDSReceipt = sequelize.define('PDSReceipt', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true
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
  }
}, {
  tableName: 'pds_receipts',
  timestamps: true,
  indexes: [
    { fields: ['transactionId'], unique: true },
    { fields: ['blockNumber'] }
  ],
  hooks: {
    beforeUpdate: (instance) => {
      throw new Error(`PDSReceipt for transaction ${instance.transactionId} is immutable and cannot be updated.`);
    },
    beforeDestroy: (instance) => {
      throw new Error(`PDSReceipt for transaction ${instance.transactionId} is immutable and cannot be deleted.`);
    }
  }
});

module.exports = PDSReceipt;

