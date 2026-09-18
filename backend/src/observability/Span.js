/**
 * PDSChain OpenTelemetry-Compatible Span (Phase 19)
 * 
 * Represents an individual timed segment of execution with bounded attributes,
 * error recording, and automatic secret redaction.
 */

const { StructuredLogger } = require('./StructuredLogger');

const SPAN_STATUS = Object.freeze({
  UNSET: 'UNSET',
  OK: 'OK',
  ERROR: 'ERROR'
});

const MAX_ATTRIBUTES = 64;
const MAX_ATTR_VALUE_LENGTH = 512;

class Span {
  constructor(name, context = {}, options = {}) {
    this.name = String(name || 'unnamed_span').slice(0, 128);
    this.traceId = context.traceId;
    this.spanId = context.spanId;
    this.parentSpanId = context.parentSpanId || null;
    this.kind = options.kind || 'INTERNAL';
    this.startTime = Date.now();
    this.endTime = null;
    this.durationMs = null;
    this.status = { code: SPAN_STATUS.UNSET, message: null };
    this.attributes = {};
    this.events = [];
    this.isSampled = options.isSampled !== false;
    this.onEnd = options.onEnd || null;
    this.ended = false;

    if (options.attributes) {
      this.setAttributes(options.attributes);
    }
  }

  /**
   * Attach key-value attribute with bounding and secret redaction
   * @param {string} key 
   * @param {*} value 
   */
  setAttribute(key, value) {
    if (this.ended) return this;
    if (Object.keys(this.attributes).length >= MAX_ATTRIBUTES) return this;

    const cleanKey = String(key).slice(0, 64).replace(/[^a-zA-Z0-9_.-]/g, '_');
    const lowerKey = cleanKey.toLowerCase();
    const isSensitiveKey = ['password', 'secret', 'seed', 'privatekey', 'passphrase', 'token'].some(k => lowerKey.includes(k));

    let finalVal = isSensitiveKey ? '[REDACTED]' : StructuredLogger.redact(value);
    if (typeof finalVal === 'string' && finalVal.length > MAX_ATTR_VALUE_LENGTH) {
      finalVal = finalVal.slice(0, MAX_ATTR_VALUE_LENGTH) + '...[TRUNCATED]';
    }

    this.attributes[cleanKey] = finalVal;
    return this;
  }

  setAttributes(attrs = {}) {
    if (attrs && typeof attrs === 'object') {
      for (const [k, v] of Object.entries(attrs)) {
        this.setAttribute(k, v);
      }
    }
    return this;
  }

  setStatus(code, message = null) {
    if (this.ended) return this;
    const normalized = String(code).toUpperCase();
    if ([SPAN_STATUS.OK, SPAN_STATUS.ERROR].includes(normalized)) {
      this.status.code = normalized;
      this.status.message = message ? String(message).slice(0, 256) : null;
    }
    return this;
  }

  recordException(err) {
    if (this.ended || !err) return this;
    this.setStatus(SPAN_STATUS.ERROR, err.message || 'Error recorded');
    this.setAttribute('error.name', err.name || 'Error');
    this.setAttribute('error.message', err.message || 'Unknown error');
    if (err.code) this.setAttribute('error.code', err.code);
    return this;
  }

  addEvent(name, attributes = {}) {
    if (this.ended) return this;
    this.events.push({
      name: String(name).slice(0, 64),
      timestamp: Date.now(),
      attributes: StructuredLogger.redact(attributes)
    });
    return this;
  }

  end() {
    if (this.ended) return;
    this.ended = true;
    this.endTime = Date.now();
    this.durationMs = Math.max(0, this.endTime - this.startTime);

    if (typeof this.onEnd === 'function') {
      try {
        this.onEnd(this);
      } catch (_) {}
    }
  }

  toJSON() {
    return {
      name: this.name,
      traceId: this.traceId,
      spanId: this.spanId,
      parentSpanId: this.parentSpanId,
      kind: this.kind,
      startTime: this.startTime,
      endTime: this.endTime,
      durationMs: this.durationMs,
      status: this.status,
      attributes: this.attributes,
      events: this.events
    };
  }
}

module.exports = {
  SPAN_STATUS,
  Span
};
