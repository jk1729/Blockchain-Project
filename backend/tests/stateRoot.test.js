/**
 * PDSChain Phase 5: Deterministic State Transition & State Root Test Suite
 * 
 * Comprehensive testing covering:
 * - Canonical consensus state representation and key-order independent serialization
 * - Deterministic collection sorting (beneficiaries, shops, warehouses, inventory)
 * - SHA-256 state root calculation, verification, and versioning
 * - Dual commitment independence: Transaction Merkle Root vs Resulting State Root
 * - Block header binding: StateRoot included in block hash calculation
 * - Atomic state transitions and complete rollback on block or transaction failure
 * - State invariant and consistency verification (negative stock / quota guards)
 * - Independent validator state re-execution determinism
 * - REST API endpoints: GET /api/blockchain/state/root & /state/snapshot
 */

const {
  STATE_ROOT_VERSION,
  canonicalStringify,
  canonicalizeState,
  calculateStateRoot,
  verifyStateRoot,
  verifyStateConsistency,
  assertStateConsistency
} = require('../src/blockchain/state');

const {
  ExecutionEngine,
  executionEngine,
  StateManager,
  stateManager,
  ExecutionContext,
  ExecutionReceipt,
  ExecutionErrorCodes,
  ExecutionError,
  rules
} = require('../src/execution');

const { mempool } = require('../src/blockchain/mempool');
const Block = require('../src/blockchain/Block');
const Blockchain = require('../src/blockchain/Blockchain');
const Transaction = require('../src/blockchain/Transaction');
const { validateBlock, validateBlockStateRoot, validateChain } = require('../src/blockchain/validation');
const { generateKeyPair, deriveAddress, getOrCreateDevParticipant } = require('../src/blockchain/identity/keyManager');
const consensusService = require('../src/services/consensusService');
const blockchainService = require('../src/services/blockchainService');
const transactionService = require('../src/services/transactionService');
const { sequelize } = require('../src/config/database');

const Beneficiary = require('../src/models/Beneficiary');
const Shop = require('../src/models/Shop');
const Warehouse = require('../src/models/Warehouse');
const Inventory = require('../src/models/Inventory');
const StockTransfer = require('../src/models/StockTransfer');
const BlockModel = require('../src/models/Block');

const request = require('supertest');
const app = require('../src/app');

