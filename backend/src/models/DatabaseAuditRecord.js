const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const DatabaseAuditRecord = sequelize.define('DatabaseAuditRecord', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true
  },
  sequence: {
    type: DataTypes.BIGINT,
    allowNull: false,
    unique: true
  },
  eventType: {
    type: DataTypes.STRING(64),
    allowNull: false
  },
  actorId: {
    type: DataTypes.STRING(64),
    allowNull: true
  },
  actorRole: {
    type: DataTypes.STRING(32),
    allowNull: true
  },
  action: {
    type: DataTypes.STRING(64),
    allowNull: false
  },
  targetEntity: {
    type: DataTypes.STRING(64),
    allowNull: true
  },
  status: {
    type: DataTypes.STRING(16),
    allowNull: false,
    defaultValue: 'ALLOWED'
  },
  details: {
    type: DataTypes.JSON,
    allowNull: false,
    defaultValue: {}
  },
  previousEntryHash: {
    type: DataTypes.STRING(64),
    allowNull: false
  },
  entryHash: {
    type: DataTypes.STRING(64),
    allowNull: false,
    unique: true
  },
  timestamp: {
    type: DataTypes.STRING(32),
    allowNull: false
  }
}, {
  tableName: 'database_audit_records',
  timestamps: true,
  indexes: [
    { fields: ['sequence'], unique: true },
    { fields: ['entryHash'], unique: true },
    { fields: ['eventType'] },
    { fields: ['actorId'] },
    { fields: ['status'] }
  ],
  hooks: {
    beforeUpdate: () => {
      throw new Error('Database audit records are immutable and cannot be updated.');
    },
    beforeDestroy: () => {
      throw new Error('Database audit records are immutable and cannot be deleted.');
    }
  }
});

module.exports = DatabaseAuditRecord;

