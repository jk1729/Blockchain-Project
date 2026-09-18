/**
 * PDSChain Application & HTTP/RPC Metrics (Phase 19)
 * 
 * Collects HTTP request rates, latency histograms, in-flight gauges, response sizes,
 * error code breakdowns, JSON-RPC telemetry, and SSE stream metrics.
 */

const { defaultMetricsRegistry } = require('./MetricsRegistry');

class ApplicationMetrics {
  constructor(registry = defaultMetricsRegistry) {
    this.registry = registry;

    // HTTP Metrics
    this.httpRequestsTotal = this.registry.registerCounter(
      'pds_http_requests_total',
      'Total count of HTTP requests received',
      ['method', 'route', 'status_code']
    );

    this.httpRequestDuration = this.registry.registerHistogram(
      'pds_http_request_duration_seconds',
      'HTTP request latency in seconds',
      ['method', 'route', 'status_code'],
      [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5]
    );

    this.requestsInFlight = this.registry.registerGauge(
      'pds_http_requests_in_flight',
      'Current number of HTTP requests actively being processed'
    );

    this.responseSizeBytes = this.registry.registerHistogram(
      'pds_http_response_size_bytes',
      'HTTP response payload size in bytes',
      ['method', 'route'],
      [128, 512, 1024, 4096, 16384, 65536, 262144, 1048576]
    );

    this.httpErrorsTotal = this.registry.registerCounter(
      'pds_http_errors_total',
      'Total HTTP errors categorized by stable application error code',
      ['error_code']
    );

    this.rateLimitRejectionsTotal = this.registry.registerCounter(
      'pds_rate_limit_rejections_total',
      'Total number of requests rejected by rate limiting'
    );

    // JSON-RPC 2.0 Metrics
    this.rpcRequestsTotal = this.registry.registerCounter(
      'pds_rpc_requests_total',
      'Total JSON-RPC 2.0 requests invoked',
      ['method']
    );

    this.rpcDuration = this.registry.registerHistogram(
      'pds_rpc_duration_seconds',
      'JSON-RPC method execution latency in seconds',
      ['method'],
      [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5]
    );

    this.rpcErrorsTotal = this.registry.registerCounter(
      'pds_rpc_errors_total',
      'Total JSON-RPC errors returned',
      ['method', 'error_code']
    );

    // SSE Metrics
    this.sseConnectionsActive = this.registry.registerGauge(
      'pds_sse_connections_active',
      'Active Server-Sent Events client stream connections'
    );

    this.sseEventsDeliveredTotal = this.registry.registerCounter(
      'pds_sse_events_delivered_total',
      'Total events delivered over SSE streams',
      ['category']
    );

    this.sseEventsDroppedTotal = this.registry.registerCounter(
      'pds_sse_events_dropped_total',
      'Total events dropped due to client backpressure or queue overflow'
    );
  }

  /**
   * Normalize an Express route to avoid high-cardinality path explosions
   * @param {string} rawPath 
   * @returns {string}
   */
  static normalizeRoute(rawPath) {
    if (!rawPath || typeof rawPath !== 'string') return '/';
    let path = rawPath.split('?')[0];

    // Normalize block heights/numbers (e.g. /blocks/1234 -> /blocks/:height)
    path = path.replace(/\/blocks\/\d+/g, '/blocks/:height');
    // Normalize transaction / block hex hashes (e.g. /0x123... -> /:hash)
    path = path.replace(/\/0x[0-9a-fA-F]+/g, '/:hash');
    // Normalize general hexadecimal IDs
    path = path.replace(/\/[0-9a-fA-F]{32,64}/g, '/:hash');
    // Normalize UUIDs
    path = path.replace(/\/[0-9a-fA-F-]{36}/g, '/:uuid');
    // Normalize user/shop/warehouse IDs (e.g. /BEN-001, /SHOP-01, /WH-01)
    path = path.replace(/\/(?:BEN|SHOP|WH|VAL)-\d+/gi, '/:id');

    return path.length > 64 ? path.slice(0, 64) : path;
  }

  /**
   * Record completion of an HTTP request
   * @param {string} method 
   * @param {string} rawRoute 
   * @param {number} statusCode 
   * @param {number} durationSeconds 
   * @param {number} [bytes=0] 
   */
  recordHttpRequest(method, rawRoute, statusCode, durationSeconds, bytes = 0) {
    const route = ApplicationMetrics.normalizeRoute(rawRoute);
    const labels = {
      method: (method || 'GET').toUpperCase(),
      route,
      status_code: String(statusCode || 200)
    };

    this.httpRequestsTotal.inc(labels);
    this.httpRequestDuration.observe(labels, Math.max(0, durationSeconds));

    if (bytes > 0) {
      this.responseSizeBytes.observe({ method: labels.method, route }, bytes);
    }
  }

  /**
   * Express middleware collecting in-flight and completed HTTP telemetry
   */
  middleware() {
    return (req, res, next) => {
      // Skip metrics path itself to avoid loop overhead
      if (req.path.endsWith('/metrics')) {
        return next();
      }

      this.requestsInFlight.inc();
      const t0 = process.hrtime();

      const onFinish = () => {
        res.removeListener('finish', onFinish);
        res.removeListener('close', onFinish);
        this.requestsInFlight.dec();

        const diff = process.hrtime(t0);
        const durationSec = diff[0] + diff[1] / 1e9;
        const contentLength = parseInt(res.getHeader('content-length'), 10) || 0;

        const route = req.route ? req.baseUrl + req.route.path : req.baseUrl + req.path;
        this.recordHttpRequest(req.method, route, res.statusCode, durationSec, contentLength);
      };

      res.once('finish', onFinish);
      res.once('close', onFinish);

      next();
    };
  }

  recordHttpError(errorCode) {
    const safeCode = String(errorCode || 'INTERNAL_ERROR').slice(0, 32).toUpperCase();
    this.httpErrorsTotal.inc({ error_code: safeCode });
  }

  recordRateLimitRejection() {
    this.rateLimitRejectionsTotal.inc();
  }

  recordRpcRequest(method, durationSeconds, errorCode = null) {
    const safeMethod = String(method || 'unknown').slice(0, 48);
    this.rpcRequestsTotal.inc({ method: safeMethod });
    this.rpcDuration.observe({ method: safeMethod }, Math.max(0, durationSeconds));

    if (errorCode !== null && errorCode !== undefined) {
      this.rpcErrorsTotal.inc({ method: safeMethod, error_code: String(errorCode) });
    }
  }

  setSseClients(count) {
    this.sseConnectionsActive.set(Math.max(0, count));
  }

  recordSseDelivery(category = 'GENERAL', count = 1) {
    this.sseEventsDeliveredTotal.inc({ category: String(category).slice(0, 32) }, count);
  }

  recordSseDrop(count = 1) {
    this.sseEventsDroppedTotal.inc(count);
  }
}

const defaultApplicationMetrics = new ApplicationMetrics();

module.exports = {
  ApplicationMetrics,
  defaultApplicationMetrics
};

