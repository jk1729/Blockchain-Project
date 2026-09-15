const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Block = sequelize.define('Block', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true
  },
  version: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 1
  },
  blockNumber: {
    type: DataTypes.INTEGER,
    allowNull: false,
    unique: true
  },
  blockHash: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true
  },
  previousHash: {
    type: DataTypes.STRING,
    allowNull: false
  },
  timestamp: {
    type: DataTypes.STRING,
    allowNull: false
  },
  transactions: {
    type: DataTypes.JSON,
    allowNull: false,
    defaultValue: []
  },
  txCount: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0
  },
  nonce: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0
  },
  merkleRoot: {
    type: DataTypes.STRING,
    allowNull: true
  },
  stateRoot: {
    type: DataTypes.STRING,
    allowNull: true
  },
  proposerId: {
    type: DataTypes.STRING,
    allowNull: true,
    defaultValue: 'VAL-01'
  },
  proposerAddress: {
    type: DataTypes.STRING,
    allowNull: true
  },
  proposerSignature: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  proposalId: {
    type: DataTypes.STRING,
    allowNull: true
  },
  round: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0
  },
  consensusStatus: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: 'FINALIZED'
  },
  consensusCertificate: {
    type: DataTypes.JSON,
    allowNull: true
  },
  validatorSignatures: {
    type: DataTypes.JSON,
    allowNull: true,
    defaultValue: []
  }
}, {
  tableName: 'blocks',
  timestamps: true
});

module.exports = Block;
