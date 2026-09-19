const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const TransferEventOutbox = sequelize.define('TransferEventOutbox', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true
  },
  transferId: {
    type: DataTypes.STRING,
    allowNull: false
  },
  eventType: {
    type: DataTypes.STRING,
    allowNull: false
  },
  payload: {
    type: DataTypes.JSON,
    allowNull: false
  },
  attempts: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0
  },
  lastError: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  publishedAt: {
    type: DataTypes.DATE,
    allowNull: true
  }
}, {
  tableName: 'transfer_event_outbox',
  timestamps: true,
  indexes: [
    { fields: ['transferId', 'eventType'], unique: true },
    { fields: ['publishedAt'] }
  ]
});

module.exports = TransferEventOutbox;
