/**
 * PDSChain Transaction Mempool Comprehensive Test Suite
 * 
 * Verifies:
 * - Admission pipeline & Cryptographic validation
 * - Duplicate & conflicting nonce prevention
 * - Nonce sequencing & explicit READY/QUEUED gap policy
 * - Capacity limits & transaction size limits
 * - TTL expiration & cleanup
 * - Deterministic candidate selection
 * - Block inclusion removal & queued promotion
 * - Security & key privacy
 * - End-to-end integration flow through FBA consensus
 */

const { Mempool, MempoolEntry, MempoolStatus, MempoolPolicy, MempoolError, MempoolErrorCodes } = require('../src/blockchain/mempool');
const Transaction = require('../src/blockchain/Transaction');
const { generateKeyPair, deriveAddress, getOrCreateDevParticipant } = require('../src/blockchain/identity/keyManager');
const stateManager = require('../src/execution/StateManager');
const executionEngine = require('../src/execution/ExecutionEngine');
const blockchainService = require('../src/services/blockchainService');
const consensusService = require('../src/services/consensusService');
const transactionService = require('../src/services/transactionService');
const { sequelize } = require('../src/config/database');
const Beneficiary = require('../src/models/Beneficiary');
const Shop = require('../src/models/Shop');
const Warehouse = require('../src/models/Warehouse');
const Inventory = require('../src/models/Inventory');
const TransactionModel = require('../src/models/Transaction');

