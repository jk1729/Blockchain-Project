/**
 * PDSChain Standard Response Envelope & Redaction (Phase 14)
 * 
 * Canonical contract:
 * {
 *   "data": {},
 *   "meta": {
 *     "version": "1.0.0",
 *     "requestId": "req_...",
 *     "timestamp": "2026-09-17T...",
 *     "finality": "FINALIZED"
 *   },
 *   "error": null
 * }
 */

const { CURRENT_SEMVER } = require('./ApiVersioning');

const SENSITIVE_KEYS = [
  'privatekey', 'private_key',
  'seed', 'mnemonic',
  'passphrase', 'secret',
  'password', 'keymaterial',
  'authorization'
];

function sanitizeSecrets(obj) {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== 'object') return obj;

  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeSecrets(item));
  }

  const clean = {};
  for (const [key, value] of Object.entries(obj)) {
    const lower = key.toLowerCase();
    if (SENSITIVE_KEYS.some(k => lower.includes(k))) {
      clean[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      clean[key] = sanitizeSecrets(value);
    } else {
      clean[key] = value;
    }
  }
  return clean;
}

function buildMeta(req, extraMeta = {}) {
  const meta = {
    version: CURRENT_SEMVER,
    timestamp: new Date().toISOString(),
    ...(req && req.requestId ? { requestId: req.requestId } : {}),
    ...extraMeta
  };
  return sanitizeSecrets(meta);
}

function successEnvelope(data, req, extraMeta = {}) {
  return {
    data: sanitizeSecrets(data),
    meta: buildMeta(req, extraMeta),
    error: null
  };
}

function errorEnvelope(code, message, details = null, req, extraMeta = {}) {
  return {
    data: null,
    meta: buildMeta(req, extraMeta),
    error: {
      code: code || 'INTERNAL_ERROR',
      message: message || 'An unexpected error occurred',
      ...(details ? { details: sanitizeSecrets(details) } : {})
    }
  };
}

function sendSuccess(res, data, extraMeta = {}, statusCode = 200) {
  res.setHeader('Content-Type', 'application/json');
  return res.status(statusCode).json(successEnvelope(data, res.req, extraMeta));
}

function sendError(res, code, message, details = null, statusCode = 500, extraMeta = {}) {
  res.setHeader('Content-Type', 'application/json');
  return res.status(statusCode).json(errorEnvelope(code, message, details, res.req, extraMeta));
}

module.exports = {
  sanitizeSecrets,
  buildMeta,
  successEnvelope,
  errorEnvelope,
  sendSuccess,
  sendError
};

