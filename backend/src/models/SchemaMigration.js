const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const SchemaMigration = sequelize.define('SchemaMigration', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true
  },
  version: {
    type: DataTypes.INTEGER,
    allowNull: false,
    unique: true
  },
  name: {
    type: DataTypes.STRING(128),
    allowNull: false
  },
  checksum: {
    type: DataTypes.STRING(64),
    allowNull: false
  },
  executionTimeMs: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0
  },
  appliedBy: {
    type: DataTypes.STRING(64),
    allowNull: false,
    defaultValue: 'SYSTEM'
  },
  appliedAt: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW
  }
}, {
  tableName: 'schema_migrations',
  timestamps: false,
  indexes: [
    { fields: ['version'], unique: true }
  ]
});

module.exports = SchemaMigration;