describe('PDSChain Transaction Mempool Test Suite', () => {
  let mempool;
  let senderA, senderB, senderC;

  beforeAll(async () => {
    await sequelize.sync({ force: true });

    // Seed test beneficiary
    await Beneficiary.create({
      beneficiaryId: 'BEN-MEM-001',
      name: 'Ramesh Kumar',
      region: 'North District',
      household: '4 Members',
      eligibilityStatus: true,
      monthlyEntitlement: { Rice: 25, Wheat: 10, Sugar: 2 },
      currentMonthClaimed: { Rice: 0, Wheat: 0, Sugar: 0 },
      status: 'Active'
    });

    // Seed test shop
    await Shop.create({
      shopId: 'FPS-MEM-101',
      name: 'Central PDS Shop',
      region: 'North District',
      manager: 'Sunita Sharma',
      status: 'Active'
    });

    // Seed shop inventory
    await Inventory.create({
      ownerType: 'SHOP',
      ownerId: 'FPS-MEM-101',
      commodityName: 'Rice',
      quantity: 5000,
      reserved: 0,
      unit: 'KG',
      minThreshold: 100
    });
  });

  beforeEach(() => {
    stateManager.resetNonces();

    // Generate fresh cryptographic identities for tests
    const keyA = generateKeyPair();
    senderA = {
      ...keyA,
      entityId: 'SHOP-TEST-A'
    };

    const keyB = generateKeyPair();
    senderB = {
      ...keyB,
      entityId: 'SHOP-TEST-B'
    };

    const keyC = generateKeyPair();
    senderC = {
      ...keyC,
      entityId: 'SHOP-TEST-C'
    };

    // Instantiate fresh mempool with default test policy
    mempool = new Mempool({
      maxTransactions: 50,
      maxTransactionsPerSender: 10,
      transactionTTL: 3600000, // 1 hour
      maxFutureNonceGap: 5,
      maxTransactionSizeBytes: 4096
    }, stateManager);
  });

  afterAll(async () => {
    await sequelize.close();
  });

  // Helper to create and sign a transaction
  function createSignedTx(senderIdentity, {
    beneficiaryId = 'BEN-MEM-001',
    shopId = 'FPS-MEM-101',
    commodity = 'Rice',
    quantity = 5,
    nonce = 0,
    timestamp = new Date().toISOString()
  } = {}) {
    const tx = new Transaction({
      type: 'DISTRIBUTION',
      sender: senderIdentity.address,
      senderPublicKey: senderIdentity.publicKey,
      beneficiaryId,
      receiver: shopId,
      shopId,
      payload: {
        beneficiaryId,
        shopId,
        commodity,
        quantity,
        unit: 'KG',
        name: 'Ramesh Kumar',
        senderPublicKey: senderIdentity.publicKey
      },
      timestamp,
      nonce
    });

    tx.sign(senderIdentity.privateKey, senderIdentity.publicKey);
    return tx;
  }

  // =========================================================================
  // SECTION A: BASIC ADMISSION & SIGNATURE ENFORCEMENT
  // =========================================================================
  describe('A. Basic Admission & Cryptographic Validation', () => {
    test('1. should successfully admit a valid signed transaction as READY', () => {
      const tx = createSignedTx(senderA, { nonce: 0 });
      const entry = mempool.addTransaction(tx);

      expect(entry).toBeInstanceOf(MempoolEntry);
      expect(entry.transactionId).toBe(tx.transactionId);
      expect(entry.status).toBe(MempoolStatus.READY);
      expect(entry.sender).toBe(senderA.address);
      expect(entry.nonce).toBe(0);
      expect(mempool.entries.has(tx.transactionId)).toBe(true);
    });

    test('2. should reject null or malformed transaction objects', () => {
      expect(() => mempool.addTransaction(null)).toThrow(MempoolError);
      expect(() => mempool.addTransaction({})).toThrow(MempoolError);
      expect(() => mempool.addTransaction({ sender: senderA.address })).toThrow(MempoolError);
    });

    test('3. should reject an unsigned transaction with INVALID_SIGNATURE', () => {
      const tx = new Transaction({
        sender: senderA.address,
        receiver: 'FPS-MEM-101',
        nonce: 0,
        payload: { commodity: 'Rice', quantity: 5 }
      });

      expect(() => mempool.addTransaction(tx)).toThrow(
        expect.objectContaining({ code: MempoolErrorCodes.INVALID_SIGNATURE })
      );
    });

    test('4. should reject transaction when signature does not match tampered payload', () => {
      const tx = createSignedTx(senderA, { quantity: 5, nonce: 0 });
      // Tamper payload after signing and update ID to match new payload
      tx.payload.quantity = 500;
      const { generateDeterministicTxId } = require('../src/blockchain/serialization');
      tx.transactionId = generateDeterministicTxId(tx.calculateHash());

      expect(() => mempool.addTransaction(tx)).toThrow(
        expect.objectContaining({ code: MempoolErrorCodes.INVALID_SIGNATURE })
      );
    });

    test('4b. should reject transaction with corrupted signature bytes', () => {
      const tx = createSignedTx(senderA, { nonce: 0 });
      tx.signature = '00'.repeat(64);

      expect(() => mempool.addTransaction(tx)).toThrow(
        expect.objectContaining({ code: MempoolErrorCodes.INVALID_SIGNATURE })
      );
    });

    test('5. should reject transaction with invalid or mismatched transactionId', () => {
      const tx = createSignedTx(senderA, { nonce: 0 });
      tx.transactionId = 'TXN-FAKE000000000000';

      expect(() => mempool.addTransaction(tx)).toThrow(
        expect.objectContaining({ code: MempoolErrorCodes.INVALID_TRANSACTION_ID })
      );
    });
  });

  // =========================================================================
  // SECTION B: DUPLICATES & NONCE CONFLICTS
  // =========================================================================
  describe('B. Duplicate and Conflicting Nonce Protection', () => {
    test('6. should reject duplicate transaction ID submission', () => {
      const tx = createSignedTx(senderA, { nonce: 0 });
      mempool.addTransaction(tx);

      expect(() => mempool.addTransaction(tx)).toThrow(
        expect.objectContaining({ code: MempoolErrorCodes.DUPLICATE_TRANSACTION })
      );
    });

    test('7. should reject resubmission of already committed transaction ID', () => {
      const tx = createSignedTx(senderA, { nonce: 0 });
      stateManager.recordTransactionId(tx.transactionId);

      expect(() => mempool.addTransaction(tx)).toThrow(
        expect.objectContaining({ code: MempoolErrorCodes.DUPLICATE_TRANSACTION })
      );
    });

    test('8. should reject conflicting transaction with same sender and nonce but different payload', () => {
      const tx1 = createSignedTx(senderA, { commodity: 'Rice', quantity: 5, nonce: 0 });
      const tx2 = createSignedTx(senderA, { commodity: 'Wheat', quantity: 10, nonce: 0 });

      mempool.addTransaction(tx1);

      expect(() => mempool.addTransaction(tx2)).toThrow(
        expect.objectContaining({ code: MempoolErrorCodes.CONFLICTING_NONCE })
      );
    });
  });

  // =========================================================================
  // SECTION C: NONCE SEQUENCING & NONCE GAP POLICY
  // =========================================================================
  describe('C. Nonce Sequencing & Nonce Gap Policy', () => {
    test('9. should admit expected nonce as READY', () => {
      const tx = createSignedTx(senderA, { nonce: 0 });
      const entry = mempool.addTransaction(tx);
      expect(entry.status).toBe(MempoolStatus.READY);
    });

    test('10. should reject stale/consumed nonce with REPLAYED_NONCE', () => {
      stateManager.consumeNonce(senderA.address, 3); // expected is 4

      const txStale = createSignedTx(senderA, { nonce: 2 });
      expect(() => mempool.addTransaction(txStale)).toThrow(
        expect.objectContaining({ code: MempoolErrorCodes.REPLAYED_NONCE })
      );
    });

    test('11. should admit future nonce within allowable gap as QUEUED', () => {
      // Expected nonce is 0, submitting nonce 2
      const txFuture = createSignedTx(senderA, { nonce: 2 });
      const entry = mempool.addTransaction(txFuture);

      expect(entry.status).toBe(MempoolStatus.QUEUED);
      expect(entry.nonce).toBe(2);
    });

    test('12. should reject future nonce exceeding maxFutureNonceGap with NONCE_GAP', () => {
      // Max gap is configured as 5, submitting nonce 10
      const txFarFuture = createSignedTx(senderA, { nonce: 10 });

      expect(() => mempool.addTransaction(txFarFuture)).toThrow(
        expect.objectContaining({ code: MempoolErrorCodes.NONCE_GAP })
      );
    });

    test('13. should maintain per-sender isolated nonce tracking', () => {
      stateManager.consumeNonce(senderA.address, 5); // senderA expected = 6

      const txA = createSignedTx(senderA, { nonce: 6 });
      const txB = createSignedTx(senderB, { nonce: 0 }); // senderB expected = 0

      const entryA = mempool.addTransaction(txA);
      const entryB = mempool.addTransaction(txB);

      expect(entryA.status).toBe(MempoolStatus.READY);
      expect(entryB.status).toBe(MempoolStatus.READY);
    });

    test('14. should promote QUEUED transactions to READY when earlier nonces are committed', () => {
      // Sender starts at expected nonce = 0
      const tx0 = createSignedTx(senderA, { nonce: 0, quantity: 1 });
      const tx1 = createSignedTx(senderA, { nonce: 1, quantity: 2 });
      const tx2 = createSignedTx(senderA, { nonce: 2, quantity: 3 });

      // Add tx1 and tx2 first (both QUEUED)
      const entry1 = mempool.addTransaction(tx1);
      const entry2 = mempool.addTransaction(tx2);
      expect(entry1.status).toBe(MempoolStatus.QUEUED);
      expect(entry2.status).toBe(MempoolStatus.QUEUED);

      // Add tx0 (READY)
      const entry0 = mempool.addTransaction(tx0);
      expect(entry0.status).toBe(MempoolStatus.READY);

      // Simulate mining tx0 into a block and advancing nonce
      stateManager.consumeNonce(senderA.address, 0);
      mempool.removeIncludedTransactions([tx0.transactionId], 1);

      // Both tx1 and tx2 should now be promoted to READY in order
      expect(entry1.status).toBe(MempoolStatus.READY);
      expect(entry2.status).toBe(MempoolStatus.READY);
    });
  });

  // =========================================================================
  // SECTION D: CAPACITY & SIZE CONSTRAINTS
  // =========================================================================
  describe('D. Capacity and Size Constraints', () => {
    test('15. should enforce global mempool maximum capacity limit', () => {
      const tinyPool = new Mempool({ maxTransactions: 2 }, stateManager);

      const tx1 = createSignedTx(senderA, { nonce: 0 });
      const tx2 = createSignedTx(senderB, { nonce: 0 });
      const tx3 = createSignedTx(senderC, { nonce: 0 });

      tinyPool.addTransaction(tx1);
      tinyPool.addTransaction(tx2);

      expect(() => tinyPool.addTransaction(tx3)).toThrow(
        expect.objectContaining({ code: MempoolErrorCodes.MEMPOOL_FULL })
      );
    });

    test('16. should enforce per-sender maximum pending limit', () => {
      const smallSenderPool = new Mempool({ maxTransactionsPerSender: 2 }, stateManager);

      const tx1 = createSignedTx(senderA, { nonce: 0 });
      const tx2 = createSignedTx(senderA, { nonce: 1 });
      const tx3 = createSignedTx(senderA, { nonce: 2 });

      smallSenderPool.addTransaction(tx1);
      smallSenderPool.addTransaction(tx2);

      expect(() => smallSenderPool.addTransaction(tx3)).toThrow(
        expect.objectContaining({ code: MempoolErrorCodes.SENDER_LIMIT_EXCEEDED })
      );
    });

    test('17. should reject transactions exceeding max serialized byte size', () => {
      const strictSizePool = new Mempool({ maxTransactionSizeBytes: 100 }, stateManager);
      const tx = createSignedTx(senderA, { nonce: 0 });

      expect(() => strictSizePool.addTransaction(tx)).toThrow(
        expect.objectContaining({ code: MempoolErrorCodes.TRANSACTION_TOO_LARGE })
      );
    });
  });

  // =========================================================================
  // SECTION E: EXPIRATION (TTL) & CLEANUP
  // =========================================================================
  describe('E. Expiration (TTL) and Cleanup', () => {
    test('18. should correctly assign receivedAt and expiresAt timestamps', () => {
      const now = Date.now();
      const tx = createSignedTx(senderA, { nonce: 0 });
      const entry = mempool.addTransaction(tx);

      expect(entry.receivedAt).toBeGreaterThanOrEqual(now - 1000);
      expect(entry.expiresAt).toBe(entry.receivedAt + 3600000);
      expect(entry.isExpired(now + 1000)).toBe(false);
      expect(entry.isExpired(now + 3600001)).toBe(true);
    });

    test('19. should prune expired transactions during cleanupExpired()', () => {
      const shortTtlPool = new Mempool({ transactionTTL: 100 }, stateManager);
      const tx = createSignedTx(senderA, { nonce: 0 });
      shortTtlPool.addTransaction(tx);

      expect(shortTtlPool.entries.size).toBe(1);

      // Cleanup with future timestamp
      const futureTime = Date.now() + 500;
      const pruned = shortTtlPool.cleanupExpired(futureTime);

      expect(pruned).toBe(1);
      expect(shortTtlPool.entries.size).toBe(0);
      expect(shortTtlPool.getTransaction(tx.transactionId)).toBeNull();
    });

    test('20. should exclude expired transactions from candidate selection', () => {
      const shortTtlPool = new Mempool({ transactionTTL: 100 }, stateManager);
      const tx = createSignedTx(senderA, { nonce: 0 });
      const entry = shortTtlPool.addTransaction(tx);

      // Manually set expiration in past
      entry.expiresAt = Date.now() - 50;

      const candidates = shortTtlPool.getCandidateTransactions();
      expect(candidates).toHaveLength(0);
    });
  });

  // =========================================================================
  // SECTION F: DETERMINISTIC CANDIDATE SELECTION
  // =========================================================================
  describe('F. Deterministic Candidate Selection', () => {
    test('21. should only select READY transactions and exclude QUEUED ones', () => {
      const txReady = createSignedTx(senderA, { nonce: 0 });
      const txQueued = createSignedTx(senderA, { nonce: 2 }); // gap

      mempool.addTransaction(txReady);
      mempool.addTransaction(txQueued);

      const candidates = mempool.getCandidateTransactions();
      expect(candidates).toHaveLength(1);
      expect(candidates[0].transactionId).toBe(txReady.transactionId);
    });

    test('22. should sort transactions by sender address then nonce ascending', () => {
      const txA0 = createSignedTx(senderA, { nonce: 0 });
      const txA1 = createSignedTx(senderA, { nonce: 1 });
      const txB0 = createSignedTx(senderB, { nonce: 0 });

      mempool.addTransaction(txA1); // QUEUED
      mempool.addTransaction(txB0); // READY
      mempool.addTransaction(txA0); // READY (will promote txA1)

      // Promote txA1
      stateManager.consumeNonce(senderA.address, 0);
      mempool.promoteQueuedTransactions(senderA.address);

      const candidates = mempool.getCandidateTransactions();
      expect(candidates).toHaveLength(3);

      // Check deterministic ordering
      const senders = candidates.map(c => c.sender);
      const nonces = candidates.map(c => c.nonce);

      // Senders sorted alphabetically
      const sortedSenders = [...senders].sort();
      expect(senders[0]).toBe(sortedSenders[0]);

      // If senderA is first, nonces should be 0 then 1
      const aTxs = candidates.filter(c => c.sender === senderA.address);
      expect(aTxs[0].nonce).toBeLessThan(aTxs[1].nonce);
    });

    test('23. should respect the limit parameter during selection', () => {
      const txA = createSignedTx(senderA, { nonce: 0 });
      const txB = createSignedTx(senderB, { nonce: 0 });
      const txC = createSignedTx(senderC, { nonce: 0 });

      mempool.addTransaction(txA);
      mempool.addTransaction(txB);
      mempool.addTransaction(txC);

      const candidates = mempool.getCandidateTransactions(2);
      expect(candidates).toHaveLength(2);
    });
  });

  // =========================================================================
  // SECTION G: INCLUSION & REMOVAL
  // =========================================================================
  describe('G. Block Inclusion and Mempool Removal', () => {
    test('24. should remove included transactions upon block commit', () => {
      const tx = createSignedTx(senderA, { nonce: 0 });
      mempool.addTransaction(tx);

      expect(mempool.entries.has(tx.transactionId)).toBe(true);

      const removed = mempool.removeIncludedTransactions([tx.transactionId], 5);
      expect(removed).toBe(1);
      expect(mempool.entries.has(tx.transactionId)).toBe(false);
      expect(mempool.getTransactionsBySender(senderA.address)).toHaveLength(0);
    });

    test('25. should leave unrelated pending transactions intact when specific ones are included', () => {
      const txA = createSignedTx(senderA, { nonce: 0 });
      const txB = createSignedTx(senderB, { nonce: 0 });

      mempool.addTransaction(txA);
      mempool.addTransaction(txB);

      mempool.removeIncludedTransactions([txA.transactionId], 1);

      expect(mempool.entries.has(txA.transactionId)).toBe(false);
      expect(mempool.entries.has(txB.transactionId)).toBe(true);
      expect(mempool.entries.size).toBe(1);
    });
  });

  // =========================================================================
  // SECTION H: SECURITY & PRIVACY
  // =========================================================================
  describe('H. Security & Key Privacy', () => {
    test('26. should never store or leak private keys in MempoolEntry or public summaries', () => {
      const tx = createSignedTx(senderA, { nonce: 0 });
      const entry = mempool.addTransaction(tx);
      const summary = entry.toPublicSummary();
      const stats = mempool.getStats();

      const jsonStr = JSON.stringify({ entry, summary, stats });
      expect(jsonStr).not.toContain('PRIVATE KEY');
      expect(jsonStr).not.toContain(senderA.privateKey);
      expect(summary.sender).toBe(senderA.address);
      expect(summary.status).toBe(MempoolStatus.READY);
    });

    test('27. should reject tampering on sender address or public key', () => {
      const tx = createSignedTx(senderA, { nonce: 0 });
      // Tamper sender address to senderB's address
      tx.sender = senderB.address;

      expect(() => mempool.addTransaction(tx)).toThrow(
        expect.objectContaining({ code: MempoolErrorCodes.INVALID_SIGNATURE })
      );
    });
  });

  // =========================================================================
  // SECTION I: RESILIENCE & EDGE CASES
  // =========================================================================
  describe('I. Resilience & Edge Cases', () => {
    test('28. should handle cleanupExpired() gracefully on an empty mempool', () => {
      expect(mempool.cleanupExpired()).toBe(0);
    });

    test('29. should handle removeIncludedTransactions() with empty array or unknown IDs gracefully', () => {
      expect(mempool.removeIncludedTransactions([])).toBe(0);
      expect(mempool.removeIncludedTransactions(['TXN-NONEXISTENT0001'])).toBe(0);
    });

    test('30. should report accurate live metrics and utilization ratio', () => {
      const txA = createSignedTx(senderA, { nonce: 0 });
      const txB = createSignedTx(senderB, { nonce: 2 }); // QUEUED

      mempool.addTransaction(txA);
      mempool.addTransaction(txB);

      const stats = mempool.getStats();
      expect(stats.total).toBe(2);
      expect(stats.ready).toBe(1);
      expect(stats.queued).toBe(1);
      expect(stats.accepted).toBe(2);
      expect(stats.capacity).toBe(50);
      expect(stats.utilization).toBe(0.04);
    });
  });

  // =========================================================================
  // SECTION J: FULL END-TO-END TRANSACTION LIFECYCLE
  // =========================================================================
  describe('J. End-to-End Mempool -> FBA Consensus -> Block Ledger Flow', () => {
    test('31. should process complete transaction lifecycle through mempool, 12-validator FBA, and blockchain commit', async () => {
      // 1. Participant Identity
      const shopParticipant = getOrCreateDevParticipant('SHOP-FPS-101', 'SHOP');
      const startNonce = stateManager.getExpectedNonce(shopParticipant.address);

      // 2. Transaction Construction & Signing
      const tx = new Transaction({
        type: 'DISTRIBUTION',
        sender: shopParticipant.address,
        senderPublicKey: shopParticipant.publicKey,
        beneficiaryId: 'BEN-MEM-001',
        receiver: 'FPS-MEM-101',
        shopId: 'FPS-MEM-101',
        payload: {
          beneficiaryId: 'BEN-MEM-001',
          shopId: 'FPS-MEM-101',
          commodity: 'Rice',
          quantity: 5,
          unit: 'KG',
          name: 'Ramesh Kumar',
          senderPublicKey: shopParticipant.publicKey
        },
        timestamp: new Date().toISOString(),
        nonce: startNonce
      });

      tx.sign(shopParticipant.privateKey, shopParticipant.publicKey);

      // 3. Pre-validation
      const preValidation = await executionEngine.validateTransaction(tx);
      expect(preValidation.valid).toBe(true);

      // 4. Mempool Admission
      const mempoolEntry = mempool.addTransaction(tx);
      expect(mempoolEntry.status).toBe(MempoolStatus.READY);
      expect(mempool.entries.size).toBe(1);

      // 5. Candidate Selection
      const candidates = mempool.getCandidateTransactions(10);
      expect(candidates).toHaveLength(1);
      const selectedTx = candidates[0];
      expect(selectedTx.transactionId).toBe(tx.transactionId);

      // 6. 12-Validator FBA Consensus
      const proposal = {
        transactionId: selectedTx.transactionId,
        beneficiaryId: selectedTx.beneficiaryId,
        beneficiaryName: 'Ramesh Kumar',
        shopId: selectedTx.shopId,
        commodity: selectedTx.commodity,
        quantity: selectedTx.quantity,
        timestamp: selectedTx.timestamp,
        nonce: selectedTx.nonce,
        signature: selectedTx.signature,
        senderPublicKey: selectedTx.senderPublicKey,
        sender: selectedTx.sender,
        receiver: selectedTx.receiver,
        payload: selectedTx.payload
      };

      const consensusResult = await consensusService.runConsensus(proposal);
      expect(consensusResult.status).toBe('ACHIEVED');
      expect(consensusResult.participatingValidators).toBe(12);

      // 7. Blockchain Block Commit
      const newBlock = await blockchainService.addBlock(
        [selectedTx.toBlockPayload()],
        consensusResult.validatorSignatures
      );
      expect(newBlock.blockNumber).toBeGreaterThan(0);

      // 8. State Execution & Nonce Consumption
      const execResult = await executionEngine.executeTransaction(selectedTx, {
        blockNumber: newBlock.blockNumber,
        blockHash: newBlock.blockHash,
        consensusRound: consensusResult.roundId
      });
      expect(execResult.success).toBe(true);

      // 9. Mempool Removal
      const removed = mempool.removeIncludedTransactions([selectedTx.transactionId], newBlock.blockNumber);
      expect(removed).toBe(1);
      expect(mempool.entries.size).toBe(0);

      // 10. Replay Protection Verification
      const nextNonce = stateManager.getExpectedNonce(shopParticipant.address);
      expect(nextNonce).toBe(startNonce + 1);

      // Attempting to re-admit the same transaction must fail
      expect(() => mempool.addTransaction(tx)).toThrow(
        expect.objectContaining({ code: MempoolErrorCodes.DUPLICATE_TRANSACTION })
      );
    });

    test('32. should stage and process through transactionService.processDistribution() with mempool integration', async () => {
      const payload = {
        beneficiaryId: 'BEN-MEM-001',
        shopId: 'FPS-MEM-101',
        commodity: 'Rice',
        quantity: 5,
        name: 'Ramesh Kumar'
      };

      const result = await transactionService.processDistribution(payload, { entityId: 'FPS-MEM-101' });

      expect(result.success).toBe(true);
      expect(result.transaction).toBeDefined();
      expect(result.block).toBeDefined();
      expect(result.consensus.quorumAchieved).toBe(true);
      expect(result.receipt.verificationStatus).toBe('CRYPTOGRAPHICALLY_VERIFIED_ON_CHAIN');
    });

    test('33. should query safe mempool data through transactionService query APIs', () => {
      const stats = transactionService.getMempoolStats();
      expect(stats).toHaveProperty('total');
      expect(stats).toHaveProperty('ready');
      expect(stats).toHaveProperty('queued');
      expect(stats).toHaveProperty('capacity');

      const list = transactionService.getMempoolTransactions();
      expect(Array.isArray(list)).toBe(true);
    });

    test('34. should filter pending entries by status correctly via getAllPending()', () => {
      const txReady = createSignedTx(senderA, { nonce: 0 });
      const txQueued = createSignedTx(senderA, { nonce: 2 });

      mempool.addTransaction(txReady);
      mempool.addTransaction(txQueued);

      const all = mempool.getAllPending();
      const readyOnly = mempool.getAllPending('READY');
      const queuedOnly = mempool.getAllPending('QUEUED');

      expect(all).toHaveLength(2);
      expect(readyOnly).toHaveLength(1);
      expect(queuedOnly).toHaveLength(1);
      expect(readyOnly[0].transactionId).toBe(txReady.transactionId);
      expect(queuedOnly[0].transactionId).toBe(txQueued.transactionId);
    });

    test('35. should correctly lookup pending transactions by sender', () => {
      const txA = createSignedTx(senderA, { nonce: 0 });
      const txB = createSignedTx(senderB, { nonce: 0 });

      mempool.addTransaction(txA);
      mempool.addTransaction(txB);

      const senderAEntries = mempool.getTransactionsBySender(senderA.address);
      expect(senderAEntries).toHaveLength(1);
      expect(senderAEntries[0].transactionId).toBe(txA.transactionId);

      const unknownSenderEntries = mempool.getTransactionsBySender('PDS1UNKNOWN00000000000000000000000000000000');
      expect(unknownSenderEntries).toHaveLength(0);
    });

    test('36. should safely handle repeated idempotent removals of the same transaction ID', () => {
      const tx = createSignedTx(senderA, { nonce: 0 });
      mempool.addTransaction(tx);

      const firstRemoval = mempool.removeIncludedTransactions([tx.transactionId]);
      expect(firstRemoval).toBe(1);

      const secondRemoval = mempool.removeIncludedTransactions([tx.transactionId]);
      expect(secondRemoval).toBe(0);
    });

    test('37. should expose safe mempool stats and transaction list via REST API', async () => {
      const request = require('supertest');
      const app = require('../src/app');

      const statsRes = await request(app).get('/api/blockchain/mempool/stats');
      expect(statsRes.status).toBe(200);
      expect(statsRes.body.success).toBe(true);
      expect(statsRes.body.stats).toHaveProperty('capacity');
      expect(statsRes.body.stats).toHaveProperty('total');

      const listRes = await request(app).get('/api/blockchain/mempool');
      expect(listRes.status).toBe(200);
      expect(listRes.body.success).toBe(true);
      expect(Array.isArray(listRes.body.transactions)).toBe(true);
    });
  });
});
