/**
 * PDSChain Phase 4: Deterministic Execution & Smart-Contract-Like Rule Engine Test Suite
 * 
 * Comprehensive testing covering:
 * - EntitlementRule, DistributionRule, InventoryRule, WarehouseTransferRule, AuthorizationRule
 * - ExecutionContext & ExecutionReceipt
 * - Side-effect-free pre-validation vs atomic execution
 * - Multi-entity atomicity and rollback
 * - Idempotency and replay protection
 * - Rule registry and error stability
 * - Multi-run determinism verification
 * - Architectural separation of concerns
 * - End-to-end blockchain lifecycle
 */

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
const Transaction = require('../src/blockchain/Transaction');
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

describe('PDSChain Deterministic Execution & Smart-Contract-Like Rule Engine Test Suite', () => {
  let shopActor, adminActor, citizenActor, whActor;

  beforeAll(async () => {
    await sequelize.sync({ force: true });

    // Seed test Beneficiaries
    await Beneficiary.create({
      beneficiaryId: 'BEN-EXEC-001',
      name: 'Sunita Devi',
      region: 'East District',
      household: '4 Members',
      eligibilityStatus: true,
      monthlyEntitlement: { Rice: 20, Wheat: 10, Sugar: 2 },
      currentMonthClaimed: { Rice: 0, Wheat: 0, Sugar: 0 },
      status: 'Active'
    });

    await Beneficiary.create({
      beneficiaryId: 'BEN-EXEC-INELIGIBLE',
      name: 'Inactive Citizen',
      region: 'East District',
      household: '2 Members',
      eligibilityStatus: false,
      monthlyEntitlement: { Rice: 20, Wheat: 10, Sugar: 2 },
      currentMonthClaimed: { Rice: 0, Wheat: 0, Sugar: 0 },
      status: 'Suspended'
    });

    // Seed test Fair Price Shop
    await Shop.create({
      shopId: 'FPS-EXEC-201',
      name: 'East District FPS #201',
      region: 'East District',
      manager: 'Rajesh Verma',
      status: 'Active'
    });

    // Seed test Warehouse
    await Warehouse.create({
      warehouseId: 'WH-EXEC-101',
      name: 'Central Silo East',
      location: 'Industrial Sector 5',
      capacity: 50000,
      currentStock: 25000,
      status: 'Operational'
    });

    // Seed Shop Inventory
    await Inventory.create({
      ownerType: 'SHOP',
      ownerId: 'FPS-EXEC-201',
      commodityName: 'Rice',
      quantity: 1000,
      reserved: 0,
      unit: 'KG',
      minThreshold: 100
    });

    await Inventory.create({
      ownerType: 'SHOP',
      ownerId: 'FPS-EXEC-201',
      commodityName: 'Wheat',
      quantity: 500,
      reserved: 0,
      unit: 'KG',
      minThreshold: 50
    });

    await Inventory.create({
      ownerType: 'SHOP',
      ownerId: 'FPS-EXEC-201',
      commodityName: 'Sugar',
      quantity: 100,
      reserved: 0,
      unit: 'KG',
      minThreshold: 10
    });

    // Seed Warehouse Inventory
    await Inventory.create({
      ownerType: 'WAREHOUSE',
      ownerId: 'WH-EXEC-101',
      commodityName: 'Rice',
      quantity: 10000,
      reserved: 0,
      unit: 'KG',
      minThreshold: 1000
    });

    await Inventory.create({
      ownerType: 'WAREHOUSE',
      ownerId: 'WH-EXEC-101',
      commodityName: 'Wheat',
      quantity: 5000,
      reserved: 0,
      unit: 'KG',
      minThreshold: 500
    });
  });

  beforeEach(() => {
    stateManager.resetNonces();
    mempool.clear();

    const keyShop = generateKeyPair();
    shopActor = { ...keyShop, entityId: 'FPS-EXEC-201' };

    const keyAdmin = generateKeyPair();
    adminActor = { ...keyAdmin, entityId: 'ADM-EXEC-001' };

    const keyCitizen = generateKeyPair();
    citizenActor = { ...keyCitizen, entityId: 'BEN-EXEC-001' };

    const keyWH = generateKeyPair();
    whActor = { ...keyWH, entityId: 'WH-EXEC-101' };
  });

  afterAll(async () => {
    await sequelize.close();
  });

  // Helper to build and sign transactions
  function buildTx({
    type = 'DISTRIBUTION',
    sender = shopActor.address,
    senderKey = shopActor,
    receiver = 'FPS-EXEC-201',
    beneficiaryId = 'BEN-EXEC-001',
    shopId = 'FPS-EXEC-201',
    warehouseId = 'WH-EXEC-101',
    commodity = 'Rice',
    quantity = 5,
    unit = 'KG',
    nonce = 0,
    role = null,
    timestamp = '2026-03-31T10:00:00.000Z'
  } = {}) {
    const payload = {
      beneficiaryId,
      shopId,
      warehouseId,
      commodity,
      quantity,
      unit,
      name: 'Sunita Devi',
      senderPublicKey: senderKey.publicKey
    };
    if (role) {
      payload.role = role;
    }

    const tx = new Transaction({
      type,
      sender,
      senderPublicKey: senderKey.publicKey,
      receiver,
      beneficiaryId,
      shopId,
      payload,
      timestamp,
      nonce
    });

    tx.sign(senderKey.privateKey, senderKey.publicKey);
    return tx;
  }

  // =========================================================================
  // SECTION 1: ENTITLEMENT RULES
  // =========================================================================
  describe('1. Deterministic Entitlement Rule Modules', () => {
    test('1. should validate and calculate deterministic quota deduction', async () => {
      const tx = buildTx({ type: 'ENTITLEMENT', commodity: 'Rice', quantity: 5, nonce: 0 });
      const context = ExecutionContext.fromTransaction(tx);
      const rule = new rules.EntitlementRule();

      const validation = await rule.validate(context, stateManager);
      expect(validation.valid).toBe(true);
      expect(validation.maxQuota).toBe(20);
      expect(validation.alreadyClaimed).toBe(0);
      expect(validation.remainingQuota).toBe(20);
      expect(validation.predictedChanges).toHaveLength(1);
      expect(validation.predictedChanges[0]).toEqual({
        entity: 'beneficiary',
        id: 'BEN-EXEC-001',
        field: 'currentMonthClaimed.Rice',
        before: 0,
        after: 5,
        delta: 5,
        unit: 'KG'
      });
    });

    test('2. should reject non-existent beneficiary with BENEFICIARY_NOT_FOUND', async () => {
      const tx = buildTx({ beneficiaryId: 'BEN-NONEXISTENT', nonce: 0 });
      const context = ExecutionContext.fromTransaction(tx);
      const rule = new rules.EntitlementRule();

      await expect(rule.validate(context, stateManager)).rejects.toThrow(
        expect.objectContaining({ code: ExecutionErrorCodes.BENEFICIARY_NOT_FOUND })
      );
    });

    test('3. should reject ineligible or suspended beneficiary with BENEFICIARY_INELIGIBLE', async () => {
      const tx = buildTx({ beneficiaryId: 'BEN-EXEC-INELIGIBLE', nonce: 0 });
      const context = ExecutionContext.fromTransaction(tx);
      const rule = new rules.EntitlementRule();

      await expect(rule.validate(context, stateManager)).rejects.toThrow(
        expect.objectContaining({ code: ExecutionErrorCodes.BENEFICIARY_INELIGIBLE })
      );
    });

    test('4. should reject missing commodity with COMMODITY_NOT_FOUND', async () => {
      const tx = buildTx({ commodity: '', nonce: 0 });
      const context = ExecutionContext.fromTransaction(tx);
      const rule = new rules.EntitlementRule();

      await expect(rule.validate(context, stateManager)).rejects.toThrow(
        expect.objectContaining({ code: ExecutionErrorCodes.COMMODITY_NOT_FOUND })
      );
    });

    test('5. should reject zero or negative quantity with INVALID_QUANTITY', async () => {
      const txZero = buildTx({ quantity: 0, nonce: 0 });
      const txNeg = buildTx({ quantity: -5, nonce: 0 });
      const rule = new rules.EntitlementRule();

      await expect(rule.validate(ExecutionContext.fromTransaction(txZero), stateManager)).rejects.toThrow(
        expect.objectContaining({ code: ExecutionErrorCodes.INVALID_QUANTITY })
      );
      await expect(rule.validate(ExecutionContext.fromTransaction(txNeg), stateManager)).rejects.toThrow(
        expect.objectContaining({ code: ExecutionErrorCodes.INVALID_QUANTITY })
      );
    });

    test('6. should reject quantity exceeding remaining monthly quota with INSUFFICIENT_ENTITLEMENT', async () => {
      const txExcess = buildTx({ commodity: 'Rice', quantity: 25, nonce: 0 });
      const context = ExecutionContext.fromTransaction(txExcess);
      const rule = new rules.EntitlementRule();

      await expect(rule.validate(context, stateManager)).rejects.toThrow(
        expect.objectContaining({ code: ExecutionErrorCodes.INSUFFICIENT_ENTITLEMENT })
      );
    });

    test('7. should reject commodity with zero quota entitlement with INSUFFICIENT_ENTITLEMENT', async () => {
      const txNoQuota = buildTx({ commodity: 'Pulses', quantity: 2, nonce: 0 });
      const context = ExecutionContext.fromTransaction(txNoQuota);
      const rule = new rules.EntitlementRule();

      await expect(rule.validate(context, stateManager)).rejects.toThrow(
        expect.objectContaining({ code: ExecutionErrorCodes.INSUFFICIENT_ENTITLEMENT })
      );
    });

    test('8. should guarantee side-effect-free pre-validation (zero state mutation during validate)', async () => {
      const benBefore = await Beneficiary.findOne({ where: { beneficiaryId: 'BEN-EXEC-001' } });
      const claimedBefore = benBefore.currentMonthClaimed.Rice || 0;

      const tx = buildTx({ commodity: 'Rice', quantity: 5, nonce: 0 });
      const context = ExecutionContext.fromTransaction(tx);
      const rule = new rules.EntitlementRule();

      await rule.validate(context, stateManager);
      await rule.validate(context, stateManager);
      await rule.validate(context, stateManager);

      const benAfter = await Beneficiary.findOne({ where: { beneficiaryId: 'BEN-EXEC-001' } });
      const claimedAfter = benAfter.currentMonthClaimed.Rice || 0;

      expect(claimedAfter).toBe(claimedBefore);
    });

    test('29. should execute EntitlementRule directly and update database state inside transaction', async () => {
      const tx = buildTx({ type: 'ENTITLEMENT', commodity: 'Sugar', quantity: 1, nonce: 0 });
      const context = ExecutionContext.fromTransaction(tx);
      const rule = new rules.EntitlementRule();

      await sequelize.transaction(async (t) => {
        const execResult = await rule.execute(context, stateManager, { dbTransaction: t });
        expect(execResult.stateChanges).toHaveLength(1);
        expect(execResult.stateChanges[0].field).toBe('currentMonthClaimed.Sugar');
        expect(execResult.stateChanges[0].delta).toBe(1);
      });

      const ben = await Beneficiary.findOne({ where: { beneficiaryId: 'BEN-EXEC-001' } });
      expect(ben.currentMonthClaimed.Sugar).toBe(1);
    });

    test('30. should handle multiple commodities (Wheat and Sugar) independently in EntitlementRule', async () => {
      const txWheat = buildTx({ type: 'ENTITLEMENT', commodity: 'Wheat', quantity: 3, nonce: 0 });
      const contextWheat = ExecutionContext.fromTransaction(txWheat);
      const rule = new rules.EntitlementRule();

      const validation = await rule.validate(contextWheat, stateManager);
      expect(validation.valid).toBe(true);
      expect(validation.maxQuota).toBe(10);
      expect(validation.remainingQuota).toBe(10);
    });
  });

  // =========================================================================
  // SECTION 2: INVENTORY RULES
  // =========================================================================
  describe('2. Deterministic Shop Inventory Rule Modules', () => {
    test('9. should validate shop stock availability and produce predicted reduction', async () => {
      const tx = buildTx({ type: 'INVENTORY', commodity: 'Rice', quantity: 10, nonce: 0 });
      const context = ExecutionContext.fromTransaction(tx);
      const rule = new rules.InventoryRule();

      const validation = await rule.validate(context, stateManager);
      expect(validation.valid).toBe(true);
      expect(validation.availableStock).toBe(1000);
      expect(validation.predictedChanges).toEqual([
        {
          entity: 'shop',
          id: 'FPS-EXEC-201',
          field: 'stock.Rice',
          before: 1000,
          after: 990,
          delta: -10,
          unit: 'KG'
        }
      ]);
    });

    test('10. should reject stock deduction when requested quantity exceeds available stock', async () => {
      const txExcess = buildTx({ type: 'INVENTORY', commodity: 'Rice', quantity: 1500, nonce: 0 });
      const context = ExecutionContext.fromTransaction(txExcess);
      const rule = new rules.InventoryRule();

      await expect(rule.validate(context, stateManager)).rejects.toThrow(
        expect.objectContaining({ code: ExecutionErrorCodes.INSUFFICIENT_STOCK })
      );
    });

    test('11. should reject invalid/missing shop ID with SHOP_NOT_FOUND', async () => {
      const tx = buildTx({ type: 'INVENTORY', shopId: '', receiver: '', nonce: 0 });
      const context = ExecutionContext.fromTransaction(tx);
      const rule = new rules.InventoryRule();

      await expect(rule.validate(context, stateManager)).rejects.toThrow(
        expect.objectContaining({ code: ExecutionErrorCodes.SHOP_NOT_FOUND })
      );
    });

    test('31. should execute InventoryRule directly and update shop inventory in database', async () => {
      const tx = buildTx({ type: 'INVENTORY', commodity: 'Rice', quantity: 10, nonce: 0 });
      const context = ExecutionContext.fromTransaction(tx);
      const rule = new rules.InventoryRule();

      await sequelize.transaction(async (t) => {
        const execResult = await rule.execute(context, stateManager, { dbTransaction: t });
        expect(execResult.stateChanges).toHaveLength(1);
        expect(execResult.stateChanges[0].delta).toBe(-10);
      });

      const inv = await Inventory.findOne({ where: { ownerType: 'SHOP', ownerId: 'FPS-EXEC-201', commodityName: 'Rice' } });
      expect(inv.quantity).toBe(990);
    });

    test('32. should prevent negative inventory attempts with INSUFFICIENT_STOCK', async () => {
      const txExcess = buildTx({ type: 'INVENTORY', commodity: 'Sugar', quantity: 500, nonce: 0 });
      const context = ExecutionContext.fromTransaction(txExcess);
      const rule = new rules.InventoryRule();

      await expect(rule.validate(context, stateManager)).rejects.toThrow(
        expect.objectContaining({ code: ExecutionErrorCodes.INSUFFICIENT_STOCK })
      );
    });

    test('33. should validate SHOP_STOCK_DEDUCTION alias type', async () => {
      const tx = buildTx({ type: 'SHOP_STOCK_DEDUCTION', commodity: 'Rice', quantity: 5, nonce: 0 });
      const context = ExecutionContext.fromTransaction(tx);
      const rule = new rules.InventoryRule();

      const validation = await rule.validate(context, stateManager);
      expect(validation.valid).toBe(true);
      expect(validation.predictedChanges[0].delta).toBe(-5);
    });
  });

  // =========================================================================
  // SECTION 3: DISTRIBUTION RULES (COMPOSITE ATOMICITY)
  // =========================================================================
  describe('3. Composite Grain Distribution Rule Modules', () => {
    test('12. should validate composite entitlement and shop stock in single validation pass', async () => {
      const tx = buildTx({ type: 'DISTRIBUTION', commodity: 'Rice', quantity: 5, nonce: 0 });
      const context = ExecutionContext.fromTransaction(tx);
      const rule = new rules.DistributionRule();

      const validation = await rule.validate(context, stateManager);
      expect(validation.valid).toBe(true);
      expect(validation.predictedChanges).toHaveLength(2);

      const benChange = validation.predictedChanges.find(c => c.entity === 'beneficiary');
      const shopChange = validation.predictedChanges.find(c => c.entity === 'shop');

      expect(benChange).toBeDefined();
      expect(shopChange).toBeDefined();
      expect(benChange.delta).toBe(5);
      expect(shopChange.delta).toBe(-5);
    });

    test('13. should reject distribution when beneficiary quota is exceeded even if shop has stock', async () => {
      const tx = buildTx({ commodity: 'Rice', quantity: 25, nonce: 0 });
      const context = ExecutionContext.fromTransaction(tx);
      const rule = new rules.DistributionRule();

      await expect(rule.validate(context, stateManager)).rejects.toThrow(
        expect.objectContaining({ code: ExecutionErrorCodes.INSUFFICIENT_ENTITLEMENT })
      );
    });

    test('14. should reject distribution when shop stock is insufficient even if beneficiary has quota', async () => {
      const tx = buildTx({ commodity: 'Wheat', quantity: 8, nonce: 0 });
      const wheatInv = await Inventory.findOne({ where: { ownerType: 'SHOP', ownerId: 'FPS-EXEC-201', commodityName: 'Wheat' } });
      wheatInv.quantity = 2;
      await wheatInv.save();

      const context = ExecutionContext.fromTransaction(tx);
      const rule = new rules.DistributionRule();

      await expect(rule.validate(context, stateManager)).rejects.toThrow(
        expect.objectContaining({ code: ExecutionErrorCodes.INSUFFICIENT_STOCK })
      );

      wheatInv.quantity = 500;
      await wheatInv.save();
    });

    test('34. should execute DistributionRule directly and mutate both beneficiary quota and shop stock atomically', async () => {
      const tx = buildTx({ type: 'DISTRIBUTION', commodity: 'Rice', quantity: 2, nonce: 0 });
      const context = ExecutionContext.fromTransaction(tx);
      const rule = new rules.DistributionRule();

      const benBefore = await Beneficiary.findOne({ where: { beneficiaryId: 'BEN-EXEC-001' } });
      const riceClaimedBefore = benBefore.currentMonthClaimed.Rice || 0;

      const shopInvBefore = await Inventory.findOne({ where: { ownerType: 'SHOP', ownerId: 'FPS-EXEC-201', commodityName: 'Rice' } });
      const shopStockBefore = shopInvBefore.quantity;

      await sequelize.transaction(async (t) => {
        const execResult = await rule.execute(context, stateManager, { dbTransaction: t });
        expect(execResult.stateChanges).toHaveLength(2);
      });

      const benAfter = await Beneficiary.findOne({ where: { beneficiaryId: 'BEN-EXEC-001' } });
      const shopInvAfter = await Inventory.findOne({ where: { ownerType: 'SHOP', ownerId: 'FPS-EXEC-201', commodityName: 'Rice' } });

      expect(benAfter.currentMonthClaimed.Rice).toBe(riceClaimedBefore + 2);
      expect(shopInvAfter.quantity).toBe(shopStockBefore - 2);
    });

    test('35. should reject distribution with non-numeric or non-finite quantity with INVALID_QUANTITY', async () => {
      const txNaN = buildTx({ type: 'DISTRIBUTION', quantity: NaN, nonce: 0 });
      const contextNaN = ExecutionContext.fromTransaction(txNaN);
      const rule = new rules.DistributionRule();

      await expect(rule.validate(contextNaN, stateManager)).rejects.toThrow(
        expect.objectContaining({ code: ExecutionErrorCodes.INVALID_QUANTITY })
      );
    });
  });

  // =========================================================================
  // SECTION 4: WAREHOUSE TRANSFER RULES
  // =========================================================================
  describe('4. Warehouse Logistics Transfer Rule Modules', () => {
    test('15. should validate warehouse transfer and predict source decrease and destination increase', async () => {
      const tx = buildTx({
        type: 'WAREHOUSE_TRANSFER',
        sender: whActor.address,
        senderKey: whActor,
        warehouseId: 'WH-EXEC-101',
        shopId: 'FPS-EXEC-201',
        commodity: 'Rice',
        quantity: 100,
        nonce: 0
      });
      const context = ExecutionContext.fromTransaction(tx);
      const rule = new rules.WarehouseTransferRule();

      const validation = await rule.validate(context, stateManager);
      expect(validation.valid).toBe(true);
      expect(validation.predictedChanges).toHaveLength(2);

      const whChange = validation.predictedChanges.find(c => c.entity === 'warehouse');
      const shopChange = validation.predictedChanges.find(c => c.entity === 'shop');

      expect(whChange.delta).toBe(-100);
      expect(shopChange.delta).toBe(100);
    });

    test('16. should reject warehouse transfer when warehouse has insufficient inventory', async () => {
      const tx = buildTx({
        type: 'WAREHOUSE_TRANSFER',
        sender: whActor.address,
        senderKey: whActor,
        warehouseId: 'WH-EXEC-101',
        shopId: 'FPS-EXEC-201',
        commodity: 'Rice',
        quantity: 50000,
        nonce: 0
      });
      const context = ExecutionContext.fromTransaction(tx);
      const rule = new rules.WarehouseTransferRule();

      await expect(rule.validate(context, stateManager)).rejects.toThrow(
        expect.objectContaining({ code: ExecutionErrorCodes.INSUFFICIENT_STOCK })
      );
    });

    test('36. should reject warehouse transfer when source warehouse does not exist with WAREHOUSE_NOT_FOUND', async () => {
      const tx = buildTx({
        type: 'WAREHOUSE_TRANSFER',
        sender: whActor.address,
        senderKey: whActor,
        warehouseId: 'WH-NONEXISTENT',
        shopId: 'FPS-EXEC-201',
        commodity: 'Rice',
        quantity: 50,
        nonce: 0
      });
      const context = ExecutionContext.fromTransaction(tx);
      const rule = new rules.WarehouseTransferRule();

      await expect(rule.validate(context, stateManager)).rejects.toThrow(
        expect.objectContaining({ code: ExecutionErrorCodes.WAREHOUSE_NOT_FOUND })
      );
    });

    test('37. should reject warehouse transfer when destination shop does not exist with SHOP_NOT_FOUND', async () => {
      const tx = buildTx({
        type: 'WAREHOUSE_TRANSFER',
        sender: whActor.address,
        senderKey: whActor,
        warehouseId: 'WH-EXEC-101',
        shopId: 'FPS-NONEXISTENT',
        commodity: 'Rice',
        quantity: 50,
        nonce: 0
      });
      const context = ExecutionContext.fromTransaction(tx);
      const rule = new rules.WarehouseTransferRule();

      await expect(rule.validate(context, stateManager)).rejects.toThrow(
        expect.objectContaining({ code: ExecutionErrorCodes.SHOP_NOT_FOUND })
      );
    });

    test('38. should execute WarehouseTransferRule atomically and create StockTransfer audit record', async () => {
      const tx = buildTx({
        type: 'WAREHOUSE_TRANSFER',
        sender: whActor.address,
        senderKey: whActor,
        warehouseId: 'WH-EXEC-101',
        shopId: 'FPS-EXEC-201',
        commodity: 'Rice',
        quantity: 200,
        nonce: 0
      });
      const context = ExecutionContext.fromTransaction(tx);
      const rule = new rules.WarehouseTransferRule();

      const whInvBefore = await Inventory.findOne({ where: { ownerType: 'WAREHOUSE', ownerId: 'WH-EXEC-101', commodityName: 'Rice' } });
      const shopInvBefore = await Inventory.findOne({ where: { ownerType: 'SHOP', ownerId: 'FPS-EXEC-201', commodityName: 'Rice' } });

      await sequelize.transaction(async (t) => {
        const execResult = await rule.execute(context, stateManager, { dbTransaction: t });
        expect(execResult.stateChanges).toHaveLength(2);
      });

      const whInvAfter = await Inventory.findOne({ where: { ownerType: 'WAREHOUSE', ownerId: 'WH-EXEC-101', commodityName: 'Rice' } });
      const shopInvAfter = await Inventory.findOne({ where: { ownerType: 'SHOP', ownerId: 'FPS-EXEC-201', commodityName: 'Rice' } });

      expect(whInvAfter.quantity).toBe(whInvBefore.quantity - 200);
      expect(shopInvAfter.quantity).toBe(shopInvBefore.quantity + 200);

      const transferLog = await StockTransfer.findOne({
        where: { warehouseId: 'WH-EXEC-101', shopId: 'FPS-EXEC-201', commodity: 'Rice' },
        order: [['createdAt', 'DESC']]
      });
      expect(transferLog).toBeDefined();
      expect(transferLog.quantity).toBe(200);
    });

    test('39. should support TRANSFER alias type for warehouse transfers', async () => {
      const tx = buildTx({
        type: 'TRANSFER',
        sender: whActor.address,
        senderKey: whActor,
        warehouseId: 'WH-EXEC-101',
        shopId: 'FPS-EXEC-201',
        commodity: 'Wheat',
        quantity: 50,
        nonce: 0
      });
      const context = ExecutionContext.fromTransaction(tx);
      const rule = new rules.WarehouseTransferRule();

      const validation = await rule.validate(context, stateManager);
      expect(validation.valid).toBe(true);
      expect(validation.predictedChanges).toHaveLength(2);
    });
  });

  // =========================================================================
  // SECTION 5: AUTHORIZATION RULES & ROLE VERIFICATION
  // =========================================================================
  describe('5. Authorization Rule & Role Verification Modules', () => {
    test('40. should accept authorized SHOP actor for DISTRIBUTION and INVENTORY', () => {
      const tx = buildTx({ type: 'DISTRIBUTION', sender: 'FPS-EXEC-201', nonce: 0 });
      const context = ExecutionContext.fromTransaction(tx);
      expect(() => rules.AuthorizationRule.validateAuthorization(context)).not.toThrow();
    });

    test('41. should accept authorized WAREHOUSE actor for WAREHOUSE_TRANSFER', () => {
      const tx = buildTx({ type: 'WAREHOUSE_TRANSFER', sender: 'WH-EXEC-101', nonce: 0 });
      const context = ExecutionContext.fromTransaction(tx);
      expect(() => rules.AuthorizationRule.validateAuthorization(context)).not.toThrow();
    });

    test('42. should reject unauthorized sender role (CITIZEN attempting WAREHOUSE_TRANSFER) with UNAUTHORIZED_SENDER', () => {
      const tx = buildTx({
        type: 'WAREHOUSE_TRANSFER',
        sender: citizenActor.address,
        senderKey: citizenActor,
        role: 'CITIZEN',
        nonce: 0
      });
      const context = ExecutionContext.fromTransaction(tx);
      expect(() => rules.AuthorizationRule.validateAuthorization(context)).toThrow(
        expect.objectContaining({ code: ExecutionErrorCodes.UNAUTHORIZED_SENDER })
      );
    });

    test('43. should reject unauthorized sender role (SHOP attempting ENTITLEMENT quota adjustment) with UNAUTHORIZED_SENDER', () => {
      const tx = buildTx({
        type: 'ENTITLEMENT',
        sender: shopActor.address,
        senderKey: shopActor,
        role: 'SHOP',
        nonce: 0
      });
      const context = ExecutionContext.fromTransaction(tx);
      expect(() => rules.AuthorizationRule.validateAuthorization(context)).toThrow(
        expect.objectContaining({ code: ExecutionErrorCodes.UNAUTHORIZED_SENDER })
      );
    });
  });

  // =========================================================================
  // SECTION 6: EXECUTION ENGINE, DETERMINISM & ATOMICITY
  // =========================================================================
  describe('6. ExecutionEngine Architecture, Determinism & Receipts', () => {
    test('17. should resolve registered rule and return deterministic receipt on executeTransaction', async () => {
      const tx = buildTx({ commodity: 'Rice', quantity: 2, nonce: 0 });

      const result = await executionEngine.executeTransaction(tx, {
        blockNumber: 42,
        blockHash: '0x9999999999999999',
        consensusRound: 'RND-42'
      });

      expect(result.success).toBe(true);
      expect(result.receipt).toBeInstanceOf(ExecutionReceipt);
      expect(result.receipt.status).toBe('SUCCESS');
      expect(result.receipt.transactionId).toBe(tx.transactionId);
      expect(result.receipt.blockNumber).toBe(42);
      expect(result.receipt.blockHash).toBe('0x9999999999999999');
      expect(result.receipt.consensusRound).toBe('RND-42');
      expect(Array.isArray(result.receipt.stateChanges)).toBe(true);
      expect(result.receipt.stateChanges.length).toBeGreaterThan(0);
    });

    test('18. should reject unmapped or unknown transaction types with INVALID_TRANSACTION_TYPE', async () => {
      const txUnknown = buildTx({ type: 'UNKNOWN_CUSTOM_OP', nonce: 0 });
      await expect(executionEngine.validateTransaction(txUnknown)).rejects.toThrow(
        expect.objectContaining({ code: ExecutionErrorCodes.INVALID_TRANSACTION_TYPE })
      );
    });

    test('19. should prevent duplicate execution of already executed transaction ID with ALREADY_APPLIED', async () => {
      const tx = buildTx({ commodity: 'Rice', quantity: 1, nonce: 0 });
      await executionEngine.executeTransaction(tx);

      // Second execution of the exact same transaction ID
      await expect(executionEngine.validateTransaction(tx)).rejects.toThrow(
        expect.objectContaining({ code: ExecutionErrorCodes.ALREADY_APPLIED })
      );
    });

    test('20. should enforce replay protection against stale sender nonces with REPLAYED_NONCE', async () => {
      // Consume nonce 0
      const tx0 = buildTx({ commodity: 'Rice', quantity: 1, nonce: 0 });
      await executionEngine.executeTransaction(tx0);

      // Attempt new transaction reusing consumed nonce 0 with a new timestamp
      const txStale = buildTx({ commodity: 'Rice', quantity: 1, nonce: 0, timestamp: '2026-03-31T11:00:00.000Z' });
      await expect(executionEngine.validateTransaction(txStale)).rejects.toThrow(
        expect.objectContaining({ code: ExecutionErrorCodes.REPLAYED_NONCE })
      );
    });

    test('21. should ensure stateChanges array in receipt is deterministically sorted', () => {
      const rawChanges = [
        { entity: 'shop', id: 'FPS-002', field: 'stock.Rice', before: 100, after: 90, delta: -10, unit: 'KG' },
        { entity: 'beneficiary', id: 'BEN-005', field: 'currentMonthClaimed.Rice', before: 0, after: 10, delta: 10, unit: 'KG' },
        { entity: 'beneficiary', id: 'BEN-001', field: 'currentMonthClaimed.Rice', before: 0, after: 10, delta: 10, unit: 'KG' }
      ];

      const receipt = ExecutionReceipt.success({
        transactionId: 'TXN-TEST',
        transactionType: 'DISTRIBUTION',
        stateChanges: rawChanges
      });

      expect(receipt.stateChanges[0].id).toBe('BEN-001');
      expect(receipt.stateChanges[1].id).toBe('BEN-005');
      expect(receipt.stateChanges[2].id).toBe('FPS-002');
    });

    test('22. should verify Multi-Run Determinism (same state + same tx produces identical output)', async () => {
      const tx1 = buildTx({ commodity: 'Wheat', quantity: 2, nonce: 0 });
      const tx2 = buildTx({ commodity: 'Wheat', quantity: 2, nonce: 0 });

      const val1 = await executionEngine.validateTransaction(tx1);
      const val2 = await executionEngine.validateTransaction(tx2);

      expect(JSON.stringify(val1.predictedChanges)).toBe(JSON.stringify(val2.predictedChanges));
    });

    test('23. should rollback entire multi-state transition if second phase fails (Atomicity Test)', async () => {
      const wheatInv = await Inventory.findOne({ where: { ownerType: 'SHOP', ownerId: 'FPS-EXEC-201', commodityName: 'Wheat' } });
      const originalStock = wheatInv.quantity;
      wheatInv.quantity = 1;
      await wheatInv.save();

      const ben = await Beneficiary.findOne({ where: { beneficiaryId: 'BEN-EXEC-001' } });
      const claimedWheatBefore = ben.currentMonthClaimed.Wheat || 0;

      const txFail = buildTx({ commodity: 'Wheat', quantity: 5, nonce: 0 });

      try {
        await sequelize.transaction(async (t) => {
          await executionEngine.executeTransaction(txFail, { dbTransaction: t });
        });
      } catch (err) {
        // Expected failure
      }

      const benAfter = await Beneficiary.findOne({ where: { beneficiaryId: 'BEN-EXEC-001' } });
      expect(benAfter.currentMonthClaimed.Wheat || 0).toBe(claimedWheatBefore);

      wheatInv.quantity = originalStock;
      await wheatInv.save();
    });

    test('44. should reject executeTransaction when rule validation fails', async () => {
      const tx = buildTx({ commodity: 'Rice', quantity: 2000, nonce: 0 }); // Exceeds quota
      await expect(executionEngine.executeTransaction(tx)).rejects.toThrow(
        expect.objectContaining({ code: ExecutionErrorCodes.INSUFFICIENT_ENTITLEMENT })
      );
    });

    test('45. should produce exact matching receipts across repeated deterministic simulations', async () => {
      const tx = buildTx({ commodity: 'Sugar', quantity: 1, nonce: 0 });
      const sim1 = await executionEngine.validateTransaction(tx);
      const sim2 = await executionEngine.validateTransaction(tx);

      expect(sim1.predictedChanges).toEqual(sim2.predictedChanges);
    });

    test('46. should support DEDUCT_QUOTA alias type in ExecutionEngine', async () => {
      const tx = buildTx({ type: 'DEDUCT_QUOTA', commodity: 'Rice', quantity: 1, nonce: 0 });
      const validation = await executionEngine.validateTransaction(tx);
      expect(validation.valid).toBe(true);
      expect(validation.predictedChanges[0].field).toBe('currentMonthClaimed.Rice');
    });

    test('47. should extract deterministic parameters in ExecutionContext regardless of extra metadata', () => {
      const tx = buildTx({ commodity: 'Rice', quantity: 5, nonce: 0 });
      const ctx1 = ExecutionContext.fromTransaction(tx);
      const ctx2 = ExecutionContext.fromTransaction({ ...tx.toJSON(), extraRandomField: 'ignoreMe' });

      expect(ctx1.commodity).toBe(ctx2.commodity);
      expect(ctx1.quantity).toBe(ctx2.quantity);
      expect(ctx1.transactionId).toBe(ctx2.transactionId);
    });

    test('48. should properly parse string numbers to numeric floats/integers deterministically in ExecutionContext', () => {
      const tx = buildTx({ commodity: 'Rice', quantity: '5.5', nonce: '7' });
      const ctx = ExecutionContext.fromTransaction(tx);
      expect(ctx.quantity).toBe(5.5);
      expect(ctx.nonce).toBe(7);
    });
  });

  // =========================================================================
  // SECTION 7: ARCHITECTURAL SEPARATION OF CONCERNS
  // =========================================================================
  describe('7. Architectural Separation of Concerns', () => {
    test('24. should verify ExecutionEngine does NOT manage mempool or private keys', () => {
      expect(executionEngine.mempool).toBeUndefined();
      expect(executionEngine.privateKey).toBeUndefined();
      expect(typeof executionEngine.executeTransaction).toBe('function');
      expect(typeof executionEngine.validateTransaction).toBe('function');
    });

    test('25. should verify Mempool does NOT execute state transitions or modify inventory', () => {
      expect(mempool.executeTransaction).toBeUndefined();
      expect(mempool.applyStateTransition).toBeUndefined();
      expect(typeof mempool.addTransaction).toBe('function');
      expect(typeof mempool.getCandidateTransactions).toBe('function');
    });

    test('26. should verify Consensus does NOT contain PDS domain rules', () => {
      expect(consensusService.deductQuota).toBeUndefined();
      expect(consensusService.transferStock).toBeUndefined();
      expect(typeof consensusService.runConsensus).toBe('function');
    });

    test('27. should verify Blockchain ledger does NOT contain PDS domain rules', () => {
      expect(blockchainService.deductQuota).toBeUndefined();
      expect(blockchainService.transferStock).toBeUndefined();
      expect(typeof blockchainService.addBlock).toBe('function');
    });
  });

  // =========================================================================
  // SECTION 8: FULL END-TO-END PIPELINE INTEGRATION
  // =========================================================================
  describe('8. End-to-End Pipeline Integration', () => {
    test('28. should execute full lifecycle: Tx -> Mempool -> Simulation -> FBA -> Block -> Execution -> Receipt', async () => {
      const participant = getOrCreateDevParticipant('FPS-EXEC-201', 'SHOP');
      const startNonce = stateManager.getExpectedNonce(participant.address);

      // 1. Construct & Sign Transaction
      const tx = new Transaction({
        type: 'DISTRIBUTION',
        sender: participant.address,
        senderPublicKey: participant.publicKey,
        beneficiaryId: 'BEN-EXEC-001',
        receiver: 'FPS-EXEC-201',
        shopId: 'FPS-EXEC-201',
        payload: {
          beneficiaryId: 'BEN-EXEC-001',
          shopId: 'FPS-EXEC-201',
          commodity: 'Rice',
          quantity: 2,
          unit: 'KG',
          name: 'Sunita Devi',
          senderPublicKey: participant.publicKey
        },
        timestamp: '2026-03-31T12:00:00.000Z',
        nonce: startNonce
      });

      tx.sign(participant.privateKey, participant.publicKey);

      // 2. Pre-Validation / Simulation (Zero side effects)
      const simulation = await executionEngine.validateTransaction(tx);
      expect(simulation.valid).toBe(true);
      expect(simulation.predictedChanges).toHaveLength(2);

      // 3. Mempool Staging
      const mempoolEntry = mempool.addTransaction(tx);
      expect(mempoolEntry.status).toBe('READY');

      // 4. Block Candidate Selection
      const candidates = mempool.getCandidateTransactions(5);
      expect(candidates).toHaveLength(1);
      const candidateTx = candidates[0];

      // 5. 12-Validator FBA Consensus
      const proposal = {
        transactionId: candidateTx.transactionId,
        beneficiaryId: candidateTx.beneficiaryId,
        beneficiaryName: 'Sunita Devi',
        shopId: candidateTx.shopId,
        commodity: candidateTx.commodity,
        quantity: candidateTx.quantity,
        timestamp: candidateTx.timestamp,
        nonce: candidateTx.nonce,
        signature: candidateTx.signature,
        senderPublicKey: candidateTx.senderPublicKey,
        sender: candidateTx.sender,
        receiver: candidateTx.receiver,
        payload: candidateTx.payload
      };

      const consensusResult = await consensusService.runConsensus(proposal);
      expect(consensusResult.status).toBe('ACHIEVED');
      expect(consensusResult.participatingValidators).toBe(12);

      // 6. Block Ledger Commit & Atomic Execution
      let newBlock;
      let executionResult;

      await sequelize.transaction(async (t) => {
        newBlock = await blockchainService.addBlock(
          [candidateTx.toBlockPayload()],
          consensusResult.validatorSignatures,
          t
        );

        executionResult = await executionEngine.executeTransaction(candidateTx, {
          dbTransaction: t,
          blockNumber: newBlock.blockNumber,
          blockHash: newBlock.blockHash,
          consensusRound: consensusResult.roundId
        });

        mempool.removeIncludedTransactions([candidateTx.transactionId], newBlock.blockNumber);
      });

      // 7. Verify Results
      expect(executionResult.success).toBe(true);
      expect(executionResult.receipt.status).toBe('SUCCESS');
      expect(executionResult.receipt.stateChanges).toHaveLength(2);
      expect(mempool.entries.size).toBe(0);

      // Nonce must have advanced
      const nextNonce = stateManager.getExpectedNonce(participant.address);
      expect(nextNonce).toBe(startNonce + 1);
    });
  });
});
