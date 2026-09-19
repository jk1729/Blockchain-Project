const { validateConfig, DEFAULT_DEV_JWT_SECRET } = require('../src/config/env');
const request = require('supertest');
const express = require('express');
const cors = require('cors');

describe('Security Configuration: JWT Secret & CORS Policy', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('JWT Secret Security Validation in Production', () => {
    test('1. should reject startup in production if JWT_SECRET is missing or empty', () => {
      expect(() => {
        validateConfig({
          NODE_ENV: 'production',
          JWT_SECRET: '',
          CORS_ORIGIN: 'https://pdschain.gov.in'
        });
      }).toThrow(/CONFIG ERROR: JWT_SECRET must be explicitly set in production/);

      expect(() => {
        validateConfig({
          NODE_ENV: 'production',
          JWT_SECRET: undefined,
          CORS_ORIGIN: 'https://pdschain.gov.in'
        });
      }).toThrow(/CONFIG ERROR: JWT_SECRET must be explicitly set in production/);
    });

    test('2. should reject startup in production if default development secret is used', () => {
      expect(() => {
        validateConfig({
          NODE_ENV: 'production',
          JWT_SECRET: DEFAULT_DEV_JWT_SECRET,
          CORS_ORIGIN: 'https://pdschain.gov.in'
        });
      }).toThrow(/CONFIG ERROR: Insecure development JWT_SECRET fallback cannot be used in production/);
    });

    test('3. should reject startup in production if JWT_SECRET is shorter than 32 characters', () => {
      expect(() => {
        validateConfig({
          NODE_ENV: 'production',
          JWT_SECRET: 'too_short_secret_key',
          CORS_ORIGIN: 'https://pdschain.gov.in'
        });
      }).toThrow(/CONFIG ERROR: JWT_SECRET must be at least 32 characters long in production/);
    });

    test('4. should succeed in production when strong, non-default secret and explicit CORS are provided', () => {
      expect(() => {
        validateConfig({
          NODE_ENV: 'production',
          JWT_SECRET: 'super_secure_production_secret_key_at_least_32_chars_long!',
          CORS_ORIGIN: 'https://pdschain.gov.in'
        });
      }).not.toThrow();
    });

    test('5. should allow default secret in development mode', () => {
      expect(() => {
        validateConfig({
          NODE_ENV: 'development',
          JWT_SECRET: DEFAULT_DEV_JWT_SECRET,
          CORS_ORIGIN: '*'
        });
      }).not.toThrow();
    });
  });

  describe('CORS Security Policy Validation in Production', () => {
    test('6. should reject startup in production if CORS_ORIGIN is wildcard (*)', () => {
      expect(() => {
        validateConfig({
          NODE_ENV: 'production',
          JWT_SECRET: 'super_secure_production_secret_key_at_least_32_chars_long!',
          CORS_ORIGIN: '*'
        });
      }).toThrow(/CONFIG ERROR: Unrestricted wildcard CORS_ORIGIN is not permitted in production/);
    });

    test('7. should reject startup in production if CORS_ORIGIN is empty', () => {
      expect(() => {
        validateConfig({
          NODE_ENV: 'production',
          JWT_SECRET: 'super_secure_production_secret_key_at_least_32_chars_long!',
          CORS_ORIGIN: ''
        });
      }).toThrow(/CONFIG ERROR: Unrestricted wildcard CORS_ORIGIN is not permitted in production/);
    });
  });

  describe('CORS Middleware Runtime Behavior', () => {
    function createTestApp(nodeEnv, corsOriginConfig) {
      const app = express();
      const corsOptions = {
        origin: (origin, callback) => {
          if (!origin) return callback(null, true);

          const allowedOrigins = (corsOriginConfig || '')
            .split(',')
            .map(o => o.trim())
            .filter(Boolean);

          if (nodeEnv === 'production') {
            if (allowedOrigins.includes('*')) {
              return callback(new Error('CORS policy: Wildcard origin is forbidden in production.'));
            }
            if (allowedOrigins.includes(origin)) {
              return callback(null, true);
            }
            return callback(new Error(`CORS policy: Origin ${origin} is not allowed by CORS.`));
          }

          if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
            return callback(null, true);
          }
          if (/^https?:\/\/(localhost|127\.0\.0\.1)(:[0-9]+)?$/.test(origin)) {
            return callback(null, true);
          }

          return callback(new Error(`CORS policy: Origin ${origin} is not allowed by CORS.`));
        }
      };

      app.use(cors(corsOptions));
      app.get('/test-endpoint', (req, res) => res.json({ success: true }));
      // Express error handler
      app.use((err, req, res, next) => {
        res.status(403).json({ error: err.message });
      });
      return app;
    }

    test('8. should permit allowed origin in production mode', async () => {
      const app = createTestApp('production', 'https://portal.pdschain.gov.in, https://admin.pdschain.gov.in');
      const res = await request(app)
        .get('/test-endpoint')
        .set('Origin', 'https://portal.pdschain.gov.in');

      expect(res.status).toBe(200);
      expect(res.headers['access-control-allow-origin']).toBe('https://portal.pdschain.gov.in');
    });

    test('9. should block unauthorized origin in production mode', async () => {
      const app = createTestApp('production', 'https://portal.pdschain.gov.in');
      const res = await request(app)
        .get('/test-endpoint')
        .set('Origin', 'https://malicious-site.attacker.com');

      expect(res.status).toBe(403);
      expect(res.body.error).toContain('is not allowed by CORS');
    });

    test('10. should permit requests with no Origin header (same-origin, curl, server-to-server)', async () => {
      const app = createTestApp('production', 'https://portal.pdschain.gov.in');
      const res = await request(app).get('/test-endpoint');

      expect(res.status).toBe(200);
    });

    test('11. should allow localhost in development mode', async () => {
      const app = createTestApp('development', '');
      const res = await request(app)
        .get('/test-endpoint')
        .set('Origin', 'http://localhost:3000');

      expect(res.status).toBe(200);
      expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    });
  });
});

