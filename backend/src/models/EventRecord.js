const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const EventRecord = sequelize.define('EventRecord', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true
  },
  eventId: {
    type: DataTypes.STRING(64),
    allowNull: false,
    unique: true
  },
  eventType: {
    type: DataTypes.STRING(64),
    allowNull: false
  },
  category: {
    type: DataTypes.STRING(32),
    allowNull: false
  },
  severity: {
    type: DataTypes.STRING(16),
    allowNull: false,
    defaultValue: 'INFO'
  },
  finalityStatus: {
    type: DataTypes.STRING(20),
    allowNull: false,
    defaultValue: 'FINALIZED'
  },
  blockNumber: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  blockHash: {
    type: DataTypes.STRING(66),
    allowNull: true
  },
  transactionHash: {
    type: DataTypes.STRING(66),
    allowNull: true
  },
  deduplicationKey: {
    type: DataTypes.STRING(128),
    allowNull: false,
    unique: true
  },
  payload: {
    type: DataTypes.JSON,
    allowNull: false,
    defaultValue: {}
  },
  timestamp: {
    type: DataTypes.STRING(32),
    allowNull: false
  }
}, {
  tableName: 'event_records',
  timestamps: true,
  indexes: [
    { fields: ['eventType'] },
    { fields: ['category'] },
    { fields: ['blockNumber'] },
    { fields: ['transactionHash'] },
    { fields: ['deduplicationKey'], unique: true }
  ],
  hooks: {
    beforeUpdate: (instance) => {
      if (instance.finalityStatus === 'FINALIZED') {
        throw new Error(`Finalized event record ${instance.eventId} is immutable.`);
      }
    },
    beforeDestroy: (instance) => {
      if (instance.finalityStatus === 'FINALIZED') {
        throw new Error(`Finalized event record ${instance.eventId} cannot be deleted.`);
      }
    }
  }
});

module.exports = EventRecord;

