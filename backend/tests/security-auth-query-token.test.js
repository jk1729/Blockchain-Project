const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');
const config = require('../src/config/env');
const { authMiddleware, optionalAuthMiddleware } = require('../src/middleware/authMiddleware');
const User = require('../src/models/User');

describe('Security: Authentication Token Transport (Query String Rejection)', () => {
  let app;
  let validToken;
  let testUser;

  beforeAll(() => {
    testUser = { id: 1, username: 'admin', role: 'ADMIN', name: 'Administrator', entityId: 'ADM-001' };
    jest.spyOn(User, 'findByPk').mockImplementation(async (id) => {
      if (id === testUser.id) return testUser;
      return null;
    });

    validToken = jwt.sign(
      { id: testUser.id, username: testUser.username, role: testUser.role },
      config.JWT_SECRET,
      { expiresIn: '1h' }
    );

    app = express();
    app.use(express.json());

    // Protected route with mandatory auth
    app.get('/api/protected', authMiddleware, (req, res) => {
      res.json({ success: true, user: req.user });
    });

    // Route with optional auth
    app.get('/api/optional', optionalAuthMiddleware, (req, res) => {
      res.json({ success: true, authenticated: !!req.user, user: req.user || null });
    });

    // Error handler
    app.use((err, req, res, next) => {
      res.status(err.statusCode || 401).json({
        success: false,
        error: err.name,
        message: err.message
      });
    });
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  test('1. should authenticate successfully with valid Bearer token in Authorization header', async () => {
    const res = await request(app)
      .get('/api/protected')
      .set('Authorization', `Bearer ${validToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.user.username).toBe(testUser.username);
  });

  test('2. should reject authentication when token is supplied via query string (?token=...)', async () => {
    const res = await request(app)
      .get(`/api/protected?token=${validToken}`);

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/Passing authentication tokens via query string is not permitted/);
  });

  test('3. should reject request with missing Authorization header', async () => {
    const res = await request(app)
      .get('/api/protected');

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/Authentication token missing/);
  });

  test('4. should reject request with malformed or invalid token in Authorization header', async () => {
    const res = await request(app)
      .get('/api/protected')
      .set('Authorization', 'Bearer invalid.token.value');

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/Invalid authentication token/);
  });

  test('5. optionalAuthMiddleware should ignore query parameter tokens and remain unauthenticated', async () => {
    const res = await request(app)
      .get(`/api/optional?token=${validToken}`);

    expect(res.status).toBe(200);
    expect(res.body.authenticated).toBe(false);
    expect(res.body.user).toBeNull();
  });

  test('6. optionalAuthMiddleware should populate req.user when valid Bearer token is provided', async () => {
    const res = await request(app)
      .get('/api/optional')
      .set('Authorization', `Bearer ${validToken}`);

    expect(res.status).toBe(200);
    expect(res.body.authenticated).toBe(true);
    expect(res.body.user.username).toBe(testUser.username);
  });
});
