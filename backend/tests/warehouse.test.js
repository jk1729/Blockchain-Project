const request = require('supertest');
const app = require('../src/app');
const { sequelize } = require('../src/config/database');
const { seedDatabase } = require('../src/seed/seedDatabase');
const Inventory = require('../src/models/Inventory');
const StockTransfer = require('../src/models/StockTransfer');
const TransferEventOutbox = require('../src/models/TransferEventOutbox');
const transactionService = require('../src/services/transactionService');
const { defaultEventStore } = require('../src/controllers/eventController');
const { defaultSecurityAuditLogger } = require('../src/security/permissions/SecurityAuditLogger');

describe('Warehouse Logistics & Stock Transfer Test Suite', () => {
  let warehouseToken, citizenToken;

  beforeAll(async () => {
    await seedDatabase(true);

    const whRes = await request(app).post('/api/auth/login').send({ username: 'warehouse', password: 'warehouse123' });
    warehouseToken = whRes.body.token;

    const citRes = await request(app).post('/api/auth/login').send({ username: 'citizen', password: 'citizen123' });
    citizenToken = citRes.body.token;
  });

  afterAll(async () => {
    await sequelize.close();
  });

  it('should execute an atomic stock transfer from the authenticated warehouse to a shop', async () => {
    const whBefore = await Inventory.findOne({ where: { ownerType: 'WAREHOUSE', ownerId: 'WH-003', commodityName: 'Rice' } });
    const shopBefore = await Inventory.findOne({ where: { ownerType: 'SHOP', ownerId: 'FPS-101', commodityName: 'Rice' } });
    const whInitial = whBefore.quantity;
    const shopInitial = shopBefore.quantity;

    const res = await request(app)
      .post('/api/warehouses/WH-003/transfer')
      .set('Authorization', `Bearer ${warehouseToken}`)
      .send({ shopId: 'FPS-101', commodity: 'Rice', quantity: 200 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.transfer).toBeDefined();
    expect(res.body.transfer.transactionId).toBe(res.body.transaction.transactionId);
    expect(res.body.transfer.blockNumber).toBe(res.body.block.blockNumber);
    expect(defaultEventStore.query({ transactionHash: res.body.transfer.transactionHash }).total).toBe(1);
    expect(defaultSecurityAuditLogger.query({ resource: res.body.transfer.transferId, decision: 'ALLOW' }).length).toBe(1);

    const whAfter = await Inventory.findOne({ where: { ownerType: 'WAREHOUSE', ownerId: 'WH-003', commodityName: 'Rice' } });
    const shopAfter = await Inventory.findOne({ where: { ownerType: 'SHOP', ownerId: 'FPS-101', commodityName: 'Rice' } });
    expect(whAfter.quantity).toBe(whInitial - 200);
    expect(shopAfter.quantity).toBe(shopInitial + 200);
  });

  it('should reject transfer when warehouse has insufficient inventory', async () => {
    const res = await request(app)
      .post('/api/warehouses/WH-003/transfer')
      .set('Authorization', `Bearer ${warehouseToken}`)
      .send({ shopId: 'FPS-101', commodity: 'Rice', quantity: 999999 });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('should reject a warehouse operator attempting to use another source warehouse', async () => {
    const before = await StockTransfer.count();
    const res = await request(app)
      .post('/api/warehouses/WH-001/transfer')
      .set('Authorization', `Bearer ${warehouseToken}`)
      .send({ shopId: 'FPS-101', commodity: 'Rice', quantity: 1 });

    expect(res.status).toBe(403);
    expect(await StockTransfer.count()).toBe(before);
  });

  it('should reject unauthenticated and invalid destination transfers', async () => {
    const unauthenticated = await request(app)
      .post('/api/warehouses/WH-003/transfer')
      .send({ shopId: 'FPS-101', commodity: 'Rice', quantity: 1 });
    expect(unauthenticated.status).toBe(401);

    const invalidDestination = await request(app)
      .post('/api/warehouses/WH-003/transfer')
      .set('Authorization', `Bearer ${warehouseToken}`)
      .send({ shopId: 'FPS-999', commodity: 'Rice', quantity: 1 });
    expect(invalidDestination.status).toBe(400);
  });

  it('should reject an immediate duplicate without changing inventory or transfer count', async () => {
    const beforeInventory = await Inventory.findOne({ where: { ownerType: 'WAREHOUSE', ownerId: 'WH-003', commodityName: 'Wheat' } });
    const beforeTransfers = await StockTransfer.count();
    const payload = { shopId: 'FPS-101', commodity: 'Wheat', quantity: 2 };

    const first = await request(app)
      .post('/api/warehouses/WH-003/transfer')
      .set('Authorization', `Bearer ${warehouseToken}`)
      .send(payload);
    const duplicate = await request(app)
      .post('/api/warehouses/WH-003/transfer')
      .set('Authorization', `Bearer ${warehouseToken}`)
      .send(payload);

    expect(first.status).toBe(200);
    expect(duplicate.status).toBe(409);
    const afterInventory = await Inventory.findOne({ where: { ownerType: 'WAREHOUSE', ownerId: 'WH-003', commodityName: 'Wheat' } });
    expect(afterInventory.quantity).toBe(beforeInventory.quantity - 2);
    expect(await StockTransfer.count()).toBe(beforeTransfers + 1);
  });

  it('should reject a retry with the same idempotency key after the debounce window', async () => {
    const payload = {
      shopId: 'FPS-101',
      commodity: 'Rice',
      quantity: 2,
      idempotencyKey: `warehouse-retry-${Date.now()}`
    };
    const first = await request(app)
      .post('/api/warehouses/WH-003/transfer')
      .set('Authorization', `Bearer ${warehouseToken}`)
      .send(payload);
    expect(first.status).toBe(200);

    await StockTransfer.update(
      { createdAt: new Date(Date.now() - 10000) },
      { where: { transferId: first.body.transfer.transferId } }
    );

    const retry = await request(app)
      .post('/api/warehouses/WH-003/transfer')
      .set('Authorization', `Bearer ${warehouseToken}`)
      .send(payload);
    expect(retry.status).toBe(409);
  });

  it('should retain and recover a pending audit outbox record after a publish failure', async () => {
    const transferId = `TEST-OUTBOX-${Date.now()}`;
    const entry = await TransferEventOutbox.create({
      transferId,
      eventType: 'SECURITY_AUDIT',
      payload: {
        eventId: `audit_${transferId}`,
        actorId: 'test',
        actorType: 'WAREHOUSE',
        action: 'warehouse_transfer',
        resource: transferId,
        decision: 'ALLOW',
        details: { test: true }
      }
    });
    const originalLogEvent = defaultSecurityAuditLogger.logEvent;
    defaultSecurityAuditLogger.logEvent = () => {
      throw new Error('synthetic audit sink failure');
    };

    await transactionService.drainTransferEventOutbox();
    await entry.reload();
    expect(entry.publishedAt).toBeNull();
    expect(entry.attempts).toBe(1);

    defaultSecurityAuditLogger.logEvent = () => ({ eventId: `audit_${transferId}` });
    await transactionService.drainTransferEventOutbox();
    await entry.reload();
    expect(entry.publishedAt).not.toBeNull();
    await entry.destroy();
    defaultSecurityAuditLogger.logEvent = originalLogEvent;
  });

  it('should reject unauthorized citizen attempting stock transfer', async () => {
    const res = await request(app)
      .post('/api/warehouses/WH-003/transfer')
      .set('Authorization', `Bearer ${citizenToken}`)
      .send({ shopId: 'FPS-101', commodity: 'Rice', quantity: 100 });

    expect(res.status).toBe(403);
  });
});
