const request = require('supertest');
const app = require('../src/app');
const { sequelize } = require('../src/config/database');
const blockchainService = require('../src/services/blockchainService');

describe('API Versioning and Compatibility Test Suite (Phase 14)', () => {
  beforeAll(async () => {
    await blockchainService.init();
  });

  afterAll(async () => {
    await sequelize.close();
  });

  it('should serve supported /api/v1/health with version metadata and standardized envelope', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.headers['x-api-version']).toBe('1.0.0');
    expect(res.body).toHaveProperty('data');
    expect(res.body).toHaveProperty('meta');
    expect(res.body.meta.version).toBe('1.0.0');
    expect(res.body.error).toBeNull();
    expect(res.body.data.status).toBe('HEALTHY');
  });

  it('should explicitly reject unsupported versions like /api/v99 with 400 Bad Request', async () => {
    const res = await request(app).get('/api/v99/health');
    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
    expect(res.body.error.code).toBe('UNSUPPORTED_API_VERSION');
    expect(res.body.error.message).toContain('v99');
  });

  it('should preserve legacy /api/health response shape and attach deprecation headers', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.status).toBe('HEALTHY');
    expect(res.headers['deprecation']).toBe('true');
    expect(res.headers['sunset']).toBeDefined();
    expect(res.headers['link']).toContain('rel="successor-version"');
  });

  it('should generate and return unique X-Request-ID when not supplied by client', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.headers['x-request-id']).toBeDefined();
    expect(res.headers['x-request-id']).toMatch(/^req_/);
    expect(res.body.meta.requestId).toBe(res.headers['x-request-id']);
  });

  it('should preserve client-supplied X-Request-ID header in response', async () => {
    const clientTraceId = 'client-trace-12345-xyz';
    const res = await request(app)
      .get('/api/v1/health')
      .set('X-Request-ID', clientTraceId);

    expect(res.headers['x-request-id']).toBe(clientTraceId);
    expect(res.body.meta.requestId).toBe(clientTraceId);
  });

  it('should support content negotiation header Accept: application/vnd.pdschain.v1+json', async () => {
    const res = await request(app)
      .get('/api/v1/blockchain')
      .set('Accept', 'application/vnd.pdschain.v1+json');

    expect(res.status).toBe(200);
    expect(res.headers['x-api-version']).toBe('1.0.0');
    expect(res.body.data).toBeDefined();
  });
});

