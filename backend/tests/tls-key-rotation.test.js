/**
 * PHASE 12: Consensus Key Rotation & Historical Key Retention Test Suite
 */

const crypto = require('crypto');
const { KeyRotationManager, KeyRotationError } = require('../src/security/KeyRotationManager');
const { generateKeyPair } = require('../src/blockchain/identity/keyManager');

describe('PHASE 12: Consensus Key Rotation & Historical Verification Suite', () => {
  let keyPair1;
  let keyPair2;
  let keyPair3;

  beforeAll(() => {
    keyPair1 = generateKeyPair();
    keyPair2 = generateKeyPair();
    keyPair3 = generateKeyPair();
  });

  describe('1. Key Staging & Height-Based Activation', () => {
    test('1.1 should initialize with initial consensus key active from height 0', () => {
      const krm = new KeyRotationManager({
        validatorId: 'VAL-01',
        initialPublicKey: keyPair1.publicKey,
        initialPrivateKey: keyPair1.privateKey,
        initialAddress: keyPair1.address,
        startHeight: 0
      });

      const status = krm.getStatus();
      expect(status.validatorId).toBe('VAL-01');
      expect(status.currentPublicKey).toBe(keyPair1.publicKey);
      expect(status.currentStartHeight).toBe(0);
      expect(status.hasStagedKey).toBe(false);
      expect(status.rotationCount).toBe(0);
    });

    test('1.2 should stage key for future height and emit staged event', (done) => {
      const krm = new KeyRotationManager({
        validatorId: 'VAL-01',
        initialPublicKey: keyPair1.publicKey,
        initialPrivateKey: keyPair1.privateKey,
        startHeight: 0
      });

      krm.on('staged', (event) => {
        expect(event.validatorId).toBe('VAL-01');
        expect(event.activationHeight).toBe(100);
        expect(event.publicKey).toBe(keyPair2.publicKey);
        done();
      });

      const staged = krm.stageKey(keyPair2, 100);
      expect(staged.activationHeight).toBe(100);
      expect(krm.getStatus().hasStagedKey).toBe(true);
      expect(krm.getStatus().stagedActivationHeight).toBe(100);
    });

    test('1.3 should reject staging key at past or current height', () => {
      const krm = new KeyRotationManager({
        validatorId: 'VAL-01',
        initialPublicKey: keyPair1.publicKey,
        startHeight: 50
      });

      expect(() => {
        krm.stageKey(keyPair2, 50);
      }).toThrow(KeyRotationError);

      expect(() => {
        krm.stageKey(keyPair2, 30);
      }).toThrow(KeyRotationError);
    });

    test('1.4 should generate verifiable cryptographic rotation announcement signed by active key', () => {
      const krm = new KeyRotationManager({
        validatorId: 'VAL-01',
        initialPublicKey: keyPair1.publicKey,
        initialPrivateKey: keyPair1.privateKey,
        startHeight: 0
      });

      krm.stageKey(keyPair2, 100);
      const announcement = krm.createRotationAnnouncement(50);

      expect(announcement.payload.validatorId).toBe('VAL-01');
      expect(announcement.payload.oldPublicKey).toBe(keyPair1.publicKey);
      expect(announcement.payload.newPublicKey).toBe(keyPair2.publicKey);
      expect(announcement.payload.activationHeight).toBe(100);

      // Verify signature with old key
      const digest = crypto.createHash('sha256').update(JSON.stringify(announcement.payload)).digest();
      const verified = crypto.verify(
        null,
        digest,
        crypto.createPublicKey({ key: Buffer.from(keyPair1.publicKey, 'hex'), format: 'der', type: 'spki' }),
        Buffer.from(announcement.signature, 'hex')
      );
      expect(verified).toBe(true);
    });
  });

  describe('2. Atomic Rotation & Historical Key Retention', () => {
    test('2.1 should not activate staged key before reaching activation height', () => {
      const krm = new KeyRotationManager({
        validatorId: 'VAL-01',
        initialPublicKey: keyPair1.publicKey,
        initialPrivateKey: keyPair1.privateKey,
        startHeight: 0
      });

      krm.stageKey(keyPair2, 100);
      const rotated = krm.checkAndActivate(99);
      expect(rotated).toBe(false);
      expect(krm.getStatus().currentPublicKey).toBe(keyPair1.publicKey);
    });

    test('2.2 should activate key at activation height and update history', (done) => {
      const krm = new KeyRotationManager({
        validatorId: 'VAL-01',
        initialPublicKey: keyPair1.publicKey,
        initialPrivateKey: keyPair1.privateKey,
        startHeight: 0
      });

      krm.stageKey(keyPair2, 100);

      krm.on('activated', (evt) => {
        expect(evt.activatedAtHeight).toBe(100);
        expect(evt.oldPublicKey).toBe(keyPair1.publicKey);
        expect(evt.newPublicKey).toBe(keyPair2.publicKey);
        done();
      });

      const rotated = krm.checkAndActivate(100);
      expect(rotated).toBe(true);
      expect(krm.getStatus().currentPublicKey).toBe(keyPair2.publicKey);
      expect(krm.getStatus().rotationCount).toBe(1);
    });

    test('2.3 should correctly resolve historical public keys across multiple rotation epochs', () => {
      const krm = new KeyRotationManager({
        validatorId: 'VAL-01',
        initialPublicKey: keyPair1.publicKey,
        initialPrivateKey: keyPair1.privateKey,
        startHeight: 0
      });

      // Epoch 1: #0 - #99 -> keyPair1
      krm.stageKey(keyPair2, 100);
      krm.checkAndActivate(100);

      // Epoch 2: #100 - #249 -> keyPair2
      krm.stageKey(keyPair3, 250);
      krm.checkAndActivate(250);

      // Epoch 3: #250+ -> keyPair3

      // Verify historical query for Epoch 1
      const atBlock0 = krm.getPublicKeyForHeight(0);
      expect(atBlock0.publicKey).toBe(keyPair1.publicKey);
      expect(atBlock0.startHeight).toBe(0);
      expect(atBlock0.endHeight).toBe(99);

      const atBlock50 = krm.getPublicKeyForHeight(50);
      expect(atBlock50.publicKey).toBe(keyPair1.publicKey);

      // Verify historical query for Epoch 2
      const atBlock100 = krm.getPublicKeyForHeight(100);
      expect(atBlock100.publicKey).toBe(keyPair2.publicKey);
      expect(atBlock100.startHeight).toBe(100);
      expect(atBlock100.endHeight).toBe(249);

      const atBlock200 = krm.getPublicKeyForHeight(200);
      expect(atBlock200.publicKey).toBe(keyPair2.publicKey);

      // Verify query for active Epoch 3
      const atBlock250 = krm.getPublicKeyForHeight(250);
      expect(atBlock250.publicKey).toBe(keyPair3.publicKey);
      expect(atBlock250.startHeight).toBe(250);
      expect(atBlock250.endHeight).toBe(Infinity);

      const atBlock500 = krm.getPublicKeyForHeight(500);
      expect(atBlock500.publicKey).toBe(keyPair3.publicKey);
    });

    test('2.4 status and serialization should never expose private keys', () => {
      const krm = new KeyRotationManager({
        validatorId: 'VAL-01',
        initialPublicKey: keyPair1.publicKey,
        initialPrivateKey: keyPair1.privateKey,
        startHeight: 0
      });

      const serialized = JSON.stringify(krm);
      expect(serialized).not.toContain(keyPair1.privateKey);
      expect(serialized).not.toContain('privateKey');
    });
  });
});

