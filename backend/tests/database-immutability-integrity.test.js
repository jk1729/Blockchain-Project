/**
 * Phase 18: Database Authority, Immutability & Integrity Test Suite
 */

const { DatabaseIntegrityManager, DatabaseIntegrityError } = require('../src/database/DatabaseIntegrityManager');
const Block = require('../src/blockchain/Block');
const BlockModel = require('../src/models/Block');
const ReceiptModel = require('../src/models/Receipt');
const TransactionModel = require('../src/models/Transaction');
const { calculateMerkleRoot } = require('../src/blockchain/merkle');

describe('Phase 18: Database Immutability & Ledger Integrity', () => {
  let integrityManager;

  beforeEach(() => {
    integrityManager = new DatabaseIntegrityManager();
  });

  describe('1. Monotonic Finalized Height & Sequence Enforcement', () => {
    test('should allow consecutive block with matching previousHash', () => {
      const latestBlock = { blockNumber: 10, blockHash: '0x' + 'a'.repeat(64) };
      const candidate = { blockNumber: 11, previousHash: '0x' + 'a'.repeat(64) };

      expect(integrityManager.enforceMonotonicHeight(candidate, latestBlock)).toBe(true);
    });

    test('should reject finalized height regression with FINALIZED_HEIGHT_REGRESSION', () => {
      const latestBlock = { blockNumber: 10, blockHash: '0x' + 'a'.repeat(64) };
      const regressedCandidate = { blockNumber: 9, previousHash: '0x' + 'a'.repeat(64) };

      expect(() => {
        integrityManager.enforceMonotonicHeight(regressedCandidate, latestBlock);
      }).toThrow(DatabaseIntegrityError);

      try {
        integrityManager.enforceMonotonicHeight(regressedCandidate, latestBlock);
      } catch (err) {
        expect(err.code).toBe('FINALIZED_HEIGHT_REGRESSION');
      }
    });

    test('should reject block sequence gap with HEIGHT_SEQUENCE_GAP', () => {
      const latestBlock = { blockNumber: 10, blockHash: '0x' + 'a'.repeat(64) };
      const gapCandidate = { blockNumber: 12, previousHash: '0x' + 'a'.repeat(64) };

      expect(() => {
        integrityManager.enforceMonotonicHeight(gapCandidate, latestBlock);
      }).toThrow('Finalized height sequence gap detected');
    });

    test('should reject block when previousHash does not match latest block hash', () => {
      const latestBlock = { blockNumber: 10, blockHash: '0x' + 'a'.repeat(64) };
      const badHashCandidate = { blockNumber: 11, previousHash: '0x' + 'b'.repeat(64) };

      expect(() => {
        integrityManager.enforceMonotonicHeight(badHashCandidate, latestBlock);
      }).toThrow('previousHash mismatch');
    });
  });

  describe('2. Ledger Continuity & Merkle Audit', () => {
    test('should pass verification on a valid block sequence', () => {
      const b0 = new Block(0, new Date().toISOString(), [], '0', 0, 'FINALIZED');
      const b1 = new Block(1, new Date().toISOString(), [{ transactionId: 'TX-1', amount: 10 }], b0.blockHash, 0, 'FINALIZED');
      b1.consensusCertificate = {
        certificateHash: '0x' + 'c'.repeat(64),
        validatorApprovals: Array(9).fill({ validatorId: 'VAL-01', signature: 'sig' })
      };

      const result = integrityManager.verifyLedgerIntegrity([b0, b1]);
      expect(result.valid).toBe(true);
      expect(result.verifiedBlocks).toBe(2);
      expect(result.errors.length).toBe(0);
    });

    test('should catch tampered Merkle root in ledger verification', () => {
      const b0 = new Block(0, new Date().toISOString(), [], '0', 0, 'FINALIZED');
      const b1 = new Block(1, new Date().toISOString(), [{ transactionId: 'TX-1', amount: 10 }], b0.blockHash, 0, 'FINALIZED');
      b1.merkleRoot = '0x' + 'f'.repeat(64); // Tampered root

      const result = integrityManager.verifyLedgerIntegrity([b0, b1]);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('Merkle root mismatch');
    });

    test('should catch duplicate transaction across blocks', () => {
      const b0 = new Block(0, new Date().toISOString(), [], '0', 0, 'FINALIZED');
      const tx = { transactionId: 'DUPLICATE-TX' };
      const b1 = new Block(1, new Date().toISOString(), [tx], b0.blockHash, 0, 'FINALIZED');
      const b2 = new Block(2, new Date().toISOString(), [tx], b1.blockHash, 0, 'FINALIZED');

      const result = integrityManager.verifyLedgerIntegrity([b0, b1, b2]);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Duplicate transaction'))).toBe(true);
    });
  });

  describe('3. Database Model Immutability Lifecycle Hooks', () => {
    test('Block model hook should reject updating a FINALIZED block', async () => {
      const blockInstance = BlockModel.build({
        blockNumber: 999,
        blockHash: '0x999',
        previousHash: '0x000',
        timestamp: new Date().toISOString(),
        transactions: [],
        merkleRoot: '0xroot',
        consensusStatus: 'FINALIZED'
      });

      await expect(BlockModel.runHooks('beforeUpdate', blockInstance))
        .rejects.toThrow('is FINALIZED and cryptographically immutable');
    });

    test('Block model hook should reject deleting a FINALIZED block', async () => {
      const blockInstance = BlockModel.build({
        blockNumber: 999,
        blockHash: '0x999',
        previousHash: '0x000',
        timestamp: new Date().toISOString(),
        transactions: [],
        merkleRoot: '0xroot',
        consensusStatus: 'FINALIZED'
      });

      await expect(BlockModel.runHooks('beforeDestroy', blockInstance))
        .rejects.toThrow('is FINALIZED and cannot be deleted');
    });

    test('Receipt model hook should reject deleting an execution receipt', async () => {
      const receiptInstance = ReceiptModel.build({
        transactionHash: '0xtx1',
        transactionId: 'TX-1',
        blockNumber: 1,
        blockHash: '0xb1',
        receiptHash: '0xr1'
      });

      await expect(ReceiptModel.runHooks('beforeDestroy', receiptInstance))
        .rejects.toThrow('is immutable and cannot be deleted');
    });

    test('Transaction model hook should reject mutating a Verified transaction', async () => {
      const txInstance = TransactionModel.build({
        transactionId: 'TX-100',
        beneficiaryId: 'BEN-01',
        shopId: 'SHOP-01',
        commodity: 'RICE',
        quantity: 5,
        status: 'Verified',
        timestamp: new Date().toISOString()
      });
      txInstance._previousDataValues = { status: 'Verified' };

      await expect(TransactionModel.runHooks('beforeUpdate', txInstance))
        .rejects.toThrow('is already Verified and cannot be mutated');
    });
  });
});
