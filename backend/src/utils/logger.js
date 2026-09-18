/**
 * PDSChain Unified Logger Gateway (Phase 19)
 * 
 * Bridges existing logger calls to the production StructuredLogger engine
 * while maintaining 100% backward compatibility for all existing callers.
 */

const { defaultStructuredLogger, StructuredLogger } = require('../observability/StructuredLogger');

// Backwards-compatible secret redaction export
function redactSecrets(input) {
  return StructuredLogger.redact(input);
}

const logger = {
  info: (msg, meta = {}) => defaultStructuredLogger.info(msg, meta),
  warn: (msg, meta = {}) => defaultStructuredLogger.warn(msg, meta),
  error: (msg, meta = {}) => defaultStructuredLogger.error(msg, meta),
  fatal: (msg, meta = {}) => defaultStructuredLogger.fatal(msg, meta),
  consensus: (msg, meta = {}) => defaultStructuredLogger.consensus(msg, meta),
  execution: (msg, meta = {}) => defaultStructuredLogger.execution(msg, meta),
  debug: (msg, meta = {}) => defaultStructuredLogger.debug(msg, meta),
  withComponent: (component) => defaultStructuredLogger.withComponent(component),
  redactSecrets,
  StructuredLogger,
  defaultStructuredLogger
};

module.exports = logger;
