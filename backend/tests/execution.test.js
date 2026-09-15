const { sequelize } = require('../src/config/database');
const { seedDatabase } = require('../src/seed/seedDatabase');
const executionEngine = require('../src/execution/ExecutionEngine');
const stateManager = require('../src/execution/StateManager');
const Transaction = require('../src/blockchain/Transaction');
const { calculateMerkleRoot, getMerkleTree } = require('../src/blockchain/merkle');
const Beneficiary = require('../src/models/Beneficiary');
const Inventory = require('../src/models/Inventory');

describe('Execution Layer & Conceptual Transaction Test Suite', () => {
  beforeAll(async () => {
    await seedDatabase(true);
  });

  afterAll(async () => {
    await sequelize.close();
  });

  describe('Blockchain Transaction Representation', () => {
    it('should construct a valid Transaction instance with default and PDS fields', () => {
      const tx = new Transaction({
        transactionId: 'TXN-TEST-100',
        sender: 'BEN-1001',
        receiver: 'FPS-102',
        payload: { commodity: 'Rice', quantity: 5, unit: 'KG' }
      });

      expect(tx.transactionId).toBe('TXN-TEST-100');
      expect(tx.beneficiaryId).toBe('BEN-1001');
      expect(tx.shopId).toBe('FPS-102');
      expect(tx.commodity).toBe('Rice');
      expect(tx.quantity).toBe(5);
      expect(tx.calculateHash()).toBeDefined();
      expect(typeof tx.calculateHash()).toBe('string');
    });

    it('should correctly format block payload and JSON serialization', () => {
      const tx = Transaction.fromPDS({
        transactionId: 'TXN-PDS-01',
        beneficiaryId: 'BEN-1002',
        shopId: 'FPS-101',
        commodity: 'Wheat',
        quantity: 8,
        name: 'Priya Sharma'
      });

      const blockPayload = tx.toBlockPayload();
      expect(blockPayload.transactionId).toBe('TXN-PDS-01');
      expect(blockPayload.beneficiaryId).toBe('BEN-1002');
      expect(blockPayload.quantity).toBe('8 KG');

      const json = tx.toJSON();
      expect(json.version).toBe('1.0');
      expect(json.type).toBe('DISTRIBUTION');
      expect(json.sender).toBe('BEN-1002');
    });
  });

  describe('Dedicated Merkle Tree Module', () => {
    it('should compute deterministic Merkle root for transactions', () => {
      const tx1 = new Transaction({ transactionId: 'TX-1', sender: 'BEN-1', receiver: 'FPS-1', payload: { commodity: 'Rice', quantity: 5 } });
      const tx2 = new Transaction({ transactionId: 'TX-2', sender: 'BEN-2', receiver: 'FPS-1', payload: { commodity: 'Wheat', quantity: 10 } });

      const root = calculateMerkleRoot([tx1, tx2]);
      expect(root).toBeDefined();
      expect(root.length).toBe(64); // SHA-256 hex length

      const tree = getMerkleTree([tx1, tx2]);
      expect(tree.length).toBe(2);
      expect(tree[tree.length - 1][0]).toBe(root);
    });
  });

  describe('StateManager', () => {
    it('should fetch beneficiary and shop state accurately', async () => {
      const ben = await stateManager.getBeneficiaryState('BEN-1001');
      expect(ben.beneficiaryId).toBe('BEN-1001');
      expect(ben.status).toBe('Active');

      const shopInv = await stateManager.getShopInventoryState('FPS-102', 'Rice');
      expect(shopInv.ownerId).toBe('FPS-102');
      expect(shopInv.commodityName).toBe('Rice');
    });
  });

  describe('ExecutionEngine', () => {
    it('should pre-validate valid transaction against state', async () => {
      const tx = new Transaction({
        transactionId: 'TXN-EXEC-VALID',
        sender: 'BEN-1004',
        receiver: 'FPS-104',
        payload: { commodity: 'Rice', quantity: 2 }
      });

      const validation = await executionEngine.validateTransaction(tx);
      expect(validation.valid).toBe(true);
      expect(validation.remainingQuota).toBeGreaterThanOrEqual(2);
      expect(validation.availableStock).toBeGreaterThanOrEqual(2);
    });

    it('should reject transaction exceeding quota in ExecutionEngine', async () => {
      const tx = new Transaction({
        transactionId: 'TXN-EXEC-EXCEED',
        sender: 'BEN-1004',
        receiver: 'FPS-104',
        payload: { commodity: 'Sugar', quantity: 100 } // Entitlement is only 2 KG
      });

      await expect(executionEngine.validateTransaction(tx)).rejects.toThrow(/exceeds remaining monthly quota/i);
    });

    it('should atomically execute state transitions and return verifiable receipt', async () => {
      const tx = new Transaction({
        transactionId: 'TXN-EXEC-RUN',
        sender: 'BEN-1024',
        receiver: 'FPS-102',
        payload: { commodity: 'Rice', quantity: 5, name: 'Arun Kumar' }
      });

      const initialBen = await Beneficiary.findOne({ where: { beneficiaryId: 'BEN-1024' } });
      const initialClaimed = initialBen.currentMonthClaimed.Rice || 0;

      const initialInv = await Inventory.findOne({ where: { ownerType: 'SHOP', ownerId: 'FPS-102', commodityName: 'Rice' } });
      const initialStock = initialInv.quantity;

      const execution = await executionEngine.executeTransaction(tx, {
        blockNumber: 42,
        blockHash: '0x1234567890abcdef',
        transactionHash: '0xabcdef1234567890'
      });

      expect(execution.success).toBe(true);
      expect(execution.receipt).toBeDefined();
      expect(execution.receipt.receiptNumber).toBe('REC-EXEC-RUN');
      expect(execution.receipt.verificationStatus).toBe('CRYPTOGRAPHICALLY_VERIFIED_ON_CHAIN');

      // Verify DB mutations
      const updatedBen = await Beneficiary.findOne({ where: { beneficiaryId: 'BEN-1024' } });
      expect(updatedBen.currentMonthClaimed.Rice).toBe(initialClaimed + 5);

      const updatedInv = await Inventory.findOne({ where: { ownerType: 'SHOP', ownerId: 'FPS-102', commodityName: 'Rice' } });
      expect(updatedInv.quantity).toBe(initialStock - 5);
    });
  });
});

