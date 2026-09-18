const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const CheckpointRecord = sequelize.define('CheckpointRecord', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true
  },
  checkpointHeight: {
    type: DataTypes.INTEGER,
    allowNull: false,
    unique: true
  },
  checkpointHash: {
    type: DataTypes.STRING(66),
    allowNull: false
  },
  blockHash: {
    type: DataTypes.STRING(66),
    allowNull: false
  },
  stateRoot: {
    type: DataTypes.STRING(66),
    allowNull: false
  },
  certificateHash: {
    type: DataTypes.STRING(66),
    allowNull: false
  },
  approvingValidators: {
    type: DataTypes.JSON,
    allowNull: false,
    defaultValue: []
  },
  validatorCount: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 12
  },
  isCommitted: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true
  }
}, {
  tableName: 'checkpoint_records',
  timestamps: true,
  indexes: [
    { fields: ['checkpointHeight'], unique: true },
    { fields: ['checkpointHash'] }
  ],
  hooks: {
    beforeUpdate: (instance) => {
      throw new Error(`Committed checkpoint at height #${instance.checkpointHeight} is immutable.`);
    },
    beforeDestroy: (instance) => {
      throw new Error(`Committed checkpoint at height #${instance.checkpointHeight} cannot be deleted.`);
    }
  }
});

module.exports = CheckpointRecord;

