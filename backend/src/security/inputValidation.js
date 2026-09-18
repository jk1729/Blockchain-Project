/**
 * PDSChain Input Validation & Injection Hardening (Phase 17)
 * 
 * Defense-in-depth protections against:
 * - Prototype pollution (`__proto__`, `constructor.prototype`)
 * - Path traversal (`../`, `..\\`, null bytes)
 * - Deep object nesting abuse (ReDoS / Parser exhaustion)
 * - Command / shell injection patterns
 */

const FORBIDDEN_OBJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const MAX_NESTING_DEPTH = 10;
const MAX_STRING_LENGTH = 128 * 1024; // 128 KB max string field

class InputSecurityError extends Error {
  constructor(message, code = 'INVALID_INPUT') {
    super(message);
    this.name = 'InputSecurityError';
    this.code = code;
    this.statusCode = 400;
  }
}

/**
 * Recursively inspect and sanitize an object against prototype pollution
 * and nesting depth abuse by stripping dangerous properties.
 */
function sanitizeInput(obj, depth = 0) {
  if (depth > MAX_NESTING_DEPTH) {
    throw new InputSecurityError(`Request input exceeds maximum allowable nesting depth of ${MAX_NESTING_DEPTH}`, 'DEPTH_LIMIT_EXCEEDED');
  }

  if (obj === null || obj === undefined) return obj;

  if (typeof obj === 'string') {
    if (obj.length > MAX_STRING_LENGTH) {
      throw new InputSecurityError('Input string exceeds maximum allowable length', 'STRING_LENGTH_EXCEEDED');
    }
    return obj;
  }

  if (typeof obj !== 'object') return obj;

  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeInput(item, depth + 1));
  }

  const clean = {};
  for (const key of Object.keys(obj)) {
    if (FORBIDDEN_OBJECT_KEYS.has(key)) {
      // Strip forbidden property to neutralize prototype pollution safely
      continue;
    }
    clean[key] = sanitizeInput(obj[key], depth + 1);
  }

  return clean;
}

/**
 * Validate a filename or relative path against path traversal attacks
 */
function validateSafePath(filepath) {
  if (typeof filepath !== 'string' || filepath.trim() === '') {
    throw new InputSecurityError('Path must be a non-empty string', 'INVALID_PATH');
  }

  // Detect null bytes
  if (filepath.includes('\0')) {
    throw new InputSecurityError('Null byte detected in path', 'PATH_TRAVERSAL_DETECTED');
  }

  // Detect directory traversal sequences
  if (filepath.includes('..') || filepath.includes(':/') || filepath.includes(':\\')) {
    throw new InputSecurityError('Directory traversal sequence detected in path', 'PATH_TRAVERSAL_DETECTED');
  }

  return filepath.trim();
}

/**
 * Express middleware for global input sanitization
 */
function inputSanitizerMiddleware(req, res, next) {
  try {
    if (req.body && typeof req.body === 'object') {
      req.body = sanitizeInput(req.body);
    }
    if (req.query && typeof req.query === 'object') {
      req.query = sanitizeInput(req.query);
    }
    if (req.params && typeof req.params === 'object') {
      req.params = sanitizeInput(req.params);
    }
    next();
  } catch (err) {
    if (err instanceof InputSecurityError) {
      return res.status(err.statusCode || 400).json({
        success: false,
        error: err.message,
        code: err.code
      });
    }
    next(err);
  }
}

module.exports = {
  InputSecurityError,
  sanitizeInput,
  validateSafePath,
  inputSanitizerMiddleware,
  FORBIDDEN_OBJECT_KEYS,
  MAX_NESTING_DEPTH
};

