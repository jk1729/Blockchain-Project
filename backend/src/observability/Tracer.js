/**
 * PDSChain Distributed Tracer (Phase 19)
 * 
 * Provides an OpenTelemetry-compatible tracing abstraction with W3C Trace Context,
 * head-based sampling, and non-blocking span export.
 */

const RequestContext = require('./RequestContext');
const { Span, SPAN_STATUS } = require('./Span');

class Tracer {
  constructor(options = {}) {
    this.serviceName = options.serviceName || process.env.SERVICE_NAME || 'pdschain-backend';
    this.exporter = options.exporter || process.env.TRACING_EXPORTER || 'none'; // 'none' | 'console' | 'memory' | 'otlp'
    this.sampleRate = options.sampleRate !== undefined
      ? options.sampleRate
      : (parseFloat(process.env.TRACING_SAMPLE_RATE) || 1.0);
    this.enabled = options.enabled !== undefined
      ? options.enabled
      : (process.env.TRACING_ENABLED === 'true' || process.env.NODE_ENV === 'test');
    this.spans = []; // Used when exporter === 'memory'
  }

  /**
   * Determine if span should be sampled
   * @returns {boolean}
   */
  shouldSample() {
    if (!this.enabled) return false;
    if (this.sampleRate >= 1.0) return true;
    if (this.sampleRate <= 0.0) return false;
    return Math.random() < this.sampleRate;
  }

  /**
   * Handle finished span
   * @param {Span} span 
   */
  exportSpan(span) {
    if (!span.isSampled) return;

    if (this.exporter === 'memory') {
      this.spans.push(span.toJSON());
      if (this.spans.length > 1000) this.spans.shift();
    } else if (this.exporter === 'console') {
      try {
        process.stdout.write(`[TRACE] ${JSON.stringify(span.toJSON())}\n`);
      } catch (_) {}
    }
  }

  /**
   * Start an independent or child span
   * @param {string} name 
   * @param {object} [options] 
   * @returns {Span}
   */
  startSpan(name, options = {}) {
    const parentContext = RequestContext.current();
    const traceId = options.traceId || parentContext.traceId || RequestContext.generateTraceId();
    const parentSpanId = options.parentSpanId || parentContext.spanId || null;
    const spanId = RequestContext.generateSpanId();
    const isSampled = this.shouldSample();

    const span = new Span(name, { traceId, spanId, parentSpanId }, {
      kind: options.kind || 'INTERNAL',
      attributes: {
        'service.name': this.serviceName,
        ...options.attributes
      },
      isSampled,
      onEnd: (s) => this.exportSpan(s)
    });

    return span;
  }

  /**
   * Start a span and execute callback within its active context
   * @param {string} name 
   * @param {object|Function} optionsOrFn 
   * @param {Function} [fn] 
   * @returns {*}
   */
  async startActiveSpan(name, optionsOrFn, fn) {
    let options = {};
    let callback = optionsOrFn;

    if (typeof optionsOrFn === 'object' && typeof fn === 'function') {
      options = optionsOrFn;
      callback = fn;
    }

    const span = this.startSpan(name, options);
    const currentCtx = RequestContext.current();

    const newCtx = {
      ...currentCtx,
      traceId: span.traceId,
      spanId: span.spanId,
      parentSpanId: span.parentSpanId
    };

    return RequestContext.run(newCtx, async () => {
      try {
        const result = await callback(span);
        if (span.status.code === SPAN_STATUS.UNSET) {
          span.setStatus(SPAN_STATUS.OK);
        }
        return result;
      } catch (err) {
        span.recordException(err);
        throw err;
      } finally {
        span.end();
      }
    });
  }

  /**
   * Express middleware to start root HTTP span
   */
  middleware() {
    return (req, res, next) => {
      const span = this.startSpan(`HTTP ${req.method} ${req.baseUrl || ''}${req.path}`, {
        kind: 'SERVER',
        attributes: {
          'http.method': req.method,
          'http.url': req.originalUrl || req.url,
          'http.host': req.headers.host,
          'http.user_agent': req.headers['user-agent']
        }
      });

      // Update RequestContext with root spanId
      RequestContext.set('spanId', span.spanId);
      RequestContext.set('traceId', span.traceId);

      const onFinish = () => {
        res.removeListener('finish', onFinish);
        res.removeListener('close', onFinish);

        span.setAttribute('http.status_code', res.statusCode);
        if (res.statusCode >= 500) {
          span.setStatus(SPAN_STATUS.ERROR, `HTTP ${res.statusCode}`);
        } else {
          span.setStatus(SPAN_STATUS.OK);
        }
        span.end();
      };

      res.once('finish', onFinish);
      res.once('close', onFinish);

      next();
    };
  }

  getExportedSpans() {
    return [...this.spans];
  }

  clearSpans() {
    this.spans = [];
  }
}

const defaultTracer = new Tracer();

module.exports = {
  Tracer,
  defaultTracer
};

