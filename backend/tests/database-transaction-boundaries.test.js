const crypto = require('crypto');
const { DatabaseTransactionManager, DatabaseTransactionError } = require('../src/database/DatabaseTransactionManager');
const { defaultDatabaseManager } = require('../src/database');
const { sequelize, Block, Receipt, EventRecord, CheckpointRecord } = require('../src/models');

describe('Phase 18: Database Transaction Boundaries & Atomic Commits', () => {
  let txManager;

  beforeAll(async () => {
    await defaultDatabaseManager.init();
    await sequelize.sync({ alter: false });
    txManager = new DatabaseTransactionManager({ sequelize });
  });

  describe('1. Atomic Block Finalization Commit', () => {
    test('should atomically persist block, receipts, checkpoint, and events', async () => {
      const blockNumber = 50000 + Math.floor(Math.random() * 5000);
      const blockHash = '0x' + crypto.randomBytes(32).toString('hex');
      const block = {
        blockNumber,
        blockHash,
        previousHash: '0x' + crypto.randomBytes(32).toString('hex'),
        timestamp: new Date().toISOString(),
        transactions: [{ transactionId: `TX-${blockNumber}` }],
        merkleRoot: '0xroot',
        proposerId: 'VAL-01',
        consensusStatus: 'FINALIZED'
      };

      const receipts = [
        {
          transactionHash: '0xtx-' + crypto.randomBytes(16).toString('hex'),
          transactionId: `TX-${blockNumber}`,
          receiptHash: '0xrec-' + crypto.randomBytes(16).toString('hex'),
          status: 'SUCCESS',
          gasUsed: 21000
        }
      ];

      const checkpoint = {
        blockHeight: blockNumber,
        blockHash,
        stateRoot: '0xstate',
        certificateHash: '0xcert',
        validatorApprovals: ['VAL-01']
      };

      const events = [
        {
          eventId: 'EV-' + crypto.randomBytes(16).toString('hex'),
          eventType: 'BLOCK_FINALIZED',
          category: 'BLOCKCHAIN',
          payload: { height: blockNumber }
        }
      ];

      const result = await txManager.commitFinalizedBlock({
        block,
        receipts,
        events,
        checkpoint
      });

      expect(result.success).toBe(true);
      expect(result.blockNumber).toBe(blockNumber);

      // Verify records are present in database
      const dbBlock = await Block.findOne({ where: { blockNumber } });
      expect(dbBlock).not.toBeNull();

      const dbReceipt = await Receipt.findOne({ where: { transactionHash: receipts[0].transactionHash } });
      expect(dbReceipt).not.toBeNull();

      const dbCp = await CheckpointRecord.findOne({ where: { checkpointHeight: blockNumber } });
      expect(dbCp).not.toBeNull();

      const dbEvent = await EventRecord.findOne({ where: { eventId: events[0].eventId } });
      expect(dbEvent).not.toBeNull();
    });

    test('should completely roll back all changes when a fault or error occurs before commit', async () => {
      const blockNumber = 60000 + Math.floor(Math.random() * 5000);
      const blockHash = '0x' + crypto.randomBytes(32).toString('hex');
      const block = {
        blockNumber,
        blockHash,
        previousHash: '0x' + crypto.randomBytes(32).toString('hex'),
        timestamp: new Date().toISOString(),
        transactions: [],
        merkleRoot: '0xroot',
        proposerId: 'VAL-01',
        consensusStatus: 'FINALIZED'
      };

      const txHash = '0xtx-' + crypto.randomBytes(16).toString('hex');
      const receipts = [
        {
          transactionHash: txHash,
          transactionId: 'TX-ROLLBACK',
          receiptHash: '0xrec-rollback'
        }
      ];

      // Inject simulated database failure right before commit
      await expect(txManager.commitFinalizedBlock({
        block,
        receipts,
        options: { faultInjection: { failBeforeCommit: true } }
      })).rejects.toThrow(DatabaseTransactionError);

      // Verify that block was rolled back and is NOT in database
      const dbBlock = await Block.findOne({ where: { blockNumber } });
      expect(dbBlock).toBeNull();

      const dbReceipt = await Receipt.findOne({ where: { transactionHash: txHash } });
      expect(dbReceipt).toBeNull();
    });
  });

  describe('2. Synchronization Batch Commit', () => {
    test('should commit a bounded batch of sync blocks atomically', async () => {
      const bNum1 = 70000 + Math.floor(Math.random() * 5000);
      const bNum2 = bNum1 + 1;
      const bHash1 = '0x' + crypto.randomBytes(32).toString('hex');
      const bHash2 = '0x' + crypto.randomBytes(32).toString('hex');
      const syncBlocks = [
        {
          blockNumber: bNum1,
          blockHash: bHash1,
          previousHash: '0xprev',
          timestamp: new Date().toISOString(),
          transactions: [],
          merkleRoot: '0xr',
          consensusStatus: 'FINALIZED'
        },
        {
          blockNumber: bNum2,
          blockHash: bHash2,
          previousHash: bHash1,
          timestamp: new Date().toISOString(),
          transactions: [],
          merkleRoot: '0xr',
          consensusStatus: 'FINALIZED'
        }
      ];

      const res = await txManager.commitSyncBatch(syncBlocks);
      expect(res.success).toBe(true);
      expect(res.blocksCommitted).toBe(2);

      const b1 = await Block.findOne({ where: { blockNumber: bNum1 } });
      const b2 = await Block.findOne({ where: { blockNumber: bNum2 } });
      expect(b1).not.toBeNull();
      expect(b2).not.toBeNull();
    });
  });
});
