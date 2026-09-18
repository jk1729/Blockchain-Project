const fs = require('fs');
const path = require('path');
const { IdentityProvisioner, IdentityError } = require('../src/blockchain/identity/IdentityProvisioner');
const { getOrCreateDevParticipant } = require('../src/blockchain/identity/keyManager');

describe('PHASE 11: Validator Identity Provisioning & Key Management Suite', () => {
  const tmpDir = path.resolve(__dirname, 'tmp-identity-test');

  beforeAll(() => {
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }
  });

  afterAll(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  describe('1. Secure Identity Generation & Format Validation', () => {
    it('1.1 should generate a valid Ed25519 identity with PDS1 address', () => {
      const identity = IdentityProvisioner.generate('VAL-01', { institution: 'Ministry of Consumer Affairs' });
      expect(identity.validatorId).toBe('VAL-01');
      expect(identity.address).toMatch(/^PDS1[0-9a-f]{40}$/);
      expect(identity.publicKey).toBeDefined();
      expect(identity.privateKey).toContain('BEGIN PRIVATE KEY');
      expect(identity.metadata.institution).toBe('Ministry of Consumer Affairs');
      expect(IdentityProvisioner.validateIdentity(identity)).toBe(true);
    });

    it('1.2 should generate distinct keys for successive calls (non-deterministic production keys)', () => {
      const id1 = IdentityProvisioner.generate('VAL-01');
      const id2 = IdentityProvisioner.generate('VAL-01');
      expect(id1.publicKey).not.toBe(id2.publicKey);
      expect(id1.privateKey).not.toBe(id2.privateKey);
      expect(id1.address).not.toBe(id2.address);
    });

    it('1.3 should reject missing or invalid validatorId on generation', () => {
      expect(() => IdentityProvisioner.generate('')).toThrow(IdentityError);
      expect(() => IdentityProvisioner.generate(null)).toThrow(IdentityError);
    });
  });

  describe('2. File Persistence & Protected Storage', () => {
    it('2.1 should save and reload identity file successfully', () => {
      const identity = IdentityProvisioner.generate('VAL-02');
      const filePath = path.join(tmpDir, 'val-02-identity.json');

      IdentityProvisioner.saveToFile(filePath, identity);
      expect(fs.existsSync(filePath)).toBe(true);

      const loaded = IdentityProvisioner.loadFromFile(filePath, 'VAL-02');
      expect(loaded.validatorId).toBe('VAL-02');
      expect(loaded.address).toBe(identity.address);
      expect(loaded.publicKey).toBe(identity.publicKey);
      expect(loaded.privateKey).toBe(identity.privateKey);
    });

    it('2.2 should prevent accidental identity replacement without overwrite flag', () => {
      const identity1 = IdentityProvisioner.generate('VAL-03');
      const identity2 = IdentityProvisioner.generate('VAL-03');
      const filePath = path.join(tmpDir, 'val-03-identity.json');

      IdentityProvisioner.saveToFile(filePath, identity1);
      expect(() => IdentityProvisioner.saveToFile(filePath, identity2)).toThrow(/already exists/);

      // Overwrite allowed when explicit
      IdentityProvisioner.saveToFile(filePath, identity2, { overwrite: true });
      const reloaded = IdentityProvisioner.loadFromFile(filePath);
      expect(reloaded.address).toBe(identity2.address);
    });

    it('2.3 should reject loading if validatorId mismatches expected', () => {
      const identity = IdentityProvisioner.generate('VAL-04');
      const filePath = path.join(tmpDir, 'val-04-identity.json');
      IdentityProvisioner.saveToFile(filePath, identity);

      expect(() => IdentityProvisioner.loadFromFile(filePath, 'VAL-05')).toThrow(/does not match expected/);
    });

    it('2.4 should fail to load non-existent identity file', () => {
      expect(() => IdentityProvisioner.loadFromFile(path.join(tmpDir, 'non-existent.json'))).toThrow(/not found/);
    });

    it('2.5 should reject malformed JSON file', () => {
      const badPath = path.join(tmpDir, 'bad.json');
      fs.writeFileSync(badPath, '{ bad-json ');
      expect(() => IdentityProvisioner.loadFromFile(badPath)).toThrow(/invalid JSON/);
    });
  });

  describe('3. Cryptographic Tampering & Inconsistency Detection', () => {
    it('3.1 should reject identity with tampered address', () => {
      const identity = IdentityProvisioner.generate('VAL-01');
      identity.address = 'PDS10000000000000000000000000000000000000000';
      expect(() => IdentityProvisioner.validateIdentity(identity)).toThrow(/does not match derived address/);
    });

    it('3.2 should reject identity with mismatched public and private keys', () => {
      const id1 = IdentityProvisioner.generate('VAL-01');
      const id2 = IdentityProvisioner.generate('VAL-02');
      // Swap private key
      id1.privateKey = id2.privateKey;
      expect(() => IdentityProvisioner.validateIdentity(id1)).toThrow(/signature verification failed|KEYPAIR/);
    });
  });

  describe('4. Production Environment Strictness & Dev Key Prohibition', () => {
    const originalEnv = process.env.NODE_ENV;

    afterEach(() => {
      process.env.NODE_ENV = originalEnv;
    });

    it('4.1 should prohibit deterministic dev key generation when NODE_ENV is production', () => {
      process.env.NODE_ENV = 'production';
      expect(() => getOrCreateDevParticipant('NEW-VAL-99', 'VALIDATOR')).toThrow(
        /Deterministic development keys are strictly prohibited in production mode/
      );
    });

    it('4.2 getPublicProfile should never expose private key', () => {
      const identity = IdentityProvisioner.generate('VAL-01');
      const pub = IdentityProvisioner.getPublicProfile(identity);
      expect(pub.validatorId).toBe('VAL-01');
      expect(pub.address).toBe(identity.address);
      expect(pub.publicKey).toBe(identity.publicKey);
      expect(pub.privateKey).toBeUndefined();
    });
  });
});

