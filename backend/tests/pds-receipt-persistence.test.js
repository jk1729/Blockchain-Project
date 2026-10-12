const request = require('supertest');
const app = require('../src/app');
const { sequelize } = require('../src/config/database');
const { seedDatabase } = require('../src/seed/seedDatabase');
const transactionService = require('../src/services/transactionService');
const blockchainService = require('../src/services/blockchainService');
const { PDSReceipt, Beneficiary, Inventory, Transaction } = require('../src/models');
const { evmRuntime } = require('../src/evm');
const fbaInstance = require('../src/consensus/FBAConsensus');
const { DatabaseMigrationManager } = require('../src/database/DatabaseMigrationManager');
const migration002PdsReceipts = require('../src/migrations/002_pds_receipts');

describe('PDS Receipt Persistence, API Retrieval, and Migration Test Suite', () => {
  beforeAll(async () => {
    await seedDatabase(true);
    await blockchainService.init();
    await evmRuntime.initialize();
  });

  afterAll(async () => {
    await sequelize.close();
  });

  describe('1. PDSReceipt Model, Atomic Persistence, Rollback, and Immutability', () => {
    it('creates a valid PDSReceipt record and preserves full JSON receiptData including stateChanges', async () => {
      const sampleReceipt = {
        receiptNumber: 'REC-UNIT-TEST-001',
        transactionId: 'TXN-UNIT-TEST-001',
        status: 'SUCCESS',
        transactionType: 'DISTRIBUTION',
        blockNumber: 10,
        blockHash: '0x' + 'a'.repeat(64),
        timestamp: new Date().toISOString(),
        consensusRound: 10,
        executionDurationMs: 12,
        errorCode: null,
        errorMessage: null,
        stateChanges: [
          {
            entity: 'Beneficiary',
            entityId: 'BEN-1001',
            field: 'currentMonthClaimed.Rice',
            previousValue: 0,
            newValue: 2,
            delta: 2
          },
          {
            entity: 'ShopInventory',
            entityId: 'FPS-102:Rice',
            field: 'quantity',
            previousValue: 1800,
            newValue: 1798,
            delta: -2
          }
        ]
      };

      const record = await PDSReceipt.create({
        transactionId: sampleReceipt.transactionId,
        receiptNumber: sampleReceipt.receiptNumber,
        blockNumber: sampleReceipt.blockNumber,
        blockHash: sampleReceipt.blockHash,
        receiptData: sampleReceipt
      });

      expect(record.id).toBeDefined();
      expect(record.transactionId).toBe('TXN-UNIT-TEST-001');
      expect(record.receiptNumber).toBe('REC-UNIT-TEST-001');
      expect(record.blockNumber).toBe(10);
      expect(record.blockHash).toBe(sampleReceipt.blockHash);
      expect(record.receiptData).toEqual(sampleReceipt);
      expect(record.receiptData.stateChanges).toHaveLength(2);
      expect(record.receiptData.stateChanges[0]).toEqual(sampleReceipt.stateChanges[0]);
      expect(record.receiptData.stateChanges[1]).toEqual(sampleReceipt.stateChanges[1]);
    });

    it('rejects duplicate transactionId via unique constraint', async () => {
      const duplicateReceipt = {
        receiptNumber: 'REC-UNIT-TEST-001-DUP',
        transactionId: 'TXN-UNIT-TEST-001',
        status: 'SUCCESS',
        transactionType: 'DISTRIBUTION',
        blockNumber: 11,
        blockHash: '0x' + 'b'.repeat(64),
        stateChanges: []
      };

      await expect(
        PDSReceipt.create({
          transactionId: duplicateReceipt.transactionId,
          receiptNumber: duplicateReceipt.receiptNumber,
          blockNumber: duplicateReceipt.blockNumber,
          blockHash: duplicateReceipt.blockHash,
          receiptData: duplicateReceipt
        })
      ).rejects.toThrow();
    });

    it('enforces immutability by rejecting updates and deletions on finalized PDSReceipt records', async () => {
      const existing = await PDSReceipt.findOne({ where: { transactionId: 'TXN-UNIT-TEST-001' } });
      expect(existing).not.toBeNull();

      await expect(existing.update({ blockNumber: 999 })).rejects.toThrow(
        /PDSReceipt for transaction .* is immutable and cannot be updated/i
      );

      await expect(existing.destroy()).rejects.toThrow(
        /PDSReceipt for transaction .* is immutable and cannot be deleted/i
      );
    });

    it('atomically persists PDSReceipt during processDistribution with finalized blockNumber and blockHash', async () => {
      const result = await transactionService.processDistribution({
        beneficiaryId: 'BEN-1001',
        shopId: 'FPS-102',
        commodity: 'Rice',
        quantity: 3
      });

      expect(result.success).toBe(true);
      const txId = result.transaction.transactionId;
      const finalizedBlockNumber = result.block.blockNumber;
      const finalizedBlockHash = result.block.blockHash;

      const persisted = await PDSReceipt.findOne({ where: { transactionId: txId } });
      expect(persisted).not.toBeNull();
      expect(persisted.transactionId).toBe(txId);
      expect(persisted.receiptNumber).toBe(`REC-${txId.replace('TXN-', '')}`);
      expect(persisted.blockNumber).toBe(finalizedBlockNumber);
      expect(persisted.blockHash).toBe(finalizedBlockHash);
      expect(persisted.receiptData.transactionId).toBe(txId);
      expect(persisted.receiptData.blockNumber).toBe(finalizedBlockNumber);
      expect(persisted.receiptData.blockHash).toBe(finalizedBlockHash);
      expect(persisted.receiptData.status).toBe('SUCCESS');
      expect(persisted.receiptData.transactionType).toBe('DISTRIBUTION');
      expect(Array.isArray(persisted.receiptData.stateChanges)).toBe(true);
      expect(persisted.receiptData.stateChanges.length).toBeGreaterThanOrEqual(2);
    });

    it('rolls back beneficiary quota, shop inventory, and transaction record if PDSReceipt persistence fails', async () => {
      const benBefore = await Beneficiary.findOne({ where: { beneficiaryId: 'BEN-1002' } });
      const invBefore = await Inventory.findOne({
        where: { ownerType: 'SHOP', ownerId: 'FPS-102', commodityName: 'Wheat' }
      });
      const txCountBefore = await Transaction.count();
      const claimedWheatBefore = (benBefore.currentMonthClaimed && benBefore.currentMonthClaimed.Wheat) || 0;
      const shopWheatBefore = invBefore.quantity;

      const createSpy = jest.spyOn(PDSReceipt, 'create').mockRejectedValueOnce(
        new Error('Simulated PDSReceipt persistence failure inside atomic transaction')
      );

      try {
        await expect(
          transactionService.processDistribution({
            beneficiaryId: 'BEN-1002',
            shopId: 'FPS-102',
            commodity: 'Wheat',
            quantity: 2
          })
        ).rejects.toThrow(/Simulated PDSReceipt persistence failure/i);
      } finally {
        createSpy.mockRestore();
        fbaInstance.voteStore.clear();
      }

      const benAfter = await Beneficiary.findOne({ where: { beneficiaryId: 'BEN-1002' } });
      const invAfter = await Inventory.findOne({
        where: { ownerType: 'SHOP', ownerId: 'FPS-102', commodityName: 'Wheat' }
      });
      const txCountAfter = await Transaction.count();

      expect((benAfter.currentMonthClaimed && benAfter.currentMonthClaimed.Wheat) || 0).toBe(claimedWheatBefore);
      expect(invAfter.quantity).toBe(shopWheatBefore);
      expect(txCountAfter).toBe(txCountBefore);
    });

    it('atomically persists PDSReceipt during processWarehouseTransfer', async () => {
      const transferResult = await transactionService.processWarehouseTransfer(
        {
          warehouseId: 'WH-003',
          shopId: 'FPS-102',
          commodity: 'Rice',
          quantity: 10
        },
        { username: 'warehouse', role: 'WAREHOUSE', entityId: 'WH-003' }
      );

      expect(transferResult.success).toBe(true);
      const txId = transferResult.transaction.transactionId;
      const persisted = await PDSReceipt.findOne({ where: { transactionId: txId } });
      expect(persisted).not.toBeNull();
      expect(persisted.blockNumber).toBe(transferResult.block.blockNumber);
      expect(persisted.blockHash).toBe(transferResult.block.blockHash);
      expect(persisted.receiptData.transactionType).toBe('WAREHOUSE_TRANSFER');
      expect(persisted.receiptData.status).toBe('SUCCESS');
      expect(Array.isArray(persisted.receiptData.stateChanges)).toBe(true);
      expect(persisted.receiptData.stateChanges.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('2. Receipt API Retrieval & Fallback Semantics', () => {
    let distTxId;
    let distReceipt;

    beforeAll(async () => {
      const result = await transactionService.processDistribution({
        beneficiaryId: 'BEN-1003',
        shopId: 'FPS-102',
        commodity: 'Sugar',
        quantity: 1
      });
      distTxId = result.transaction.transactionId;
      distReceipt = result.receipt.toJSON ? result.receipt.toJSON() : result.receipt;
    });

    it('GET /api/transactions/:id/receipt returns HTTP 200 with full persisted PDS receiptData', async () => {
      const res = await request(app).get(`/api/transactions/${distTxId}/receipt`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.receipt).toBeDefined();
      expect(res.body.receipt.receiptNumber).toBe(distReceipt.receiptNumber);
      expect(res.body.receipt.transactionId).toBe(distTxId);
      expect(res.body.receipt.status).toBe('SUCCESS');
      expect(res.body.receipt.transactionType).toBe('DISTRIBUTION');
      expect(res.body.receipt.blockNumber).toBe(distReceipt.blockNumber);
      expect(res.body.receipt.blockHash).toBe(distReceipt.blockHash);
      expect(res.body.receipt.timestamp).toBe(distReceipt.timestamp);
      expect(res.body.receipt.consensusRound).toBe(distReceipt.consensusRound);
      expect(res.body.receipt.errorCode).toBeNull();
      expect(res.body.receipt.errorMessage).toBeNull();
      expect(res.body.receipt.verificationStatus).toBe(distReceipt.verificationStatus);
      expect(res.body.receipt.stateChanges).toEqual(distReceipt.stateChanges);
    });

    it('GET /api/contracts/transactions/:id/receipt also returns HTTP 200 for persisted PDS receipt', async () => {
      const res = await request(app).get(`/api/contracts/transactions/${distTxId}/receipt`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.receipt.transactionId).toBe(distTxId);
      expect(res.body.receipt.stateChanges).toEqual(distReceipt.stateChanges);
    });

    it('GET /api/v1/transactions/:id/receipt returns HTTP 200 with envelope containing full PDS receipt', async () => {
      const res = await request(app).get(`/api/v1/transactions/${distTxId}/receipt`);
      expect(res.status).toBe(200);
      expect(res.body.error).toBeNull();
      expect(res.body.meta.finality).toBe('FINALIZED');
      expect(res.body.data.transactionId).toBe(distTxId);
      expect(res.body.data.receiptNumber).toBe(distReceipt.receiptNumber);
      expect(res.body.data.stateChanges).toEqual(distReceipt.stateChanges);
    });

    it('queries PDSReceipt before falling back to evmRuntime.getReceipt', async () => {
      const evmGetReceiptSpy = jest.spyOn(evmRuntime, 'getReceipt');
      try {
        const res = await request(app).get(`/api/transactions/${distTxId}/receipt`);
        expect(res.status).toBe(200);
        expect(res.body.receipt.transactionId).toBe(distTxId);
        expect(evmGetReceiptSpy).not.toHaveBeenCalled();
      } finally {
        evmGetReceiptSpy.mockRestore();
      }
    });

    it('preserves EVM receipt fallback when no PDSReceipt exists', async () => {
      const evmTxId = 'TXN-EVM-FALLBACK-TEST-01';
      const registryContract = evmRuntime.contractRegistry
        ? evmRuntime.contractRegistry.getContract('BeneficiaryRegistry')
        : require('../src/evm').contractRegistry.getContract('BeneficiaryRegistry');

      await evmRuntime.executeContractCall({
        transactionId: evmTxId,
        caller: evmRuntime.adminAddress,
        contractAddress: registryContract.address,
        method: 'registerBeneficiary',
        args: ['BEN-EVM-909', 'Chennai Central', 4]
      });

      const pdsRecord = await PDSReceipt.findOne({ where: { transactionId: evmTxId } });
      expect(pdsRecord).toBeNull();

      const res = await request(app).get(`/api/transactions/${evmTxId}/receipt`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.receipt.transactionId).toBe(evmTxId);
      expect(res.body.receipt.contractAddress).toBe(registryContract.address);
    });

    it('returns HTTP 404 when receipt exists in neither PDSReceipt nor EVM runtime', async () => {
      const res = await request(app).get('/api/transactions/TXN-NONEXISTENT-999999/receipt');
      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });

    it('passes unexpected database lookup errors through error middleware cleanly', async () => {
      const findOneSpy = jest.spyOn(PDSReceipt, 'findOne').mockRejectedValueOnce(
        new Error('Database connection interrupted during receipt lookup')
      );
      try {
        const res = await request(app).get(`/api/transactions/${distTxId}/receipt`);
        expect(res.status).toBe(500);
        expect(res.body.success).toBe(false);
      } finally {
        findOneSpy.mockRestore();
      }
    });
  });

  describe('3. Safe Versioned Migration (002_pds_receipts)', () => {
    it('applies 002_pds_receipts cleanly, creates required columns and indexes, and is idempotent', async () => {
      const queryInterface = sequelize.getQueryInterface();
      const migrationManager = new DatabaseMigrationManager({ sequelize });
      await migrationManager.ensureMigrationTable();

      await migration002PdsReceipts.up(sequelize);

      const tableDesc = await queryInterface.describeTable('pds_receipts');
      expect(tableDesc.id).toBeDefined();
      expect(tableDesc.transactionId).toBeDefined();
      expect(tableDesc.transactionId.allowNull).toBe(false);
      expect(tableDesc.receiptNumber).toBeDefined();
      expect(tableDesc.blockNumber).toBeDefined();
      expect(tableDesc.blockNumber.allowNull).toBe(false);
      expect(tableDesc.blockHash).toBeDefined();
      expect(tableDesc.blockHash.allowNull).toBe(false);
      expect(tableDesc.receiptData).toBeDefined();
      expect(tableDesc.receiptData.allowNull).toBe(false);
      expect(tableDesc.createdAt).toBeDefined();
      expect(tableDesc.updatedAt).toBeDefined();

      const indexes = await queryInterface.showIndex('pds_receipts');
      const hasTxIdUnique = indexes.some(
        (idx) =>
          idx.name === 'pds_receipts_transaction_id_unique' ||
          (idx.unique === true && idx.fields.some((f) => (f.attribute || f.name) === 'transactionId'))
      );
      const hasBlockNumIdx = indexes.some(
        (idx) =>
          idx.name === 'pds_receipts_block_number_idx' ||
          idx.fields.some((f) => (f.attribute || f.name) === 'blockNumber')
      );
      expect(hasTxIdUnique).toBe(true);
      expect(hasBlockNumIdx).toBe(true);

      // Apply via DatabaseMigrationManager and verify idempotency on second run
      const firstRun = await migrationManager.applyMigration(migration002PdsReceipts);
      expect(firstRun.version).toBe(2);

      const secondRun = await migrationManager.applyMigration(migration002PdsReceipts);
      expect(secondRun.skipped).toBe(true);
      expect(secondRun.version).toBe(2);
    });

    it('drops only pds_receipts on non-production test rollback and recreates cleanly', async () => {
      const queryInterface = sequelize.getQueryInterface();
      const txCountBefore = await Transaction.count();

      await migration002PdsReceipts.down(sequelize);

      let existsAfterDown = true;
      try {
        await queryInterface.describeTable('pds_receipts');
      } catch (_err) {
        existsAfterDown = false;
      }
      expect(existsAfterDown).toBe(false);

      // Verify other tables (e.g. transactions) were untouched
      const txCountAfterDown = await Transaction.count();
      expect(txCountAfterDown).toBe(txCountBefore);

      // Recreate via up() so subsequent tests or hooks have pds_receipts
      await migration002PdsReceipts.up(sequelize);
      const tableDescAfterUp = await queryInterface.describeTable('pds_receipts');
      expect(tableDescAfterUp.transactionId).toBeDefined();
    });
  });
});
