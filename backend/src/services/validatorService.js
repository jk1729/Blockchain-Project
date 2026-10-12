const Validator = require('../models/Validator');
const fbaInstance = require('../consensus/FBAConsensus');
const { resolveValidatorId } = require('../consensus/consensusConfig');
const { getValidatorProcessStatuses } = require('../validators/startValidators');
const { NotFoundError } = require('../utils/errors');

class ValidatorService {
  async getAllValidators() {
    // Return synced state between DB, in-memory FBA engine, and isolated OS processes
    const nodes = fbaInstance.getValidators();
    const procList = getValidatorProcessStatuses();
    const procMap = new Map(procList.map(p => [p.validatorId, p]));

    return nodes.map(n => {
      const json = n.toJSON();
      const proc = procMap.get(n.validatorId);
      return {
        ...json,
        port: proc ? proc.port : (4000 + parseInt(n.validatorId.replace('VAL-', ''), 10)),
        processPid: proc ? proc.pid : null,
        processRunning: proc ? proc.running : false,
        processMode: proc ? proc.mode : 'in_process'
      };
    });
  }

  getValidatorProcesses() {
    return getValidatorProcessStatuses();
  }

  async getValidatorById(id) {
    const resolvedId = resolveValidatorId(id) || String(id).toUpperCase().trim();
    const node = fbaInstance.getValidator(resolvedId);
    if (!node) {
      throw new NotFoundError(`Validator '${id}' not found.`);
    }
    const procList = getValidatorProcessStatuses();
    const proc = procList.find(p => p.validatorId === node.validatorId);
    return {
      ...node.toJSON(),
      port: proc ? proc.port : (4000 + parseInt(node.validatorId.replace('VAL-', ''), 10)),
      processPid: proc ? proc.pid : null,
      processRunning: proc ? proc.running : false,
      processMode: proc ? proc.mode : 'in_process'
    };
  }

  async updateValidatorStatus(id, status) {
    const resolvedId = resolveValidatorId(id) || String(id).toUpperCase().trim();
    const node = fbaInstance.getValidator(resolvedId);
    if (!node) {
      throw new NotFoundError(`Validator '${id}' not found.`);
    }

    const ok = fbaInstance.setValidatorStatus(resolvedId, status);
    if (!ok) {
      throw new Error(`Invalid status '${status}'. Must be Online, Offline, or Degraded.`);
    }

    // Persist to DB
    const record = await Validator.findOne({ where: { validatorId: resolvedId } });
    if (record) {
      record.status = status;
      await record.save();
    }

    const networkStatus = fbaInstance.getNetworkStatus();

    return {
      validator: node.toJSON(),
      networkStatus
    };
  }
}

module.exports = new ValidatorService();


