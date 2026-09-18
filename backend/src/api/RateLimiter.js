/**
 * PDSChain Sliding-Window Rate Limiter (Phase 14)
 * 
 * Enforces bounded request rates per client IP or API key, with standard HTTP rate-limit headers.
 */

class RateLimiter {
  constructor(options = {}) {
    this.windowMs = options.windowMs || 60 * 1000; // 1 minute default
    this.max = options.max || 120;                  // default 120 requests / window
    this.keyGenerator = options.keyGenerator || ((req) => req.ip || req.connection.remoteAddress || 'unknown');
    this.clients = new Map(); // key -> Array of timestamps
    this.enabled = options.enabled !== undefined ? options.enabled : true;

    // Periodic sweep of idle clients
    this.cleanupInterval = setInterval(() => this.cleanup(), this.windowMs);
    if (this.cleanupInterval.unref) {
      this.cleanupInterval.unref();
    }
  }

  cleanup() {
    const now = Date.now();
    for (const [key, timestamps] of this.clients.entries()) {
      const valid = timestamps.filter(t => now - t < this.windowMs);
      if (valid.length === 0) {
        this.clients.delete(key);
      } else {
        this.clients.set(key, valid);
      }
    }
  }

  reset() {
    this.clients.clear();
  }

  close() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
  }

  middleware() {
    return (req, res, next) => {
      if (!this.enabled) {
        return next();
      }

      const key = this.keyGenerator(req);
      const now = Date.now();
      const windowStart = now - this.windowMs;

      let timestamps = this.clients.get(key) || [];
      // Filter timestamps within current window
      timestamps = timestamps.filter(t => t > windowStart);

      const remaining = Math.max(0, this.max - (timestamps.length + 1));
      const resetTime = Math.ceil((now + this.windowMs) / 1000);

      res.setHeader('X-RateLimit-Limit', this.max);
      res.setHeader('X-RateLimit-Remaining', remaining);
      res.setHeader('X-RateLimit-Reset', resetTime);

      if (timestamps.length >= this.max) {
        const oldest = timestamps[0];
        const retryAfter = Math.max(1, Math.ceil((oldest + this.windowMs - now) / 1000));
        res.setHeader('Retry-After', retryAfter);

        const isV1 = (req.path || '').startsWith('/api/v1') || (req.path || '').startsWith('/rpc');
        if (isV1) {
          return res.status(429).json({
            data: null,
            meta: {
              timestamp: new Date().toISOString(),
              retryAfter
            },
            error: {
              code: 'RATE_LIMIT_EXCEEDED',
              message: `Too many requests. Maximum ${this.max} requests per ${this.windowMs / 1000}s.`,
              retryAfter
            }
          });
        }

        return res.status(429).json({
          success: false,
          message: 'Too many requests. Please slow down.',
          retryAfter
        });
      }

      timestamps.push(now);
      this.clients.set(key, timestamps);
      next();
    };
  }
}

// Global default limiters
const publicLimiter = new RateLimiter({ windowMs: 60 * 1000, max: 120 });
const mutatingLimiter = new RateLimiter({ windowMs: 60 * 1000, max: 30 });
const rpcLimiter = new RateLimiter({ windowMs: 60 * 1000, max: 180 });

module.exports = {
  RateLimiter,
  publicLimiter,
  mutatingLimiter,
  rpcLimiter
};