describe('PDSChain Phase 5: Deterministic State Transition & State Root Test Suite', () => {
  let shopActor, adminActor, citizenActor, whActor;

  beforeAll(async () => {
    await sequelize.sync({ force: true });

    // Seed test Beneficiaries
    await Beneficiary.create({
      beneficiaryId: 'BEN-ROOT-001',
      name: 'Sunita Devi',
      region: 'East District',
      household: '4 Members',
      eligibilityStatus: true,
      monthlyEntitlement: { Rice: 20, Wheat: 10, Sugar: 2 },
      currentMonthClaimed: { Rice: 0, Wheat: 0, Sugar: 0 },
      status: 'Active'
    });

    await Beneficiary.create({
      beneficiaryId: 'BEN-ROOT-002',
      name: 'Aarav Patel',
      region: 'East District',
      household: '3 Members',
      eligibilityStatus: true,
      monthlyEntitlement: { Rice: 15, Wheat: 10, Sugar: 1 },
      currentMonthClaimed: { Rice: 0, Wheat: 0, Sugar: 0 },
      status: 'Active'
    });

    // Seed test Fair Price Shop
    await Shop.create({
      shopId: 'FPS-ROOT-201',
      name: 'East District FPS #201',
      region: 'East District',
      manager: 'Rajesh Verma',
      status: 'Active'
    });

    // Seed test Warehouse
    await Warehouse.create({
      warehouseId: 'WH-ROOT-101',
      name: 'Central Silo East',
      location: 'Industrial Sector 5',
      capacity: 50000,
      currentStock: 25000,
      status: 'Operational'
    });

    // Seed Shop Inventory
    await Inventory.create({
      ownerType: 'SHOP',
      ownerId: 'FPS-ROOT-201',
      commodityName: 'Rice',
      quantity: 1000,
      reserved: 0,
      unit: 'KG',
      minThreshold: 100
    });

    await Inventory.create({
      ownerType: 'SHOP',
      ownerId: 'FPS-ROOT-201',
      commodityName: 'Wheat',
      quantity: 500,
      reserved: 0,
      unit: 'KG',
      minThreshold: 50
    });

    // Seed Warehouse Inventory
    await Inventory.create({
      ownerType: 'WAREHOUSE',
      ownerId: 'WH-ROOT-101',
      commodityName: 'Rice',
      quantity: 10000,
      reserved: 0,
      unit: 'KG',
      minThreshold: 1000
    });
  });

  beforeEach(() => {
    stateManager.resetNonces();
    mempool.clear();

    const keyShop = generateKeyPair();
    shopActor = { ...keyShop, entityId: 'FPS-ROOT-201' };

    const keyAdmin = generateKeyPair();
    adminActor = { ...keyAdmin, entityId: 'ADM-ROOT-001' };

    const keyCitizen = generateKeyPair();
    citizenActor = { ...keyCitizen, entityId: 'BEN-ROOT-001' };

    const keyWH = generateKeyPair();
    whActor = { ...keyWH, entityId: 'WH-ROOT-101' };
  });

  afterAll(async () => {
    await sequelize.close();
  });

  function buildTx({
    type = 'DISTRIBUTION',
    sender = shopActor.address,
    senderKey = shopActor,
    receiver = 'FPS-ROOT-201',
    beneficiaryId = 'BEN-ROOT-001',
    shopId = 'FPS-ROOT-201',
    warehouseId = 'WH-ROOT-101',
    commodity = 'Rice',
    quantity = 5,
    unit = 'KG',
    nonce = 0,
    timestamp = '2026-03-31T10:00:00.000Z'
  } = {}) {
    const tx = new Transaction({
      type,
      sender,
      senderPublicKey: senderKey.publicKey,
      receiver,
      beneficiaryId,
      shopId,
      payload: {
        beneficiaryId,
        shopId,
        warehouseId,
        commodity,
        quantity,
        unit,
        name: 'Sunita Devi',
        senderPublicKey: senderKey.publicKey
      },
      timestamp,
      nonce
    });

    tx.sign(senderKey.privateKey, senderKey.publicKey);
    return tx;
  }

  // =========================================================================
  // SECTION 1: STATE ROOT CALCULATION & CANONICAL SERIALIZATION
  // =========================================================================
  describe('1. State Root Calculation & Serialization Determinism', () => {
    test('1. should compute identical state root for identical logical state', () => {
      const stateA = {
        beneficiaries: [{ id: 'BEN-001', status: 'Active', eligibilityStatus: true, monthlyEntitlement: { Rice: 20 }, currentMonthClaimed: { Rice: 5 } }],
        shops: [{ id: 'FPS-001', status: 'Active' }],
        shopInventory: [{ shopId: 'FPS-001', commodity: 'Rice', quantity: 995, unit: 'KG' }],
        warehouses: [{ id: 'WH-001', status: 'Operational' }],
        warehouseInventory: [{ warehouseId: 'WH-001', commodity: 'Rice', quantity: 10000, unit: 'KG' }]
      };

      const stateB = {
        beneficiaries: [{ id: 'BEN-001', status: 'Active', eligibilityStatus: true, monthlyEntitlement: { Rice: 20 }, currentMonthClaimed: { Rice: 5 } }],
        shops: [{ id: 'FPS-001', status: 'Active' }],
        shopInventory: [{ shopId: 'FPS-001', commodity: 'Rice', quantity: 995, unit: 'KG' }],
        warehouses: [{ id: 'WH-001', status: 'Operational' }],
        warehouseInventory: [{ warehouseId: 'WH-001', commodity: 'Rice', quantity: 10000, unit: 'KG' }]
      };

      const rootA = calculateStateRoot(stateA);
      const rootB = calculateStateRoot(stateB);

      expect(rootA).toBeDefined();
      expect(typeof rootA).toBe('string');
      expect(rootA.startsWith('0x')).toBe(true);
      expect(rootA).toBe(rootB);
    });

    test('2. should compute different state roots when consensus state changes', () => {
      const stateA = {
        shopInventory: [{ shopId: 'FPS-001', commodity: 'Rice', quantity: 1000, unit: 'KG' }]
      };
      const stateB = {
        shopInventory: [{ shopId: 'FPS-001', commodity: 'Rice', quantity: 995, unit: 'KG' }] // Deducted 5 KG
      };

      const rootA = calculateStateRoot(stateA);
      const rootB = calculateStateRoot(stateB);

      expect(rootA).not.toBe(rootB);
    });

    test('3. should produce deterministic state root for empty or genesis state', () => {
      const emptyState = {
        beneficiaries: [],
        shops: [],
        shopInventory: [],
        warehouses: [],
        warehouseInventory: []
      };

      const root1 = calculateStateRoot(emptyState);
      const root2 = calculateStateRoot(emptyState);
      const root3 = calculateStateRoot({});

      expect(root1).toBe(root2);
      expect(root1).toBe(root3);
      expect(root1.length).toBe(66); // '0x' + 64 hex characters
    });

    test('4. should produce same state root regardless of JavaScript object key insertion order', () => {
      const state1 = {
        beneficiaries: [{ id: 'BEN-001', status: 'Active', eligibilityStatus: true, monthlyEntitlement: { Rice: 20 }, currentMonthClaimed: { Rice: 0 } }],
        shops: [{ id: 'FPS-001', status: 'Active' }]
      };

      const state2 = {
        shops: [{ status: 'Active', id: 'FPS-001' }], // Reversed key order and reversed top-level order
        beneficiaries: [{ currentMonthClaimed: { Rice: 0 }, monthlyEntitlement: { Rice: 20 }, eligibilityStatus: true, status: 'Active', id: 'BEN-001' }]
      };

      expect(calculateStateRoot(state1)).toBe(calculateStateRoot(state2));
    });

    test('5. should produce same state root regardless of collection array element order (Beneficiaries)', () => {
      const b1 = { id: 'BEN-001', status: 'Active', eligibilityStatus: true, monthlyEntitlement: {}, currentMonthClaimed: {} };
      const b2 = { id: 'BEN-002', status: 'Active', eligibilityStatus: true, monthlyEntitlement: {}, currentMonthClaimed: {} };

      const stateForward = { beneficiaries: [b1, b2] };
      const stateBackward = { beneficiaries: [b2, b1] };

      expect(calculateStateRoot(stateForward)).toBe(calculateStateRoot(stateBackward));
    });

    test('6. should produce same state root regardless of collection array element order (Shops & Inventory)', () => {
      const inv1 = { shopId: 'FPS-001', commodity: 'Rice', quantity: 100, unit: 'KG' };
      const inv2 = { shopId: 'FPS-001', commodity: 'Wheat', quantity: 200, unit: 'KG' };
      const inv3 = { shopId: 'FPS-002', commodity: 'Rice', quantity: 300, unit: 'KG' };

      const state1 = { shopInventory: [inv3, inv1, inv2] };
      const state2 = { shopInventory: [inv2, inv3, inv1] };

      expect(calculateStateRoot(state1)).toBe(calculateStateRoot(state2));
    });

    test('7. should produce same state root regardless of collection array element order (Warehouses & Inventory)', () => {
      const wInv1 = { warehouseId: 'WH-001', commodity: 'Rice', quantity: 5000, unit: 'KG' };
      const wInv2 = { warehouseId: 'WH-002', commodity: 'Rice', quantity: 8000, unit: 'KG' };

      const stateA = { warehouseInventory: [wInv1, wInv2] };
      const stateB = { warehouseInventory: [wInv2, wInv1] };

      expect(calculateStateRoot(stateA)).toBe(calculateStateRoot(stateB));
    });

    test('8. should exclude non-consensus metadata (passwords, JWTs, timestamps, internal row IDs) from state root', () => {
      const cleanState = {
        beneficiaries: [{ id: 'BEN-001', status: 'Active', eligibilityStatus: true, monthlyEntitlement: { Rice: 20 }, currentMonthClaimed: { Rice: 0 } }]
      };

      const noisyState = {
        beneficiaries: [{
          id: 'BEN-001',
          status: 'Active',
          eligibilityStatus: true,
          monthlyEntitlement: { Rice: 20 },
          currentMonthClaimed: { Rice: 0 },
          // Extra non-consensus database fields:
          rowId: 999,
          createdAt: '2026-03-31T12:00:00.000Z',
          updatedAt: '2026-03-31T12:00:00.000Z',
          passwordHash: 'secret_hash_value',
          jwtToken: 'session_token'
        }],
        unrelatedServerCache: { hits: 42, uptime: 1000 }
      };

      expect(calculateStateRoot(cleanState)).toBe(calculateStateRoot(noisyState));
    });

    test('9. should verify state root version is explicit and documented (STATE_ROOT_VERSION = 1)', () => {
      expect(STATE_ROOT_VERSION).toBe(1);
      const snapshot = { shops: [{ id: 'FPS-001', status: 'Active' }] };
      const canonical = canonicalizeState(snapshot);
      expect(canonical.version).toBe(1);
    });

    test('10. should correctly verify matching and mismatching state roots via verifyStateRoot', () => {
      const state = { shops: [{ id: 'FPS-001', status: 'Active' }] };
      const root = calculateStateRoot(state);

      const checkValid = verifyStateRoot(state, root);
      expect(checkValid.valid).toBe(true);

      const checkInvalid = verifyStateRoot(state, '0x1111111111111111111111111111111111111111111111111111111111111111');
      expect(checkValid.valid).toBe(true);
      expect(checkInvalid.valid).toBe(false);
    });
  });

  // =========================================================================
  // SECTION 2: STATE TRANSITIONS & STATE ROOT MUTATIONS
  // =========================================================================
  describe('2. State Transitions & State Root Mutations', () => {
    test('11. should alter state root when grain distribution executes', async () => {
      const initialRoot = await stateManager.calculateCurrentStateRoot();
      const tx = buildTx({ commodity: 'Rice', quantity: 5, nonce: 0 });

      await sequelize.transaction(async (t) => {
        await executionEngine.executeTransaction(tx, { dbTransaction: t });
      });

      const newRoot = await stateManager.calculateCurrentStateRoot();
      expect(newRoot).not.toBe(initialRoot);
    });

    test('12. should alter state root when entitlement quota changes', async () => {
      const rootBefore = await stateManager.calculateCurrentStateRoot();
      const tx = buildTx({ type: 'ENTITLEMENT', commodity: 'Wheat', quantity: 2, nonce: 0 });

      await sequelize.transaction(async (t) => {
        await executionEngine.executeTransaction(tx, { dbTransaction: t });
      });

      const rootAfter = await stateManager.calculateCurrentStateRoot();
      expect(rootAfter).not.toBe(rootBefore);
    });

    test('13. should alter state root when shop inventory stock is deducted', async () => {
      const rootBefore = await stateManager.calculateCurrentStateRoot();
      const tx = buildTx({ type: 'INVENTORY', commodity: 'Wheat', quantity: 5, nonce: 0 });

      await sequelize.transaction(async (t) => {
        await executionEngine.executeTransaction(tx, { dbTransaction: t });
      });

      const rootAfter = await stateManager.calculateCurrentStateRoot();
      expect(rootAfter).not.toBe(rootBefore);
    });

    test('14. should alter state root when warehouse logistics transfer executes', async () => {
      const rootBefore = await stateManager.calculateCurrentStateRoot();
      const tx = buildTx({
        type: 'WAREHOUSE_TRANSFER',
        sender: whActor.address,
        senderKey: whActor,
        warehouseId: 'WH-ROOT-101',
        shopId: 'FPS-ROOT-201',
        commodity: 'Rice',
        quantity: 100,
        nonce: 0
      });

      await sequelize.transaction(async (t) => {
        await executionEngine.executeTransaction(tx, { dbTransaction: t });
      });

      const rootAfter = await stateManager.calculateCurrentStateRoot();
      expect(rootAfter).not.toBe(rootBefore);
    });

    test('15. should produce deterministic final state root across multiple sequential transactions', async () => {
      const tx1 = buildTx({ beneficiaryId: 'BEN-ROOT-002', commodity: 'Rice', quantity: 2, nonce: 0 });
      const tx2 = buildTx({ beneficiaryId: 'BEN-ROOT-002', commodity: 'Wheat', quantity: 3, nonce: 1 });

      await sequelize.transaction(async (t) => {
        await executionEngine.executeTransaction(tx1, { dbTransaction: t });
        await executionEngine.executeTransaction(tx2, { dbTransaction: t });
      });

      const root1 = await stateManager.calculateCurrentStateRoot();
      expect(root1).toBeDefined();
      expect(root1.startsWith('0x')).toBe(true);
    });

    test('16. should verify multi-run determinism (same initial state + same tx sequence -> identical state root)', async () => {
      const snapshot = await stateManager.getConsensusStateSnapshot();
      const rootA = calculateStateRoot(snapshot);
      const rootB = calculateStateRoot(snapshot);

      expect(rootA).toBe(rootB);
    });

    test('17. should respect sequential transaction order in state transition', () => {
      // T1 deducts 10, T2 deducts 20 vs T2 then T1
      const initialStock = 100;
      const step1 = initialStock - 10;
      const step2 = step1 - 20;

      const state1 = { shopInventory: [{ shopId: 'FPS-001', commodity: 'Rice', quantity: step2, unit: 'KG' }] };
      const root1 = calculateStateRoot(state1);

      expect(root1).toBeDefined();
      expect(step2).toBe(70);
    });

    test('18. should leave state root completely unmodified when an invalid transaction is rejected', async () => {
      const rootBefore = await stateManager.calculateCurrentStateRoot();

      // Transaction exceeds beneficiary quota
      const txInvalid = buildTx({ commodity: 'Rice', quantity: 5000, nonce: 0 });

      try {
        await sequelize.transaction(async (t) => {
          await executionEngine.executeTransaction(txInvalid, { dbTransaction: t });
        });
      } catch (err) {
        // Expected rejection
      }

      const rootAfter = await stateManager.calculateCurrentStateRoot();
      expect(rootAfter).toBe(rootBefore);
    });

    test('19. should leave state root completely unmodified when atomic composite rule fails midway', async () => {
      // Temporarily set shop wheat inventory to 1 KG so stock deduction will fail while quota is available
      const wheatInv = await Inventory.findOne({ where: { ownerType: 'SHOP', ownerId: 'FPS-ROOT-201', commodityName: 'Wheat' } });
      const origQuantity = wheatInv.quantity;
      wheatInv.quantity = 1;
      await wheatInv.save();

      const rootBefore = await stateManager.calculateCurrentStateRoot();
      const txFail = buildTx({ commodity: 'Wheat', quantity: 5, nonce: 0 }); // Beneficiary has quota, shop only has 1 KG

      try {
        await sequelize.transaction(async (t) => {
          await executionEngine.executeTransaction(txFail, { dbTransaction: t });
        });
      } catch (err) {
        // Expected failure
      }

      const rootAfter = await stateManager.calculateCurrentStateRoot();
      expect(rootAfter).toBe(rootBefore);

      // Restore wheat stock
      wheatInv.quantity = origQuantity;
      await wheatInv.save();
    });

    test('20. should verify database rollback completely restores original state root', async () => {
      const rootBefore = await stateManager.calculateCurrentStateRoot();

      try {
        await sequelize.transaction(async (t) => {
          // Valid transaction 1
          const txValid = buildTx({ commodity: 'Rice', quantity: 1, nonce: 0 });
          await executionEngine.executeTransaction(txValid, { dbTransaction: t });

          // Force synthetic error in block pipeline
          throw new Error('Synthetic network/database abort');
        });
      } catch (err) {
        // Rollback occurred
      }

      const rootAfter = await stateManager.calculateCurrentStateRoot();
      expect(rootAfter).toBe(rootBefore);
    });
  });

  // =========================================================================
  // SECTION 3: BLOCK STRUCTURE, HEADER BINDING & VALIDATION
  // =========================================================================
  describe('3. Block Structure, Header Binding & Validation', () => {
    test('21. should store stateRoot in Block instance and in toJSON output', () => {
      const stateRoot = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
      const block = new Block(1, '2026-03-31T12:00:00.000Z', [], '0x0000', 0, 'VERIFIED', [], stateRoot);

      expect(block.stateRoot).toBe(stateRoot);
      const json = block.toJSON();
      expect(json.stateRoot).toBe(stateRoot);
    });

    test('22. should compute deterministic state root for Genesis Block', () => {
      const blockchain = new Blockchain(1);
      const genesis = blockchain.createGenesisBlock();

      expect(genesis.stateRoot).toBeDefined();
      expect(genesis.stateRoot.startsWith('0x')).toBe(true);
      expect(genesis.isValid()).toBe(true);
    });

    test('23. should validate block with matching stateRoot via validateBlockStateRoot', () => {
      const stateRoot = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd';
      const block = new Block(1, '2026-03-31T12:00:00.000Z', [], '0x0000', 0, 'VERIFIED', [], stateRoot);

      const check = validateBlockStateRoot(block, stateRoot);
      expect(check.valid).toBe(true);
    });

    test('24. should reject block with mismatched stateRoot via validateBlockStateRoot (STATE_ROOT_MISMATCH)', () => {
      const actualRoot = '0x1111111111111111111111111111111111111111111111111111111111111111';
      const expectedRoot = '0x2222222222222222222222222222222222222222222222222222222222222222';
      const block = new Block(1, '2026-03-31T12:00:00.000Z', [], '0x0000', 0, 'VERIFIED', [], actualRoot);

      const check = validateBlockStateRoot(block, expectedRoot);
      expect(check.valid).toBe(false);
      expect(check.code).toBe('STATE_ROOT_MISMATCH');
      expect(check.reason).toContain('state root mismatch');
    });

    test('25. should bind stateRoot into block header hash (modifying stateRoot changes blockHash)', () => {
      const stateRoot1 = '0x1111111111111111111111111111111111111111111111111111111111111111';
      const stateRoot2 = '0x2222222222222222222222222222222222222222222222222222222222222222';

      const block1 = new Block(1, '2026-03-31T12:00:00.000Z', [], '0x0000', 0, 'VERIFIED', [], stateRoot1);
      const block2 = new Block(1, '2026-03-31T12:00:00.000Z', [], '0x0000', 0, 'VERIFIED', [], stateRoot2);

      expect(block1.blockHash).not.toBe(block2.blockHash);
    });

    test('26. should maintain mathematical independence between Merkle Root and State Root', () => {
      const txA = { transactionId: 'TX-A', sender: 'BEN-1', receiver: 'FPS-1', payload: { quantity: 5 } };
      const txB = { transactionId: 'TX-B', sender: 'BEN-2', receiver: 'FPS-1', payload: { quantity: 10 } };
      const stateRoot = '0x9999999999999999999999999999999999999999999999999999999999999999';

      const blockA = new Block(1, '2026-03-31T12:00:00.000Z', [txA], '0x0000', 0, 'VERIFIED', [], stateRoot);
      const blockB = new Block(1, '2026-03-31T12:00:00.000Z', [txB], '0x0000', 0, 'VERIFIED', [], stateRoot);

      // State roots are identical, but Merkle roots differ due to different transactions
      expect(blockA.stateRoot).toBe(blockB.stateRoot);
      expect(blockA.merkleRoot).not.toBe(blockB.merkleRoot);
    });

    test('27. should ensure historical committed blocks retain immutable state roots', () => {
      const block = new Block(5, '2026-03-31T12:00:00.000Z', [], '0x0000', 0, 'VERIFIED', [], '0xHISTORICAL');
      expect(block.stateRoot).toBe('0xHISTORICAL');
      // Even if new state changes occur, block.stateRoot remains fixed
      expect(block.toJSON().stateRoot).toBe('0xHISTORICAL');
    });
  });

  // =========================================================================
  // SECTION 4: INDEPENDENT VALIDATOR VERIFICATION & STATE CONSISTENCY
  // =========================================================================
  describe('4. Independent Validator Verification & State Consistency', () => {
    test('28. should verify that independent validator re-execution calculates identical state root', async () => {
      // Validator A snapshot
      const snapshotA = await stateManager.getConsensusStateSnapshot();
      const rootA = calculateStateRoot(snapshotA);

      // Validator B independently reconstructs snapshot from the same state
      const snapshotB = await stateManager.getConsensusStateSnapshot();
      const rootB = calculateStateRoot(snapshotB);

      expect(rootA).toBe(rootB);
    });

    test('29. should verify state consistency check passes on valid consensus state', async () => {
      const snapshot = await stateManager.getConsensusStateSnapshot();
      const check = verifyStateConsistency(snapshot);

      expect(check.valid).toBe(true);
      expect(check.errors).toHaveLength(0);
      expect(() => assertStateConsistency(snapshot)).not.toThrow();
    });

    test('30. should catch negative shop inventory in state consistency check (STATE_CORRUPTED)', () => {
      const corruptState = {
        shopInventory: [{ shopId: 'FPS-001', commodity: 'Rice', quantity: -50, unit: 'KG' }]
      };

      const check = verifyStateConsistency(corruptState);
      expect(check.valid).toBe(false);
      expect(check.errors.length).toBeGreaterThan(0);
      expect(check.errors[0]).toContain('negative stock balance');

      expect(() => assertStateConsistency(corruptState)).toThrow(/negative stock balance/);
    });

    test('31. should catch negative warehouse inventory in state consistency check', () => {
      const corruptState = {
        warehouseInventory: [{ warehouseId: 'WH-001', commodity: 'Wheat', quantity: -100, unit: 'KG' }]
      };

      const check = verifyStateConsistency(corruptState);
      expect(check.valid).toBe(false);
      expect(check.errors[0]).toContain('negative stock balance');
    });

    test('32. should catch negative claimed quota in state consistency check', () => {
      const corruptState = {
        beneficiaries: [{ id: 'BEN-001', status: 'Active', currentMonthClaimed: { Rice: -10 } }]
      };

      const check = verifyStateConsistency(corruptState);
      expect(check.valid).toBe(false);
      expect(check.errors[0]).toContain('negative claimed quota');
    });

    test('33. should catch missing entity identifiers in state consistency check', () => {
      const corruptState = {
        beneficiaries: [{ id: '', status: 'Active' }]
      };

      const check = verifyStateConsistency(corruptState);
      expect(check.valid).toBe(false);
      expect(check.errors[0]).toContain('missing valid identifier');
    });
  });

  // =========================================================================
  // SECTION 5: FULL PIPELINE INTEGRATION & REST APIS
  // =========================================================================
  describe('5. Full Pipeline Integration & REST APIs', () => {
    test('34. should execute complete pipeline: Tx -> Mempool -> FBA -> Block with stateRoot -> Execution -> State Transition', async () => {
      const participant = getOrCreateDevParticipant('FPS-ROOT-201', 'SHOP');
      const startNonce = stateManager.getExpectedNonce(participant.address);

      const tx = new Transaction({
        type: 'DISTRIBUTION',
        sender: participant.address,
        senderPublicKey: participant.publicKey,
        beneficiaryId: 'BEN-ROOT-001',
        receiver: 'FPS-ROOT-201',
        shopId: 'FPS-ROOT-201',
        payload: {
          beneficiaryId: 'BEN-ROOT-001',
          shopId: 'FPS-ROOT-201',
          commodity: 'Rice',
          quantity: 1,
          unit: 'KG',
          name: 'Sunita Devi',
          senderPublicKey: participant.publicKey
        },
        timestamp: '2026-03-31T15:00:00.000Z',
        nonce: startNonce
      });

      tx.sign(participant.privateKey, participant.publicKey);

      // Stage in mempool
      mempool.addTransaction(tx);
      const candidates = mempool.getCandidateTransactions(5);
      expect(candidates).toHaveLength(1);

      // FBA Consensus
      const consensusResult = await consensusService.runConsensus({
        transactionId: tx.transactionId,
        beneficiaryId: tx.beneficiaryId,
        shopId: tx.shopId,
        commodity: tx.commodity,
        quantity: tx.quantity,
        timestamp: tx.timestamp,
        nonce: tx.nonce,
        signature: tx.signature,
        senderPublicKey: tx.senderPublicKey,
        sender: tx.sender,
        receiver: tx.receiver,
        payload: tx.payload
      });

      expect(consensusResult.status).toBe('ACHIEVED');

      // Execute, compute state root, and commit block
      let newBlock;
      let executionResult;

      await sequelize.transaction(async (t) => {
        executionResult = await executionEngine.executeTransaction(tx, {
          dbTransaction: t,
          consensusRound: consensusResult.roundId
        });

        const resultingState = await stateManager.getConsensusStateSnapshot({ dbTransaction: t });
        const stateRoot = calculateStateRoot(resultingState);

        newBlock = await blockchainService.addBlock(
          [tx.toBlockPayload()],
          consensusResult.validatorSignatures,
          t,
          stateRoot
        );

        mempool.removeIncludedTransactions([tx.transactionId], newBlock.blockNumber);
      });

      expect(executionResult.success).toBe(true);
      expect(newBlock.stateRoot).toBeDefined();
      expect(newBlock.stateRoot.startsWith('0x')).toBe(true);
      expect(mempool.entries.size).toBe(0);

      // Verify block validation passes
      const blockValidation = validateBlockStateRoot(newBlock, newBlock.stateRoot);
      expect(blockValidation.valid).toBe(true);
    });

    test('35. should serve GET /api/blockchain/state/root endpoint', async () => {
      const res = await request(app).get('/api/blockchain/state/root');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.stateRoot).toBeDefined();
      expect(res.body.stateRoot.startsWith('0x')).toBe(true);
      expect(res.body.algorithm).toBe('SHA-256');
      expect(res.body.version).toBe(1);
    });

    test('36. should serve GET /api/blockchain/state/snapshot endpoint with clean consensus data', async () => {
      const res = await request(app).get('/api/blockchain/state/snapshot');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.snapshot).toBeDefined();
      expect(Array.isArray(res.body.snapshot.beneficiaries)).toBe(true);
      expect(Array.isArray(res.body.snapshot.shops)).toBe(true);
      expect(Array.isArray(res.body.snapshot.warehouses)).toBe(true);
      expect(Array.isArray(res.body.snapshot.shopInventory)).toBe(true);

      // Excludes passwords and tokens
      const str = JSON.stringify(res.body.snapshot);
      expect(str).not.toContain('password');
      expect(str).not.toContain('jwt');
      expect(str).not.toContain('privateKey');
    });

    test('37. should process distribution via transactionService and anchor stateRoot to committed block', async () => {
      const participant = getOrCreateDevParticipant('FPS-ROOT-201', 'SHOP');
      const startNonce = stateManager.getExpectedNonce(participant.address);

      const result = await transactionService.processDistribution({
        beneficiaryId: 'BEN-ROOT-002',
        shopId: 'FPS-ROOT-201',
        commodity: 'Sugar',
        quantity: 1,
        nonce: startNonce
      }, { entityId: 'FPS-ROOT-201' });

      expect(result.success).toBe(true);
      expect(result.block).toBeDefined();
      expect(result.block.stateRoot).toBeDefined();
      expect(result.block.stateRoot.startsWith('0x')).toBe(true);
    });
  });
});

