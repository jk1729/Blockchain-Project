const request = require('supertest');
const app = require('../src/app');
const { sequelize } = require('../src/config/database');
const { seedDatabase } = require('../src/seed/seedDatabase');
const { generateKeyPair, deriveAddress, getOrCreateDevParticipant, getPublicParticipantInfo, getParticipantPrivateKey } = require('../src/blockchain/identity/keyManager');
const { signTransaction, verifyTransactionSignature } = require('../src/blockchain/identity/signature');
const Identity = require('../src/blockchain/identity/Identity');
const { serializeCanonical, hashCanonical, extractUnsignedFields, serializeUnsignedTransaction, generateDeterministicTxId } = require('../src/blockchain/serialization');
const Transaction = require('../src/blockchain/Transaction');
const stateManager = require('../src/execution/StateManager');
const executionEngine = require('../src/execution/ExecutionEngine');
const fbaInstance = require('../src/consensus/FBAConsensus');
const ValidatorNode = require('../src/consensus/ValidatorNode');
const transactionService = require('../src/services/transactionService');

describe('PDSChain Cryptographic Identity & Signed Transactions Test Suite', () => {
  beforeAll(async () => {
    await seedDatabase(true);
  });

  afterAll(async () => {
    await sequelize.close();
  });

  describe('1. Key Generation & Address Derivation', () => {
    it('1. should generate a valid Ed25519 key pair with address', () => {
      const keyPair = generateKeyPair();
      expect(keyPair.publicKey).toBeDefined();
      expect(keyPair.privateKey).toBeDefined();
      expect(keyPair.address).toBeDefined();
      expect(keyPair.address.startsWith('PDS1')).toBe(true);
      expect(keyPair.address.length).toBe(44); // 'PDS1' + 40 hex chars
    });

    it('2. should generate a deterministic address from public key', () => {
      const keyPair = generateKeyPair();
      const derived = deriveAddress(keyPair.publicKey);
      expect(derived).toBe(keyPair.address);
    });

    it('3. should generate the exact same address for the same public key', () => {
      const pubKey = '302a300506032b6570032100a9f4c82e3b77011234567890abcdef1234567890abcdef1234567890abcdef12';
      const addr1 = deriveAddress(pubKey);
      const addr2 = deriveAddress(pubKey);
      expect(addr1).toBe(addr2);
    });

    it('4. should generate different addresses for different keys', () => {
      const pairA = generateKeyPair();
      const pairB = generateKeyPair();
      expect(pairA.address).not.toBe(pairB.address);
    });
  });

  describe('2. Canonical Serialization & Deterministic Transaction IDs', () => {
    it('15. should produce deterministic canonical serialization regardless of key insertion order', () => {
      const obj1 = {
        version: '1.0',
        sender: 'PDS1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        type: 'DISTRIBUTION',
        nonce: 1,
        payload: {
          commodity: 'Rice',
          quantity: 5
        }
      };

      const obj2 = {
        payload: {
          quantity: 5,
          commodity: 'Rice'
        },
        type: 'DISTRIBUTION',
        sender: 'PDS1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        version: '1.0',
        nonce: 1
      };

      const serialized1 = serializeCanonical(obj1);
      const serialized2 = serializeCanonical(obj2);
      expect(serialized1).toBe(serialized2);
      expect(hashCanonical(obj1)).toBe(hashCanonical(obj2));
    });

    it('16. should derive the same Transaction ID for the same transaction content', () => {
      const tx1 = new Transaction({
        version: '1.0',
        type: 'DISTRIBUTION',
        sender: 'PDS1111111111111111111111111111111111111111',
        receiver: 'FPS-101',
        payload: { commodity: 'Rice', quantity: 5 },
        timestamp: '2026-03-31T10:00:00.000Z',
        nonce: 0
      });

      const tx2 = new Transaction({
        payload: { commodity: 'Rice', quantity: 5 },
        timestamp: '2026-03-31T10:00:00.000Z',
        receiver: 'FPS-101',
        sender: 'PDS1111111111111111111111111111111111111111',
        type: 'DISTRIBUTION',
        version: '1.0',
        nonce: 0
      });

      expect(tx1.transactionId).toBe(tx2.transactionId);
    });

    it('17. should ensure property insertion order does not change transaction ID', () => {
      const base = {
        sender: 'PDS1111111111111111111111111111111111111111',
        receiver: 'FPS-102',
        payload: { commodity: 'Wheat', quantity: 10, name: 'Citizen' },
        timestamp: '2026-03-31T12:00:00.000Z',
        nonce: 3
      };

      const str1 = serializeUnsignedTransaction(base);
      const str2 = serializeUnsignedTransaction({
        timestamp: '2026-03-31T12:00:00.000Z',
        payload: { name: 'Citizen', quantity: 10, commodity: 'Wheat' },
        nonce: 3,
        receiver: 'FPS-102',
        sender: 'PDS1111111111111111111111111111111111111111'
      });

      expect(str1).toBe(str2);
      expect(generateDeterministicTxId(hashCanonical(str1))).toBe(generateDeterministicTxId(hashCanonical(str2)));
    });

    it('18. should generate a different transaction ID when nonce changes', () => {
      const txNonce0 = new Transaction({
        sender: 'PDS1111111111111111111111111111111111111111',
        receiver: 'FPS-101',
        payload: { commodity: 'Rice', quantity: 5 },
        timestamp: '2026-03-31T10:00:00.000Z',
        nonce: 0
      });

      const txNonce1 = new Transaction({
        sender: 'PDS1111111111111111111111111111111111111111',
        receiver: 'FPS-101',
        payload: { commodity: 'Rice', quantity: 5 },
        timestamp: '2026-03-31T10:00:00.000Z',
        nonce: 1
      });

      expect(txNonce0.transactionId).not.toBe(txNonce1.transactionId);
    });
  });

  describe('3. Digital Signing & Signature Verification', () => {
    let keyPair;
    let validTx;

    beforeEach(() => {
      keyPair = generateKeyPair();
      validTx = new Transaction({
        sender: keyPair.address,
        senderPublicKey: keyPair.publicKey,
        receiver: 'FPS-102',
        payload: { beneficiaryId: 'BEN-1001', commodity: 'Rice', quantity: 5 },
        timestamp: '2026-03-31T14:00:00.000Z',
        nonce: 0
      });
      validTx.sign(keyPair.privateKey, keyPair.publicKey);
    });

    it('5. should sign transaction and attach signature and deterministic ID', () => {
      expect(validTx.signature).toBeDefined();
      expect(typeof validTx.signature).toBe('string');
      expect(validTx.signature.length).toBeGreaterThan(64);
      expect(validTx.transactionId.startsWith('TXN-')).toBe(true);
    });

    it('6. should verify valid digital signature', () => {
      const result = validTx.verify(keyPair.publicKey);
      expect(result.valid).toBe(true);
    });

    it('7. should reject signature when payload commodity or quantity is modified', () => {
      const tampered = Transaction.fromJSON(validTx.toJSON());
      tampered.payload.quantity = 9999; // Tamper with quantity

      const result = tampered.verify(keyPair.publicKey);
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/INVALID_TRANSACTION_SIGNATURE|TRANSACTION_ID_MISMATCH/);
    });

    it('8. should reject signature when sender address is modified', () => {
      const tampered = Transaction.fromJSON(validTx.toJSON());
      tampered.sender = 'PDS1999999999999999999999999999999999999999';

      const result = tampered.verify(keyPair.publicKey);
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/SENDER_ADDRESS_MISMATCH|INVALID_TRANSACTION_SIGNATURE/);
    });

    it('9. should reject signature when receiver is modified', () => {
      const tampered = Transaction.fromJSON(validTx.toJSON());
      tampered.receiver = 'FPS-HACKED-999';

      const result = tampered.verify(keyPair.publicKey);
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/INVALID_TRANSACTION_SIGNATURE|TRANSACTION_ID_MISMATCH/);
    });

    it('10. should reject signature when timestamp is modified', () => {
      const tampered = Transaction.fromJSON(validTx.toJSON());
      tampered.timestamp = '2099-01-01T00:00:00.000Z';

      const result = tampered.verify(keyPair.publicKey);
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/INVALID_TRANSACTION_SIGNATURE|TRANSACTION_ID_MISMATCH/);
    });

    it('11. should reject signature when nonce is modified', () => {
      const tampered = Transaction.fromJSON(validTx.toJSON());
      tampered.nonce = 42;

      const result = tampered.verify(keyPair.publicKey);
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/INVALID_TRANSACTION_SIGNATURE|TRANSACTION_ID_MISMATCH/);
    });

    it('12. should reject signature when transaction type is modified', () => {
      const tampered = Transaction.fromJSON(validTx.toJSON());
      tampered.type = 'ILLEGAL_TOKEN_MINT';

      const result = tampered.verify(keyPair.publicKey);
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/INVALID_TRANSACTION_SIGNATURE|TRANSACTION_ID_MISMATCH/);
    });

    it('13. should reject when signature is corrupted/invalid hex', () => {
      const tampered = Transaction.fromJSON(validTx.toJSON());
      tampered.signature = '0x1234567890abcdefbadc0ffee';

      const result = tampered.verify(keyPair.publicKey);
      expect(result.valid).toBe(false);
    });

    it('14. should reject verification when signature is missing', () => {
      const unsignedTx = new Transaction({
        sender: keyPair.address,
        receiver: 'FPS-101',
        payload: { commodity: 'Rice', quantity: 5 }
      });

      const result = unsignedTx.verify(keyPair.publicKey);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('MISSING_TRANSACTION_SIGNATURE');
    });
  });

  describe('4. Nonce Sequencing & Replay Protection', () => {
    let participant;

    beforeEach(() => {
      stateManager.resetNonces();
      participant = getOrCreateDevParticipant('FPS-TEST-REPLAY', 'SHOP');
    });

    it('19. should detect and reject duplicate/replayed identical transactions', async () => {
      const tx = new Transaction({
        sender: participant.address,
        senderPublicKey: participant.publicKey,
        receiver: 'FPS-102',
        payload: { beneficiaryId: 'BEN-1001', commodity: 'Rice', quantity: 5 },
        nonce: 0
      });
      tx.sign(participant.privateKey, participant.publicKey);

      // Execute first time
      await executionEngine.executeTransaction(tx);
      expect(stateManager.isTransactionIdSeen(tx.transactionId)).toBe(true);

      // Same transaction replay rejection
      const duplicateTx = Transaction.fromJSON(tx.toJSON());
      await expect(executionEngine.validateTransaction(duplicateTx)).rejects.toThrow(/already been executed|already executed|ALREADY_APPLIED/i);
    });

    it('20. should reject previously consumed nonce on new transaction', async () => {
      // Consume nonce 0
      const tx0 = new Transaction({
        sender: participant.address,
        senderPublicKey: participant.publicKey,
        receiver: 'FPS-102',
        payload: { beneficiaryId: 'BEN-1001', commodity: 'Rice', quantity: 2 },
        nonce: 0
      });
      tx0.sign(participant.privateKey, participant.publicKey);
      await executionEngine.executeTransaction(tx0);

      expect(stateManager.getExpectedNonce(participant.address)).toBe(1);

      // Attempt second transaction reusing consumed nonce 0
      const txReplayNonce = new Transaction({
        sender: participant.address,
        senderPublicKey: participant.publicKey,
        receiver: 'FPS-102',
        payload: { beneficiaryId: 'BEN-1001', commodity: 'Rice', quantity: 1 },
        nonce: 0 // Reused nonce 0!
      });
      txReplayNonce.sign(participant.privateKey, participant.publicKey);

      await expect(executionEngine.validateTransaction(txReplayNonce)).rejects.toThrow(/REPLAYED_NONCE/i);
    });
  });

  describe('5. Validator Independent Verification', () => {
    it('23. should independently verify valid transaction proposal signature and accept', () => {
      const validator = new ValidatorNode({ validatorId: 'VAL-01', name: 'Test Validator' });
      const participant = getOrCreateDevParticipant('FPS-102', 'SHOP');

      const tx = new Transaction({
        sender: participant.address,
        senderPublicKey: participant.publicKey,
        receiver: 'FPS-102',
        payload: { beneficiaryId: 'BEN-1001', commodity: 'Rice', quantity: 5 },
        nonce: 0
      });
      tx.sign(participant.privateKey, participant.publicKey);

      const proposal = {
        transactionId: tx.transactionId,
        sender: tx.sender,
        senderPublicKey: tx.senderPublicKey,
        receiver: tx.receiver,
        commodity: 'Rice',
        quantity: 5,
        timestamp: tx.timestamp,
        nonce: tx.nonce,
        signature: tx.signature,
        payload: tx.payload
      };

      const vote = validator.evaluateProposal(proposal);
      expect(vote.vote).toBe('AGREE');
      expect(vote.signature).toBeDefined();
    });

    it('23b. should independently reject transaction proposal with tampered signature', () => {
      const validator = new ValidatorNode({ validatorId: 'VAL-01', name: 'Test Validator' });
      const participant = getOrCreateDevParticipant('FPS-102', 'SHOP');

      const proposal = {
        transactionId: 'TXN-FAKE-12345678',
        sender: participant.address,
        senderPublicKey: participant.publicKey,
        receiver: 'FPS-102',
        commodity: 'Rice',
        quantity: 5,
        timestamp: new Date().toISOString(),
        nonce: 0,
        signature: '0xBAD00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
        payload: { commodity: 'Rice', quantity: 5 }
      };

      const vote = validator.evaluateProposal(proposal);
      expect(vote.vote).toBe('REJECT');
      expect(vote.reason).toMatch(/INVALID_TRANSACTION_SIGNATURE/);
    });
  });

  describe('6. Security & Key Privacy', () => {
    it('21. should never expose private key in API responses or public identity queries', async () => {
      const res = await request(app).get('/api/blockchain/identity/FPS-102');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.identity.address).toBeDefined();
      expect(res.body.identity.publicKey).toBeDefined();
      expect(res.body.identity.privateKey).toBeUndefined();
      expect(JSON.stringify(res.body)).not.toContain('PRIVATE KEY');
    });

    it('22. should never write private keys to blockchain transaction or block payload', () => {
      const participant = getOrCreateDevParticipant('FPS-101', 'SHOP');
      const tx = new Transaction({
        sender: participant.address,
        senderPublicKey: participant.publicKey,
        receiver: 'FPS-101',
        payload: { commodity: 'Rice', quantity: 5 }
      });
      tx.sign(participant.privateKey, participant.publicKey);

      const jsonStr = JSON.stringify(tx.toJSON());
      const blockStr = JSON.stringify(tx.toBlockPayload());

      expect(jsonStr).not.toContain('PRIVATE KEY');
      expect(blockStr).not.toContain('PRIVATE KEY');
      expect(tx.toJSON().privateKey).toBeUndefined();
      expect(tx.toBlockPayload().privateKey).toBeUndefined();
    });

    it('should verify transactions via POST /api/blockchain/transactions/verify', async () => {
      const participant = getOrCreateDevParticipant('FPS-102', 'SHOP');
      const tx = new Transaction({
        sender: participant.address,
        senderPublicKey: participant.publicKey,
        receiver: 'FPS-102',
        payload: { beneficiaryId: 'BEN-1001', commodity: 'Rice', quantity: 5 },
        nonce: 0
      });
      tx.sign(participant.privateKey, participant.publicKey);

      const res = await request(app)
        .post('/api/blockchain/transactions/verify')
        .send(tx.toJSON());

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.valid).toBe(true);
    });
  });
});

