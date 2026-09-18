/**
 * PDSChain v1 Security & Administration Routes (Phase 17)
 */

const express = require('express');
const router = express.Router();
const { authMiddleware, optionalAuthMiddleware } = require('../../middleware/authMiddleware');
const { requirePermission } = require('../../security/permissions/permissionMiddleware');
const { defaultAdminWorkflowManager } = require('../../security/permissions/AdminWorkflowManager');
const { defaultAuthorizationService } = require('../../security/permissions/AuthorizationService');
const { defaultSecurityMetrics } = require('../../security/permissions/SecurityMetrics');
const { defaultSecurityAuditLogger } = require('../../security/permissions/SecurityAuditLogger');
const { sendSuccess, sendError } = require('../../api/ResponseEnvelope');

// --- 1. Security Telemetry & Prometheus Metrics ---
router.get('/metrics', (req, res) => {
  if (req.headers.accept && req.headers.accept.includes('text/plain')) {
    res.setHeader('Content-Type', 'text/plain; version=0.0.4');
    return res.send(defaultSecurityMetrics.toPrometheusFormat());
  }
  return sendSuccess(res, defaultSecurityMetrics.getSnapshot());
});

// --- 2. Audit Log Queries & Cryptographic Export ---
router.get('/audit', authMiddleware, requirePermission('admin:read:audit-log'), (req, res) => {
  try {
    const entries = defaultSecurityAuditLogger.query(req.query || {});
    return sendSuccess(res, entries, { count: entries.length });
  } catch (err) {
    return sendError(res, 'AUDIT_QUERY_ERROR', err.message, null, 400);
  }
});

router.get('/audit/export', authMiddleware, requirePermission('admin:export:audit-log'), (req, res) => {
  try {
    const exportData = defaultAdminWorkflowManager.exportAuditLog(req.user, req.query || {});
    return sendSuccess(res, exportData);
  } catch (err) {
    return sendError(res, 'AUDIT_EXPORT_ERROR', err.message, null, err.statusCode || 500);
  }
});

router.get('/audit/verify', authMiddleware, requirePermission('admin:read:audit-log'), (req, res) => {
  const result = defaultSecurityAuditLogger.verifyIntegrity();
  return sendSuccess(res, result);
});

// --- 3. Break-Glass Emergency Controls ---
router.post('/break-glass/activate', authMiddleware, requirePermission('admin:manage:network-policy'), (req, res) => {
  try {
    const { operatorId, reason, durationSeconds } = req.body;
    const session = defaultAuthorizationService.activateBreakGlass({
      operatorId: operatorId || req.user.username,
      reason: reason || 'Unspecified emergency maintenance',
      durationSeconds,
      approverId: req.user.username
    });
    return sendSuccess(res, session, null, 201);
  } catch (err) {
    return sendError(res, 'BREAK_GLASS_ERROR', err.message, null, 400);
  }
});

router.post('/break-glass/revoke', authMiddleware, requirePermission('admin:manage:network-policy'), (req, res) => {
  try {
    const { operatorId, reason } = req.body;
    const revoked = defaultAuthorizationService.revokeBreakGlass({
      operatorId: operatorId || req.user.username,
      reason
    });
    return sendSuccess(res, { operatorId: operatorId || req.user.username, revoked });
  } catch (err) {
    return sendError(res, 'BREAK_GLASS_ERROR', err.message, null, 400);
  }
});

router.get('/break-glass/status', authMiddleware, (req, res) => {
  const activeSessions = defaultAuthorizationService.getActiveBreakGlassSessions();
  return sendSuccess(res, {
    activeCount: activeSessions.length,
    sessions: activeSessions
  });
});

// --- 4. API Key Lifecycle ---
router.post('/api-keys', authMiddleware, requirePermission('admin:manage:api-keys'), (req, res) => {
  try {
    const keyData = defaultAdminWorkflowManager.createApiKey(req.user, req.body || {});
    return sendSuccess(res, keyData, null, 201);
  } catch (err) {
    return sendError(res, 'API_KEY_ERROR', err.message, null, 400);
  }
});

router.post('/api-keys/:keyId/rotate', authMiddleware, requirePermission('admin:manage:api-keys'), (req, res) => {
  try {
    const rotated = defaultAdminWorkflowManager.rotateApiKey(req.user, req.params.keyId);
    return sendSuccess(res, rotated);
  } catch (err) {
    return sendError(res, 'API_KEY_ERROR', err.message, null, 400);
  }
});

router.delete('/api-keys/:keyId', authMiddleware, requirePermission('admin:manage:api-keys'), (req, res) => {
  try {
    const revoked = defaultAdminWorkflowManager.revokeApiKey(req.user, req.params.keyId, req.body && req.body.reason);
    return sendSuccess(res, revoked);
  } catch (err) {
    return sendError(res, 'API_KEY_ERROR', err.message, null, 400);
  }
});

// --- 5. Peer Authorization Management ---
router.post('/peers/authorize', authMiddleware, requirePermission('security:manage:peer-authorization'), (req, res) => {
  try {
    const { peerId, metadata } = req.body;
    const result = defaultAdminWorkflowManager.authorizePeer(req.user, peerId, metadata);
    return sendSuccess(res, result);
  } catch (err) {
    return sendError(res, 'PEER_AUTH_ERROR', err.message, null, 400);
  }
});

router.post('/peers/:peerId/suspend', authMiddleware, requirePermission('security:manage:peer-authorization'), (req, res) => {
  try {
    const result = defaultAdminWorkflowManager.suspendPeer(req.user, req.params.peerId, req.body && req.body.reason);
    return sendSuccess(res, result);
  } catch (err) {
    return sendError(res, 'PEER_AUTH_ERROR', err.message, null, 400);
  }
});

router.post('/peers/:peerId/revoke', authMiddleware, requirePermission('security:manage:peer-authorization'), (req, res) => {
  try {
    const result = defaultAdminWorkflowManager.revokePeer(req.user, req.params.peerId, req.body && req.body.reason);
    return sendSuccess(res, result);
  } catch (err) {
    return sendError(res, 'PEER_AUTH_ERROR', err.message, null, 400);
  }
});

// --- 6. Certificate Operations ---
router.post('/certificates/reload', authMiddleware, requirePermission('security:reload:certificate'), (req, res) => {
  try {
    const certManager = req.app && req.app.locals && req.app.locals.certificateManager;
    const result = defaultAdminWorkflowManager.reloadCertificates(req.user, certManager);
    return sendSuccess(res, result);
  } catch (err) {
    return sendError(res, 'CERT_ERROR', err.message, null, 400);
  }
});

router.post('/certificates/revoke', authMiddleware, requirePermission('security:revoke:certificate'), (req, res) => {
  try {
    const { fingerprint, reason } = req.body;
    const result = defaultAdminWorkflowManager.revokeCertificate(req.user, fingerprint, reason);
    return sendSuccess(res, result);
  } catch (err) {
    return sendError(res, 'CERT_ERROR', err.message, null, 400);
  }
});

module.exports = router;

