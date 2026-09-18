/**
 * PHASE 12: Certificate Lifecycle, Expiry Monitoring & Dynamic Reload Test Suite
 */

const fs = require('fs');
const path = require('path');
const { CertificateManager, ExpiryTier } = require('../src/security/CertificateManager');
const { NetworkError, NetworkErrorCode } = require('../src/network/NetworkErrors');

describe('PHASE 12: Certificate Lifecycle & Health Management', () => {
  const fixturesDir = path.join(__dirname, 'fixtures', 'tls');
  const caCertPath = path.join(fixturesDir, 'ca.crt');
  const val1CertPath = path.join(fixturesDir, 'val-01.crt');
  const val1KeyPath = path.join(fixturesDir, 'val-01.key');
  const val2CertPath = path.join(fixturesDir, 'val-02.crt');
  const val2KeyPath = path.join(fixturesDir, 'val-02.key');
  const expiredCertPath = path.join(fixturesDir, 'expired.crt');
  const alienCertPath = path.join(fixturesDir, 'alien-val.crt');

  let caCertPem;
  let val1CertPem;
  let val1KeyPem;
  let expiredCertPem;
  let alienCertPem;

  beforeAll(() => {
    caCertPem = fs.readFileSync(caCertPath, 'utf8');
    val1CertPem = fs.readFileSync(val1CertPath, 'utf8');
    val1KeyPem = fs.readFileSync(val1KeyPath, 'utf8');
    expiredCertPem = fs.readFileSync(expiredCertPath, 'utf8');
    alienCertPem = fs.readFileSync(alienCertPath, 'utf8');
  });

  describe('1. Parsing & Cryptographic Extraction', () => {
    test('1.1 should parse valid X.509 certificate and extract metadata accurately', () => {
      const cm = new CertificateManager({
        certPem: val1CertPem,
        keyPem: val1KeyPem,
        caPem: caCertPem
      });

      const health = cm.getHealthStatus();
      expect(health.configured).toBe(true);
      expect(health.cn).toBe('VAL-01');
      expect(health.san).toContain('127.0.0.1');
      expect(health.san).toContain('localhost');
      expect(health.fingerprint256).toBeDefined();
      expect(health.caConfigured).toBe(true);
      expect(health.isExpired).toBe(false);
    });

    test('1.2 should reject invalid certificate PEM string', () => {
      expect(() => {
        CertificateManager.parse('NOT_VALID_PEM');
      }).toThrow(NetworkError);
    });
  });

  describe('2. CA Chain Verification & Cryptographic Identity Binding', () => {
    test('2.1 should verify certificate issued by Consortium CA for expected validator', () => {
      const cm = new CertificateManager({ caPem: caCertPem });
      const result = cm.verifyPeerCertificate(val1CertPem, 'VAL-01');
      expect(result.valid).toBe(true);
      expect(result.cn).toBe('VAL-01');
    });

    test('2.2 should reject certificate issued by untrusted alien CA', () => {
      const cm = new CertificateManager({ caPem: caCertPem });
      expect(() => {
        cm.verifyPeerCertificate(alienCertPem, 'VAL-01');
      }).toThrow(expect.objectContaining({
        code: NetworkErrorCode.UNKNOWN_ISSUER
      }));
    });

    test('2.3 should reject certificate when CN/SAN mismatches expected validator ID', () => {
      const cm = new CertificateManager({ caPem: caCertPem });
      expect(() => {
        // val1 cert has CN=VAL-01, but we expect VAL-02
        cm.verifyPeerCertificate(val1CertPem, 'VAL-02');
      }).toThrow(expect.objectContaining({
        code: NetworkErrorCode.VALIDATOR_IDENTITY_MISMATCH
      }));
    });

    test('2.4 should reject expired certificate with EXPIRED_CERTIFICATE code', () => {
      const cm = new CertificateManager({ caPem: caCertPem });
      expect(() => {
        cm.verifyPeerCertificate(expiredCertPem, 'VAL-01');
      }).toThrow(expect.objectContaining({
        code: NetworkErrorCode.EXPIRED_CERTIFICATE
      }));
    });
  });

  describe('3. Expiry Tier Monitoring', () => {
    test('3.1 should classify certificate expiry into appropriate tier', () => {
      const cm = new CertificateManager({ certPem: val1CertPem });
      const expiry = cm.checkExpiry();
      expect([ExpiryTier.OK, ExpiryTier.WARNING_30D]).toContain(expiry.status);
      expect(expiry.daysRemaining).toBeGreaterThan(0);
      expect(expiry.isExpired).toBe(false);
    });

    test('3.2 should flag expired certificate accurately', () => {
      const cm = new CertificateManager({ certPem: expiredCertPem });
      const expiry = cm.checkExpiry();
      expect(expiry.status).toBe(ExpiryTier.EXPIRED);
      expect(expiry.isExpired).toBe(true);
    });
  });

  describe('4. Dynamic/Hot Certificate Reload', () => {
    test('4.1 should hot reload new certificate and key without restarting', (done) => {
      const cm = new CertificateManager({
        certPath: val1CertPath,
        keyPath: val1KeyPath,
        caPem: caCertPem
      });

      expect(cm.getHealthStatus().cn).toBe('VAL-01');

      cm.on('reloaded', (evt) => {
        expect(evt.fingerprint).toBeDefined();
        expect(cm.getHealthStatus().cn).toBe('VAL-02');
        done();
      });

      // Reload to VAL-02
      const result = cm.reload(val2CertPath, val2KeyPath);
      expect(result.reloaded).toBe(true);
    });
  });
});

