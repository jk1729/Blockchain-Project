const request = require('supertest');
const express = require('express');
const { RateLimiter } = require('../src/api/RateLimiter');
const { IdempotencyManager } = require('../src/api/IdempotencyManager');
const { requestTracingMiddleware } = require('../src/api/RequestTracing');

describe('API Rate Limiting and Idempotency Test Suite (Phase 14)', () => {
  let app;
  let testLimiter;
  let testIdempotency;
  let mutationCounter = 0;

  beforeEach(() => {
    mutationCounter = 0;
    app = express();
    app.use(express.json());
    app.use(requestTracingMiddleware);

    testLimiter = new RateLimiter({ windowMs: 1000, max: 5 });
    testIdempotency = new IdempotencyManager({ ttlMs: 5000 });

    app.get('/test/limited', testLimiter.middleware(), (req, res) => {
      res.json({ message: 'ok' });
    });

    app.post('/test/idempotent', testIdempotency.middleware(), (req, res) => {
      mutationCounter++;
      res.status(201).json({
        mutationId: `mut_${mutationCounter}`,
        payload: req.body
      });
    });
  });

  afterEach(() => {
    testLimiter.close();
    testIdempotency.close();
  });

  it('should attach standard rate limit headers on responses', async () => {
    const res = await request(app).get('/test/limited');
    expect(res.status).toBe(200);
    expect(res.headers['x-ratelimit-limit']).toBe('5');
    expect(res.headers['x-ratelimit-remaining']).toBe('4');
    expect(res.headers['x-ratelimit-reset']).toBeDefined();
  });

  it('should decrement remaining quota on successive requests', async () => {
    const res1 = await request(app).get('/test/limited');
    expect(res1.headers['x-ratelimit-remaining']).toBe('4');

    const res2 = await request(app).get('/test/limited');
    expect(res2.headers['x-ratelimit-remaining']).toBe('3');

    const res3 = await request(app).get('/test/limited');
    expect(res3.headers['x-ratelimit-remaining']).toBe('2');
  });

  it('should return 429 Too Many Requests with Retry-After when rate limit is exceeded', async () => {
    // Fire 5 requests to consume all quota
    for (let i = 0; i < 5; i++) {
      await request(app).get('/test/limited');
    }

    // 6th request should fail
    const blockedRes = await request(app).get('/test/limited');
    expect(blockedRes.status).toBe(429);
    expect(blockedRes.headers['retry-after']).toBeDefined();
    expect(blockedRes.body.success).toBe(false);
  });

  it('should process first request with Idempotency-Key and record mutation', async () => {
    const res = await request(app)
      .post('/test/idempotent')
      .set('Idempotency-Key', 'idemp-key-001')
      .send({ action: 'TRANSFER', amount: 100 });

    expect(res.status).toBe(201);
    expect(res.body.mutationId).toBe('mut_1');
    expect(res.headers['idempotency-key']).toBe('idemp-key-001');
    expect(mutationCounter).toBe(1);
  });

  it('should return cached response with X-Idempotent-Replayed on identical Idempotency-Key without re-executing', async () => {
    const payload = { action: 'TRANSFER', amount: 250 };

    // Initial request
    const firstRes = await request(app)
      .post('/test/idempotent')
      .set('Idempotency-Key', 'idemp-key-002')
      .send(payload);

    expect(firstRes.status).toBe(201);
    expect(firstRes.body.mutationId).toBe('mut_1');
    expect(mutationCounter).toBe(1);

    // Duplicate request with identical Idempotency-Key
    const replayRes = await request(app)
      .post('/test/idempotent')
      .set('Idempotency-Key', 'idemp-key-002')
      .send(payload);

    expect(replayRes.status).toBe(201);
    expect(replayRes.headers['x-idempotent-replayed']).toBe('true');
    expect(replayRes.body.mutationId).toBe('mut_1');
    expect(mutationCounter).toBe(1); // handler was not re-executed
  });

  it('should treat different Idempotency-Keys as distinct operations', async () => {
    const resA = await request(app)
      .post('/test/idempotent')
      .set('Idempotency-Key', 'key-alpha')
      .send({ id: 'A' });

    const resB = await request(app)
      .post('/test/idempotent')
      .set('Idempotency-Key', 'key-beta')
      .send({ id: 'B' });

    expect(resA.body.mutationId).toBe('mut_1');
    expect(resB.body.mutationId).toBe('mut_2');
    expect(mutationCounter).toBe(2);
  });
});

