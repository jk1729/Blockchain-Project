/**
 * PHASE 12: KeyStore Security, Encryption & Redaction Test Suite
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { KeyStore, KeyStoreError } = require('../src/security/KeyStore');
const { generateKeyPair } = require('../src/blockchain/identity/keyManager');

describe('PHASE 12: KeyStore Cryptographic Credential Management', () => {
  let tempDir;
  let sampleEd25519;
  let sampleTransportCert;
  let sampleTransportKey;

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdschain-keystore-test-'));
    sampleEd25519 = generateKeyPair();

    const fixturesDir = path.join(__dirname, 'fixtures', 'tls');
    sampleTransportCert = fs.readFileSync(path.join(fixturesDir, 'val-01.crt'), 'utf8');
    sampleTransportKey = fs.readFileSync(path.join(fixturesDir, 'val-01.key'), 'utf8');
  });

  afterAll(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (e) {}
  });

  describe('1. In-Memory Initialization & Access Control', () => {
    test('1.1 should construct KeyStore and accept valid Ed25519 consensus credentials', () => {
      const ks = new KeyStore({ validatorId: 'VAL-01' });
      ks.setConsensusCredentials(sampleEd25519);
      ks._isUnlocked = true;

      expect(ks.hasConsensusKey()).toBe(true);
      expect(ks.getConsensusAddress()).toBe(sampleEd25519.address);
      expect(ks.getConsensusPublicKey()).toBe(sampleEd25519.publicKey);
      expect(ks.getConsensusPrivateKey()).toBe(sampleEd25519.privateKey);
    });

    test('1.2 should accept valid transport X.509 credentials', () => {
      const ks = new KeyStore({ validatorId: 'VAL-01' });
      ks.setTransportCredentials({
        cert: sampleTransportCert,
        key: sampleTransportKey
      });
      ks._isUnlocked = true;

      expect(ks.hasTransportKey()).toBe(true);
      expect(ks.getTransportCertificate()).toBe(sampleTransportCert);
      expect(ks.getTransportPrivateKey()).toBe(sampleTransportKey);
    });

    test('1.3 should reject non-ed25519 key for consensus credentials', () => {
      const ks = new KeyStore({ validatorId: 'VAL-01' });
      expect(() => {
        ks.setConsensusCredentials({
          privateKey: sampleTransportKey // RSA key
        });
      }).toThrow(/ed25519/i);
    });

    test('1.4 should reject invalid transport certificate PEM', () => {
      const ks = new KeyStore({ validatorId: 'VAL-01' });
      expect(() => {
        ks.setTransportCredentials({
          cert: 'NOT_A_CERT',
          key: sampleTransportKey
        });
      }).toThrow(KeyStoreError);
    });
  });

  describe('2. Encryption at Rest & Passphrase Protection', () => {
    test('2.1 should encrypt credentials at rest with AES-256-GCM and decrypt successfully', () => {
      const ks = KeyStore.fromCredentials({
        validatorId: 'VAL-01',
        consensus: sampleEd25519,
        transport: {
          cert: sampleTransportCert,
          key: sampleTransportKey
        }
      });

      const ksFile = path.join(tempDir, 'val-01-encrypted.json');
      const passphrase = 'ConsortiumSecretPassword123!';
      ks.saveToFile(ksFile, passphrase);

      const rawSaved = JSON.parse(fs.readFileSync(ksFile, 'utf8'));
      expect(rawSaved.encrypted).toBe(true);
      expect(rawSaved.salt).toBeDefined();
      expect(rawSaved.iv).toBeDefined();
      expect(rawSaved.authTag).toBeDefined();
      expect(rawSaved.ciphertext).toBeDefined();
      expect(JSON.stringify(rawSaved)).not.toContain(sampleEd25519.privateKey);

      // Load back
      const loaded = KeyStore.loadFromFile(ksFile, passphrase);
      expect(loaded.getConsensusAddress()).toBe(sampleEd25519.address);
      expect(loaded.getConsensusPublicKey()).toBe(sampleEd25519.publicKey);
      expect(loaded.getConsensusPrivateKey()).toBe(sampleEd25519.privateKey);
      expect(loaded.getTransportCertificate()).toBe(sampleTransportCert);
    });

    test('2.2 should reject decryption with incorrect passphrase', () => {
      const ks = KeyStore.fromCredentials({
        validatorId: 'VAL-01',
        consensus: sampleEd25519
      });
      const ksFile = path.join(tempDir, 'val-01-wrong-pw.json');
      ks.saveToFile(ksFile, 'CorrectPassphrase');

      expect(() => {
        KeyStore.loadFromFile(ksFile, 'IncorrectPassphrase');
      }).toThrow(/invalid passphrase/i);
    });

    test('2.3 should require passphrase in production mode when saving', () => {
      const prevEnv = process.env.NODE_ENV;
      try {
        process.env.NODE_ENV = 'production';
        const ks = KeyStore.fromCredentials({
          validatorId: 'VAL-01',
          consensus: sampleEd25519
        });
        const ksFile = path.join(tempDir, 'prod-unencrypted.json');
        expect(() => {
          ks.saveToFile(ksFile); // no passphrase
        }).toThrow(/Passphrase is required/i);
      } finally {
        process.env.NODE_ENV = prevEnv;
      }
    });
  });

  describe('3. Secret Redaction & In-Memory Destruction', () => {
    test('3.1 toSafeObject, toJSON, and toString should never expose private keys', () => {
      const ks = KeyStore.fromCredentials({
        validatorId: 'VAL-01',
        consensus: sampleEd25519,
        transport: {
          cert: sampleTransportCert,
          key: sampleTransportKey
        }
      });

      const safe = ks.toSafeObject();
      expect(safe.validatorId).toBe('VAL-01');
      expect(safe.hasConsensusKey).toBe(true);
      expect(safe.hasTransportKey).toBe(true);
      expect(safe.consensusAddress).toBe(sampleEd25519.address);

      const json = JSON.stringify(ks);
      expect(json).not.toContain(sampleEd25519.privateKey);
      expect(json).not.toContain(sampleTransportKey);

      const str = ks.toString();
      expect(str).not.toContain('PRIVATE KEY');
    });

    test('3.2 destroy should zero and clear private keys from memory', () => {
      const ks = KeyStore.fromCredentials({
        validatorId: 'VAL-01',
        consensus: sampleEd25519,
        transport: {
          cert: sampleTransportCert,
          key: sampleTransportKey
        }
      });

      ks.destroy();

      expect(ks.isUnlocked()).toBe(false);
      expect(() => ks.getConsensusPrivateKey()).toThrow(/destroyed/i);
      expect(() => ks.getTransportPrivateKey()).toThrow(/destroyed/i);
    });
  });
});

