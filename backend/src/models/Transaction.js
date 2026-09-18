const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Transaction = sequelize.define('Transaction', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true
  },
  transactionId: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true
  },
  beneficiaryId: {
    type: DataTypes.STRING,
    allowNull: false
  },
  beneficiaryName: {
    type: DataTypes.STRING,
    allowNull: true
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
  blockNumber: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  blockHash: {
    type: DataTypes.STRING,
    allowNull: true
  },
  hash: {
    type: DataTypes.STRING,
    allowNull: true
  },
  fbaValidators: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 12
  },
  fbaConsensus: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true
  },
  status: {
    type: DataTypes.ENUM('Pending', 'Verified', 'Rejected'),
    allowNull: false,
    defaultValue: 'Pending'
  },
  timestamp: {
    type: DataTypes.STRING,
    allowNull: false
  },
  remarks: {
    type: DataTypes.STRING,
    allowNull: true
  }
}, {
  tableName: 'transactions',
  timestamps: true,
  indexes: [
    { fields: ['transactionId'], unique: true },
    { fields: ['hash'] },
    { fields: ['blockNumber'] },
    { fields: ['status'] },
    { fields: ['beneficiaryId', 'createdAt'] },
    { fields: ['shopId', 'createdAt'] }
  ],
  hooks: {
    beforeUpdate: (instance) => {
      // Allow transitioning from Pending to Verified or Rejected, but never allow altering a Verified transaction
      if (instance._previousDataValues && instance._previousDataValues.status === 'Verified') {
        throw new Error(`Transaction ${instance.transactionId} is already Verified and cannot be mutated.`);
      }
    },
    beforeDestroy: (instance) => {
      if (instance.status === 'Verified') {
        throw new Error(`Verified transaction ${instance.transactionId} is immutable and cannot be deleted.`);
      }
    }
  }
});

module.exports = Transaction;

