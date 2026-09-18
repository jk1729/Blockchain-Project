/**
 * PDSChain Request Tracing Middleware (Phase 14 & 19)
 * 
 * Injects unique X-Request-ID / X-Correlation-ID and W3C traceparent headers
 * while propagating execution context via AsyncLocalStorage.
 */

const RequestContext = require('../observability/RequestContext');

const requestTracingMiddleware = RequestContext.middleware();

module.exports = {
  requestTracingMiddleware
};
