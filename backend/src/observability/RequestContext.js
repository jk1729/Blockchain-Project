/**
 * PDSChain Request Context & Correlation Propagation (Phase 19)
 * 
 * Uses Node.js AsyncLocalStorage to propagate correlation and trace identifiers
 * across asynchronous promises, callbacks, consensus rounds, and database operations.
 */

const { AsyncLocalStorage } = require('async_hooks');
const crypto = require('crypto');

const asyncLocalStorage = new AsyncLocalStorage();

// Security bounds on inbound identifiers
const MAX_ID_LENGTH = 128;
const SAFE_ID_REGEX = /^[a-zA-Z0-9_-]+$/;

class RequestContext {
  /**
   * Run a callback within a specific request context
   * @param {object} context 
   * @param {Function} fn 
   * @returns {*}
   */
  static run(context, fn) {
    return asyncLocalStorage.run(context, fn);
  }

  /**
   * Retrieve active request context
   * @returns {object}
   */
  static current() {
    return asyncLocalStorage.getStore() || {};
  }

  /**
   * Get specific key from active context
   * @param {string} key 
   * @returns {*}
   */
  static get(key) {
    const store = asyncLocalStorage.getStore();
    return store ? store[key] : undefined;
  }

  /**
   * Set specific key on active context
   * @param {string} key 
   * @param {*} value 
   */
  static set(key, value) {
    const store = asyncLocalStorage.getStore();
    if (store && typeof store === 'object') {
      store[key] = value;
    }
  }

  /**
   * Generate a compliant unique Request ID
   * @returns {string}
   */
  static generateRequestId() {
    if (crypto.randomUUID) {
      return `req_${crypto.randomUUID().replace(/-/g, '')}`;
    }
    return `req_${crypto.randomBytes(16).toString('hex')}`;
  }

  /**
   * Generate a 32-character hexadecimal W3C Trace ID
   * @returns {string}
   */
  static generateTraceId() {
    return crypto.randomBytes(16).toString('hex');
  }

  /**
   * Generate a 16-character hexadecimal W3C Span ID
   * @returns {string}
   */
  static generateSpanId() {
    return crypto.randomBytes(8).toString('hex');
  }

  /**
   * Validate or sanitize an incoming request ID
   * @param {*} raw 
   * @returns {string|null}
   */
  static validateInboundId(raw) {
    if (!raw || typeof raw !== 'string') return null;
    const trimmed = raw.trim();
    if (trimmed.length === 0 || trimmed.length > MAX_ID_LENGTH) return null;
    if (!SAFE_ID_REGEX.test(trimmed)) return null;
    return trimmed;
  }

  /**
   * Parse standard W3C traceparent header:
   * format: 00-{traceId}-{parentSpanId}-{flags}
   * @param {string} header 
   * @returns {{ traceId: string, parentSpanId: string, flags: string } | null}
   */
  static parseTraceParent(header) {
    if (!header || typeof header !== 'string') return null;
    const parts = header.trim().split('-');
    if (parts.length < 4) return null;
    const [version, traceId, parentSpanId, flags] = parts;
    if (version !== '00') return null;
    if (!/^[0-9a-fA-F]{32}$/.test(traceId)) return null;
    if (!/^[0-9a-fA-F]{16}$/.test(parentSpanId)) return null;
    return {
      traceId: traceId.toLowerCase(),
      parentSpanId: parentSpanId.toLowerCase(),
      flags: flags || '01'
    };
  }

  /**
   * Express middleware to initialize context on incoming requests
   */
  static middleware() {
    return (req, res, next) => {
      // 1. Resolve or generate Request ID
      const rawReqId = req.headers['x-request-id'] || req.headers['x-correlation-id'];
      const validatedReqId = RequestContext.validateInboundId(rawReqId);
      const requestId = validatedReqId || RequestContext.generateRequestId();

      // 2. Resolve or generate W3C Trace Context
      const rawTraceParent = req.headers['traceparent'];
      const parsedTrace = RequestContext.parseTraceParent(rawTraceParent);
      const traceId = parsedTrace ? parsedTrace.traceId : RequestContext.generateTraceId();
      const parentSpanId = parsedTrace ? parsedTrace.parentSpanId : null;
      const spanId = RequestContext.generateSpanId();

      // 3. Build context store
      const context = {
        requestId,
        traceId,
        spanId,
        parentSpanId,
        nodeId: process.env.NODE_ID || 'node-01',
        validatorId: process.env.VALIDATOR_ID || null,
        startTime: Date.now(),
        method: req.method,
        path: req.path
      };

      // 4. Attach to req & res objects for compatibility
      req.requestId = requestId;
      req.traceId = traceId;
      req.spanId = spanId;

      res.setHeader('X-Request-ID', requestId);
      res.setHeader('X-Correlation-ID', requestId);
      res.setHeader('traceparent', `00-${traceId}-${spanId}-01`);

      // 5. Run downstream in AsyncLocalStorage
      RequestContext.run(context, () => {
        next();
      });
    };
  }

  /**
   * Wrap an asynchronous callback or background worker with existing or new context
   * @param {Function} taskFn 
   * @param {object} [extraContext] 
   * @returns {Promise<*>}
   */
  static async wrapTask(taskFn, extraContext = {}) {
    const active = RequestContext.current();
    const context = {
      requestId: extraContext.requestId || active.requestId || RequestContext.generateRequestId(),
      traceId: extraContext.traceId || active.traceId || RequestContext.generateTraceId(),
      spanId: extraContext.spanId || RequestContext.generateSpanId(),
      nodeId: process.env.NODE_ID || 'node-01',
      validatorId: extraContext.validatorId || active.validatorId || process.env.VALIDATOR_ID || null,
      ...active,
      ...extraContext
    };

    return RequestContext.run(context, taskFn);
  }
}

module.exports = RequestContext;

