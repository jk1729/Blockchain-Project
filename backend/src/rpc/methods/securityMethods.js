/**
 * PDSChain JSON-RPC 2.0 Security & Maintenance Methods (Phase 17)
 */

const { defaultAdminWorkflowManager } = require('../../security/permissions/AdminWorkflowManager');

const securityMethods = {
  /**
   * pds_rebuildProofIndex
   */
  async pds_rebuildProofIndex(params, context) {
    return defaultAdminWorkflowManager.triggerReindex(context.user || { username: 'rpc_user', role: 'ADMIN' });
  },

  /**
   * pds_rotateConsensusKey
   */
  async pds_rotateConsensusKey(params, context) {
    const targetHeight = params && params[0] && params[0].targetHeight ? params[0].targetHeight : 100;
    const newPublicKey = params && params[0] && params[0].newPublicKey ? params[0].newPublicKey : 'a'.repeat(64);
    const keyManager = context.app && context.app.locals && context.app.locals.keyRotationManager;
    return defaultAdminWorkflowManager.stageConsensusKey(context.user || { username: 'rpc_user', role: 'SECURITY_OPERATOR' }, keyManager, { targetHeight, newPublicKey });
  },

  /**
   * pds_reloadCertificates
   */
  async pds_reloadCertificates(params, context) {
    const certManager = context.app && context.app.locals && context.app.locals.certificateManager;
    return defaultAdminWorkflowManager.reloadCertificates(context.user || { username: 'rpc_user', role: 'SECURITY_OPERATOR' }, certManager);
  },

  /**
   * pds_triggerSync
   */
  async pds_triggerSync(params, context) {
    return defaultAdminWorkflowManager.triggerSync(context.user || { username: 'rpc_user', role: 'OPERATOR' });
  }
};

module.exports = securityMethods;

