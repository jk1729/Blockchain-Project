/**
 * Merkle Proof Generation & Indexer Test Suite (Phase 16 - Stage E, F, G, H & Q)
 */

const blockchainService = require('../src/services/blockchainService');
const Transaction = require('../src/blockchain/Transaction');
const EVMReceipt = require('../src/evm/EVMReceipt');
const {
  MerkleTree,
  verifyMerkleProof,
  MERKLE_ERROR_CODES,
  ProofIndexer
} = require('../src/blockchain/merkle');

describe('Merkle Proof Generation & Indexer Test Suite', () => {
  let createdTxIds = [];

  beforeAll(async () => {
    // Ensure blockchain is initialized
    await blockchainService.init();

    // Create several test transactions in a new block
    const tx1 = new Transaction({
      transactionId: 'TXN-PROOF-001',
      sender: 'BEN-001',
      receiver: 'FPS-001',
      payload: { commodity: 'Rice', quantity: 5 }
    });
    const tx2 = new Transaction({
      transactionId: 'TXN-PROOF-002',
      sender: 'BEN-002',
      receiver: 'FPS-001',
      payload: { commodity: 'Wheat', quantity: 10 }
    });
    const tx3 = new Transaction({
      transactionId: 'TXN-PROOF-003',
      sender: 'BEN-003',
      receiver: 'FPS-002',
      payload: { commodity: 'Sugar', quantity: 2 }
    });

    createdTxIds = [tx1.transactionId, tx2.transactionId, tx3.transactionId];

    const receipt1 = new EVMReceipt({
      transactionId: tx1.transactionId,
      contractAddress: '0x1111111111111111111111111111111111111111',
      status: 'SUCCESS',
      gasUsed: 21000,
      logs: [{
        eventId: 'EVT-PROOF-LOG-01',
        topics: ['0xtopic1'],
        data: '0xdata1'
      }]
    });

    const receiptsRoot = new MerkleTree([receipt1], { commitmentType: 'RECEIPT' }).getRoot();

    await blockchainService.addBlock(
      [tx1.toBlockPayload(), tx2.toBlockPayload(), tx3.toBlockPayload()],
      [],
      null,
      '0x' + '1'.repeat(64),
      {
        version: 1,
        receiptsRoot,
        executionReceipts: [receipt1.toJSON()],
        consensusStatus: 'FINALIZED'
      }
    );
  });

  describe('1. Transaction Inclusion Proof Generation', () => {
    test('should generate and verify proof for the first transaction in block', () => {
      const proof = blockchainService.getTransactionProof('TXN-PROOF-001');
      expect(proof).toBeDefined();
      expect(proof.leafIndex).toBe(0);
      expect(proof.totalLeaves).toBe(3);
      expect(proof.finality).toBe('FINALIZED');
      expect(proof.expectedRoot).toBeDefined();

      const verification = proof.verify();
      expect(verification.valid).toBe(true);
      expect(verification.computedRoot).toBe(proof.expectedRoot);
    });

    test('should generate and verify proof for the middle transaction in block', () => {
      const proof = blockchainService.getTransactionProof('TXN-PROOF-002');
      expect(proof).toBeDefined();
      expect(proof.leafIndex).toBe(1);
      expect(proof.totalLeaves).toBe(3);

      const verification = proof.verify();
      expect(verification.valid).toBe(true);
    });

    test('should generate and verify proof for the last transaction in block', () => {
      const proof = blockchainService.getTransactionProof('TXN-PROOF-003');
      expect(proof).toBeDefined();
      expect(proof.leafIndex).toBe(2);
      expect(proof.totalLeaves).toBe(3);

      const verification = proof.verify();
      expect(verification.valid).toBe(true);
    });

    test('should fail when requesting proof for non-existent transaction', () => {
      expect(() => {
        blockchainService.getTransactionProof('TXN-NON-EXISTENT-999');
      }).toThrow();
    });
  });

  describe('2. Receipt Inclusion Proof Generation', () => {
    test('should generate and verify receipt proof when receiptsRoot exists', () => {
      const receiptProof = blockchainService.getReceiptProof('TXN-PROOF-001');
      expect(receiptProof).toBeDefined();
      expect(receiptProof.commitmentType).toBe('RECEIPT');
      expect(receiptProof.leafIndex).toBe(0);

      const verification = receiptProof.verify();
      expect(verification.valid).toBe(true);
    });
  });

  describe('3. Event Log Proof Generation', () => {
    test('should generate event proof linked to parent receipt commitment', () => {
      const eventProof = blockchainService.getEventProof('EVT-PROOF-LOG-01');
      expect(eventProof).toBeDefined();
      expect(eventProof.eventId).toBe('EVT-PROOF-LOG-01');
      expect(eventProof.logIndex).toBe(0);
      expect(eventProof.receiptProof).toBeDefined();

      const ver = verifyMerkleProof(eventProof.receiptProof);
      expect(ver.valid).toBe(true);
    });
  });

  describe('4. Proof Indexer Rebuild & Sync Safety', () => {
    test('should rebuild index successfully and maintain proof capability', () => {
      const rebuildRes = blockchainService.proofIndexer.rebuild(blockchainService.blockchain.chain);
      expect(rebuildRes.success).toBe(true);
      expect(rebuildRes.indexedBlocks).toBeGreaterThan(0);

      const proofAfterRebuild = blockchainService.getTransactionProof('TXN-PROOF-002');
      expect(proofAfterRebuild.verify().valid).toBe(true);
    });

    test('should reject proof generation when indexer status is SYNCING', () => {
      const customIndexer = new ProofIndexer();
      customIndexer.setStatus('SYNCING');

      expect(() => {
        customIndexer.generateTransactionProof('TXN-PROOF-001');
      }).toThrow(/synchronizing/);
    });

    test('should retrieve block Merkle tree structure for visualization', () => {
      const latestBlock = blockchainService.blockchain.getLatestBlock();
      const treeData = blockchainService.getBlockTree(latestBlock.blockNumber);

      expect(treeData).toBeDefined();
      expect(treeData.blockNumber).toBe(latestBlock.blockNumber);
      expect(treeData.merkleRoot).toBe(latestBlock.merkleRoot);
      expect(treeData.layers.length).toBeGreaterThan(0);
      expect(treeData.totalTransactions).toBe(3);
    });
  });
});

