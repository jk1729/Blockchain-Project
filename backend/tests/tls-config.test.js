/**
 * PHASE 12: TLS/mTLS Configuration & Validation Test Suite
 */

const { NetworkConfig } = require('../src/network/NetworkConfig');
const { NetworkError, NetworkErrorCode } = require('../src/network/NetworkErrors');
const { ValidatorConfig } = require('../src/config/validatorConfig');

describe('PHASE 12: TLS/mTLS Configuration & Security Boundary Suite', () => {
  describe('1. NetworkConfig TLS Options', () => {
    test('1.1 should default useTLS to true if not explicitly disabled', () => {
      const config = new NetworkConfig({ validatorId: 'VAL-01', listenPort: 5001 });
      expect(config.useTLS).toBe(true);
      expect(config.tls).toBe(true);
    });

    test('1.2 should allow disabling TLS when explicitly configured', () => {
      const config = new NetworkConfig({ validatorId: 'VAL-01', listenPort: 5001, useTLS: false });
      expect(config.useTLS).toBe(false);
      expect(config.tls).toBe(false);
    });

    test('1.3 should preserve custom tlsOptions (ca, cert, key, rejectUnauthorized)', () => {
      const customOpts = {
        ca: 'CUSTOM_CA_PEM',
        cert: 'CUSTOM_CERT_PEM',
        key: 'CUSTOM_KEY_PEM',
        rejectUnauthorized: true,
        requestCert: true
      };
      const config = new NetworkConfig({
        validatorId: 'VAL-01',
        listenPort: 5001,
        tlsOptions: customOpts
      });
      expect(config.tlsOptions).toBeDefined();
      expect(config.tlsOptions.ca).toBe('CUSTOM_CA_PEM');
      expect(config.tlsOptions.rejectUnauthorized).toBe(true);
      expect(config.tlsOptions.requestCert).toBe(true);
    });

    test('1.4 toJSON should never leak private key data in config export', () => {
      const config = new NetworkConfig({
        validatorId: 'VAL-01',
        listenPort: 5001,
        tlsOptions: {
          key: 'SUPER_SECRET_PRIVATE_KEY',
          cert: 'CERT_PEM'
        }
      });
      const exported = JSON.stringify(config);
      expect(exported).not.toContain('SUPER_SECRET_PRIVATE_KEY');
    });
  });

  describe('2. ValidatorConfig TLS Integration', () => {
    test('2.1 should load TLS paths and construct sanitized safe representation', () => {
      const config = ValidatorConfig.forValidator('VAL-01', {
        tlsCaPath: 'certs/ca.crt',
        tlsCertPath: 'certs/val-01.crt',
        tlsKeyPath: 'certs/val-01.key',
        useTLS: true
      });

      expect(config.useTLS).toBe(true);
      const safe = config.toSafeObject();
      expect(safe.validatorId).toBe('VAL-01');
      expect(safe.useTLS).toBe(true);
      const serialized = JSON.stringify(safe);
      expect(serialized).not.toContain('privateKey');
      expect(serialized).not.toContain('secret');
    });
  });
});

