/**
 * PDSChain Idempotency & Replay Protection Middleware (Phase 14)
 * 
 * Intercepts write requests with `Idempotency-Key` headers and caches responses
 * to prevent duplicate blockchain state changes on network retries.
 */

class IdempotencyManager {
  constructor(options = {}) {
    this.ttlMs = options.ttlMs || 15 * 60 * 1000; // 15 minutes default
    this.cache = new Map(); // idempotencyKey -> { statusCode, body, headers, expiresAt }
    
    this.cleanupInterval = setInterval(() => this.cleanup(), 60 * 1000);
    if (this.cleanupInterval.unref) {
      this.cleanupInterval.unref();
    }
  }

  cleanup() {
    const now = Date.now();
    for (const [key, record] of this.cache.entries()) {
      if (record.expiresAt < now) {
        this.cache.delete(key);
      }
    }
  }

  reset() {
    this.cache.clear();
  }

  close() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
  }

  middleware() {
    return (req, res, next) => {
      // Only apply to state-modifying requests
      const isMutating = ['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method);
      const idempotencyKey = req.headers['idempotency-key'];

      if (!isMutating || !idempotencyKey) {
        return next();
      }

      const key = String(idempotencyKey).trim();
      const now = Date.now();

      // Check if we have a valid cached response
      const cached = this.cache.get(key);
      if (cached && cached.expiresAt > now) {
        res.setHeader('X-Idempotent-Replayed', 'true');
        res.setHeader('Idempotency-Key', key);
        return res.status(cached.statusCode).json(cached.body);
      }

      // Intercept res.json to capture response
      const originalJson = res.json.bind(res);
      res.json = (body) => {
        // Cache response only if non-5xx
        if (res.statusCode < 500) {
          this.cache.set(key, {
            statusCode: res.statusCode,
            body,
            expiresAt: Date.now() + this.ttlMs
          });
        }
        res.setHeader('Idempotency-Key', key);
        return originalJson(body);
      };

      next();
    };
  }
}

const defaultIdempotencyManager = new IdempotencyManager();

module.exports = {
  IdempotencyManager,
  defaultIdempotencyManager
};

