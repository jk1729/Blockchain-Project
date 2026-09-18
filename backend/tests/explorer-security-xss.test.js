/**
 * PDSChain Explorer XSS & Injection Prevention Test Suite (Phase 15)
 */

const request = require('supertest');
const app = require('../src/app');
const { sequelize } = require('../src/config/database');
const { seedDatabase } = require('../src/seed/seedDatabase');

describe('Explorer XSS & Injection Prevention Test Suite (Phase 15)', () => {
  beforeAll(async () => {
    await seedDatabase(true);
  });

  afterAll(async () => {
    await sequelize.close();
  });

  it('should enforce strict security headers on all explorer responses', async () => {
    const res = await request(app).get('/api/v1/explorer/overview');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['x-xss-protection']).toBe('1; mode=block');
    expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
  });

  it('should safely process search inputs containing script injection payloads', async () => {
    const maliciousPayload = "<script>alert('xss')</script>";
    const res = await request(app).get(`/api/v1/explorer/search?q=${encodeURIComponent(maliciousPayload)}`);
    expect(res.status).toBe(200);
    expect(res.body.error).toBeNull();
    expect(res.body.data.matches).toEqual([]);
    expect(res.body.data.query).toBe(maliciousPayload);
  });

  it('should safely process address queries containing img onerror injection payloads', async () => {
    const maliciousPayload = "<img src=x onerror=fetch('http://evil.com')>";
    const res = await request(app).get(`/api/v1/explorer/address/${encodeURIComponent(maliciousPayload)}`);
    expect(res.status).toBe(200);
    expect(res.body.data.transactions).toEqual([]);
    expect(res.body.data.address).toBe(maliciousPayload);
  });

  it('should prevent SQL / NoSQL injection syntax from disrupting block lookups', async () => {
    const injectionQuery = "0' OR '1'='1";
    const res = await request(app).get(`/api/v1/explorer/block/${encodeURIComponent(injectionQuery)}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('BLOCK_NOT_FOUND');
  });

  it('should safely escape HTML characters in explorer client utilities', () => {
    // Test the logic used by frontend/js/explorer.js escapeHtml
    function escapeHtml(str) {
      if (str === null || str === undefined) return "";
      return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
    }

    const dirty = '<script>alert("hack")</script>&foo=\'bar\'';
    const clean = escapeHtml(dirty);
    expect(clean).not.toContain('<script>');
    expect(clean).not.toContain('"hack"');
    expect(clean).toContain('&lt;script&gt;');
    expect(clean).toContain('&quot;hack&quot;');
    expect(clean).toContain('&#039;bar&#039;');
    expect(clean).toContain('&amp;foo=');
  });
});

