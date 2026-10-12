const request = require('supertest');
const app = require('../src/app');
const { sequelize } = require('../src/config/database');
const BlockModel = require('../src/models/Block');
const Block = require('../src/blockchain/Block');
const Blockchain = require('../src/blockchain/Blockchain');
const ConsensusCertificate = require('../src/consensus/ConsensusCertificate');
const FinalityEngine = require('../src/consensus/FinalityEngine');
const fbaConsensus = require('../src/consensus/FBAConsensus');
const blockchainService = require('../src/services/blockchainService');
const transactionService = require('../src/services/transactionService');
const { seedDatabase } = require('../src/seed/seedDatabase');
const {
  validateChain,
  validateBlockStateRoot,
  validateBlockConsensusCertificate
} = require('../src/blockchain/validation');

describe('Phase 11: Final Adversarial Audit — Consensus Binding, Finality, Atomic Rollback & Security', () => {
  beforeAll(async () => {
    await seedDatabase(true);
  });

  beforeEach(() => {
    fbaConsensus.getValidators().forEach(v => v.setStatus('Online'));
  });

  describe('1. Blockchain & Certificate Structural Validation', () => {
    test('rejects an empty or malformed blockchain', () => {
      expect(validateChain([]).isValid).toBe(false);
      expect(validateChain(null).isValid).toBe(false);
      expect(validateChain({}).isValid).toBe(false);
    });

    test('accepts a valid blockchain and verifies genesis certificate', () => {
      const blockchain = new Blockchain();
      const genesis = blockchain.getLatestBlock();
      const genesisCertCheck = ConsensusCertificate.verify(genesis.consensusCertificate, genesis, fbaConsensus.validators);
      expect(genesisCertCheck.valid).toBe(true);
      expect(genesis.consensusCertificate.blockHash).toBe(genesis.blockHash);

      blockchain.addBlock([
        { transactionId: 'AUDIT-001', commodity: 'Rice', quantity: '5 KG' }
      ]);

      expect(validateChain(blockchain.chain).isValid).toBe(true);
    });

    test('rejects transaction data modified after block creation', () => {
      const blockchain = new Blockchain();
      blockchain.addBlock([
        { transactionId: 'AUDIT-002', commodity: 'Wheat', quantity: '5 KG' }
      ]);

      blockchain.chain[1].transactions[0].quantity = '999 KG';

      expect(validateChain(blockchain.chain).isValid).toBe(false);
    });

    test('rejects a missing or mismatched state root', () => {
      const missing = validateBlockStateRoot({ blockNumber: 1 }, 'abc123');
      expect(missing.valid).toBe(false);
      expect(missing.code).toBe('STATE_ROOT_MISMATCH');

      const mismatch = validateBlockStateRoot({ blockNumber: 1, stateRoot: 'abc123' }, 'def456');
      expect(mismatch.valid).toBe(false);
      expect(mismatch.code).toBe('STATE_ROOT_MISMATCH');
    });

    test('rejects a block without a consensus certificate when certificate validation is requested', () => {
      const result = validateBlockConsensusCertificate({
        blockNumber: 1,
        consensusCertificate: null
      });

      expect(result.valid).toBe(false);
      expect(result.code).toBe('MISSING_CONSENSUS_CERTIFICATE');
    });
  });

  describe('2. Deterministic Proposal-to-Block Binding Across Consecutive Live Blocks', () => {
    test('binds non-empty blockHash and 12 valid validator approvals across consecutive distributions and warehouse transfers', async () => {
      // 1. Ration Distribution Block
      const distResult = await transactionService.processDistribution({
        beneficiaryId: 'BEN-1024',
        shopId: 'FPS-102',
        commodity: 'Rice',
        quantity: 2,
        name: 'Arun Kumar'
      });

      expect(distResult.success).toBe(true);
      const distBlock = distResult.block;
      expect(distBlock.blockHash).toBeTruthy();
      expect(distBlock.consensusCertificate).toBeDefined();
      expect(distBlock.consensusCertificate.blockHash).toBe(distBlock.blockHash);
      expect(distBlock.consensusCertificate.validatorApprovals).toHaveLength(12);

      const distCertCheck = ConsensusCertificate.verify(
        distBlock.consensusCertificate,
        distBlock,
        fbaConsensus.validators
      );
      expect(distCertCheck.valid).toBe(true);

      // 2. Consecutive Warehouse Transfer Block (verifies round-0 at next block height does not collide in VoteStore)
      const transferResult = await transactionService.processWarehouseTransfer({
        warehouseId: 'WH-003',
        shopId: 'FPS-102',
        commodity: 'Rice',
        quantity: 25
      }, { username: 'warehouse_tn', role: 'WAREHOUSE', entityId: 'WH-003' });

      expect(transferResult.success).toBe(true);
      const transferBlock = transferResult.block;
      expect(transferBlock.blockNumber).toBe(distBlock.blockNumber + 1);
      expect(transferBlock.consensusCertificate).toBeDefined();
      expect(transferBlock.consensusCertificate.blockHash).toBe(transferBlock.blockHash);
      expect(transferBlock.consensusCertificate.validatorApprovals).toHaveLength(12);

      const transferCertCheck = ConsensusCertificate.verify(
        transferBlock.consensusCertificate,
        transferBlock,
        fbaConsensus.validators
      );
      expect(transferCertCheck.valid).toBe(true);

      // 3. Entire chain passes strict certificate validation
      const strictChainCheck = validateChain(blockchainService.blockchain.chain, {
        verifyCertificates: true,
        validatorMap: fbaConsensus.validators
      });
      expect(strictChainCheck.isValid).toBe(true);
    });
  });

  describe('3. Finality Enforcement on the Commit Path (Adversarial Certificate Rejection)', () => {
    test('rejects committing a block when requireFinality is true and consensusCertificate is missing', () => {
      const blockchain = new Blockchain();
      expect(() => {
        blockchain.addBlock(
          [{ transactionId: 'ADV-TX-01', commodity: 'Rice', quantity: '5 KG' }],
          [],
          '0x' + 'a'.repeat(64),
          { requireFinality: true }
        );
      }).toThrow(/MISSING_CERTIFICATE/);
      expect(blockchain.chain).toHaveLength(1); // Only genesis remains
    });

    test('rejects committing a block when consensusCertificate.blockHash is empty string or mismatched', () => {
      const blockchain = new Blockchain();
      const emptyHashCert = new ConsensusCertificate({
        version: 1,
        proposalId: '0xprop',
        blockNumber: 1,
        blockHash: '',
        stateRoot: '0x' + 'b'.repeat(64),
        round: 0,
        threshold: 9,
        totalValidators: 12,
        achieved: true,
        validatorApprovals: []
      });

      expect(() => {
        blockchain.addBlock(
          [{ transactionId: 'ADV-TX-02', commodity: 'Rice', quantity: '5 KG' }],
          [],
          '0x' + 'b'.repeat(64),
          { consensusCertificate: emptyHashCert, requireFinality: true }
        );
      }).toThrow(/BLOCK_HASH_MISMATCH/);
      expect(blockchain.chain).toHaveLength(1);
    });

    test('rejects committing a block when consensusCertificate has insufficient validator approvals (< 9)', () => {
      const blockchain = new Blockchain();
      const latest = blockchain.getLatestBlock();
      const candidate = new Block(
        1,
        '2026-09-01T00:00:00.000Z',
        [{ transactionId: 'ADV-TX-03', commodity: 'Wheat', quantity: '5 KG' }],
        latest.blockHash,
        0,
        'FINALIZED',
        [],
        '0x' + 'c'.repeat(64),
        { proposerId: 'VAL-01', round: 0 }
      );
      candidate.mineBlock(blockchain.difficulty);

      const shortCert = new ConsensusCertificate({
        version: 1,
        proposalId: candidate.proposalId,
        blockNumber: 1,
        blockHash: candidate.blockHash,
        stateRoot: candidate.stateRoot,
        round: 0,
        threshold: 9,
        totalValidators: 12,
        achieved: true,
        validatorApprovals: []
      });
      candidate.consensusCertificate = shortCert.toJSON();

      expect(() => {
        blockchain.addBlock(candidate, [], candidate.stateRoot, { requireFinality: true });
      }).toThrow(/INSUFFICIENT_APPROVALS/);
      expect(blockchain.chain).toHaveLength(1);
    });
  });

  describe('4. Atomic Persistence & In-Memory Rollback Safety in BlockchainService.addBlock', () => {
    test('does not mutate in-memory chain or proofIndexer when BlockModel.create fails', async () => {
      const initialLength = blockchainService.blockchain.chain.length;
      const initialIndexedBlocks = blockchainService.proofIndexer.getStatus().indexedBlocks;

      const createSpy = jest.spyOn(BlockModel, 'create').mockRejectedValueOnce(new Error('SIMULATED_SQLITE_DISK_FULL'));

      try {
        await expect(
          blockchainService.addBlock(
            [{ transactionId: 'ROLLBACK-TX-01', commodity: 'Rice', quantity: '5 KG' }],
            ['VAL-01'],
            null,
            '0x' + 'd'.repeat(64)
          )
        ).rejects.toThrow('SIMULATED_SQLITE_DISK_FULL');
      } finally {
        createSpy.mockRestore();
      }

      expect(blockchainService.blockchain.chain).toHaveLength(initialLength);
      expect(blockchainService.proofIndexer.getStatus().indexedBlocks).toBe(initialIndexedBlocks);
      expect(blockchainService.getTransactionById('ROLLBACK-TX-01')).toBeNull();
    });

    test('rolls back in-memory chain and proofIndexer when surrounding Sequelize transaction aborts after addBlock', async () => {
      const initialLength = blockchainService.blockchain.chain.length;

      await expect(
        sequelize.transaction(async (t) => {
          await blockchainService.addBlock(
            [{ transactionId: 'ROLLBACK-TX-02', commodity: 'Sugar', quantity: '2 KG' }],
            ['VAL-01'],
            t,
            '0x' + 'e'.repeat(64)
          );
          // Inside transaction before rollback, block was committed
          expect(blockchainService.blockchain.chain).toHaveLength(initialLength + 1);
          throw new Error('DOWNSTREAM_STEP_FAILURE');
        })
      ).rejects.toThrow('DOWNSTREAM_STEP_FAILURE');

      // After transaction rollback, in-memory chain and DB must both be back at initialLength
      expect(blockchainService.blockchain.chain).toHaveLength(initialLength);
      expect(blockchainService.getTransactionById('ROLLBACK-TX-02')).toBeNull();
      const dbCount = await BlockModel.count();
      expect(dbCount).toBe(initialLength);
    });

    test('rolls back in-memory chain and DB when proofIndexer.indexBlock throws during addBlock', async () => {
      const initialLength = blockchainService.blockchain.chain.length;
      const indexSpy = jest.spyOn(blockchainService.proofIndexer, 'indexBlock').mockImplementationOnce(() => {
        throw new Error('SIMULATED_PROOF_INDEXER_FAILURE');
      });

      try {
        await expect(
          sequelize.transaction(async (t) => {
            await blockchainService.addBlock(
              [{ transactionId: 'ROLLBACK-TX-03', commodity: 'Wheat', quantity: '3 KG' }],
              ['VAL-01'],
              t,
              '0x' + 'f'.repeat(64)
            );
          })
        ).rejects.toThrow('SIMULATED_PROOF_INDEXER_FAILURE');
      } finally {
        indexSpy.mockRestore();
      }

      expect(blockchainService.blockchain.chain).toHaveLength(initialLength);
      expect(blockchainService.getTransactionById('ROLLBACK-TX-03')).toBeNull();
      const dbCount = await BlockModel.count();
      expect(dbCount).toBe(initialLength);
    });
  });

  describe('5. Privilege Escalation & Logout Security Regression Checks', () => {
    test('blocks unauthenticated mass-assignment privilege escalation on POST /api/auth/register', async () => {
      const uniqueUser = `adv_user_${Date.now()}`;
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          username: uniqueUser,
          email: `${uniqueUser}@pdschain.gov.in`,
          password: 'StrongPassword#2026',
          role: 'ADMIN',
          isAdminCreated: true
        });

      expect(res.status).toBe(201);
      expect(res.body.user.role).toBe('CITIZEN');
    });

    test('POST /api/auth/logout succeeds and clears session cookies', async () => {
      const res = await request(app).post('/api/auth/logout');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe('6. Empty/Malformed JSON Handling, Live Server Origin Resolution & Concurrent Serialization', () => {
    test('backend errorMiddleware returns 400 JSON (not 500 or empty body) on truncated/malformed JSON request', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .set('Content-Type', 'application/json')
        .send('{"username": "admin", ');

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/Invalid or malformed JSON/i);
    });

    test('GET /api/blockchain/validate reports STRICT_CONSENSUS mode and certificatesVerified: true', async () => {
      const res = await request(app).get('/api/blockchain/validate');
      expect(res.status).toBe(200);
      expect(res.body.isValid).toBe(true);
      expect(res.body.structuralValid).toBe(true);
      expect(res.body.certificatesVerified).toBe(true);
      expect(res.body.validationMode).toBe('STRICT_CONSENSUS');
      expect(res.body.genesisTrustedCheckpoint).toBe(true);
    });

    test('frontend parsePDSJsonResponse and getPDSChainApiBase handle empty 405/204 responses and Live Server port 5500 without Unexpected end of JSON input', async () => {
      const fs = require('fs');
      const path = require('path');
      const vm = require('vm');

      const apiJsCode = fs.readFileSync(path.join(__dirname, '../../frontend/js/api.js'), 'utf8');
      const sandboxWindow = {
        location: {
          origin: 'http://127.0.0.1:5500',
          port: '5500',
          pathname: '/frontend/html/admin/admin.html'
        },
        localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
        sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {} }
      };
      const context = vm.createContext({
        window: sandboxWindow,
        localStorage: sandboxWindow.localStorage,
        sessionStorage: sandboxWindow.sessionStorage,
        console,
        fetch: async () => ({ status: 204, ok: true, text: async () => '' }),
        setTimeout,
        clearTimeout
      });
      vm.runInContext(apiJsCode, context);

      // 1. When opened on VS Code Live Server (127.0.0.1:5500), BASE_URL must resolve to http://localhost:3000/api
      expect(sandboxWindow.PDSChainAPI.BASE_URL).toBe('http://localhost:3000/api');

      // 2. 204 No Content with empty body resolves cleanly
      const res204 = await sandboxWindow.parsePDSJsonResponse({
        status: 204,
        ok: true,
        text: async () => ''
      });
      expect(res204).toEqual({ success: true, status: 204 });

      // 3. 405 Method Not Allowed with 0-byte body throws descriptive HTTP 405 error (never "Unexpected end of JSON input")
      await expect(
        sandboxWindow.parsePDSJsonResponse({
          status: 405,
          ok: false,
          text: async () => ''
        })
      ).rejects.toThrow(/HTTP 405/);
    });

    test('concurrent distribution submissions are serialized cleanly without conflicting blocks or double-spending', async () => {
      const Beneficiary = require('../src/models/Beneficiary');
      await Beneficiary.update(
        { currentMonthClaimed: { Rice: 0, Wheat: 0, Sugar: 0, Pulses: 0, Kerosene: 0 }, status: 'Active' },
        { where: { beneficiaryId: 'BEN-1024' } }
      );

      const heightBefore = blockchainService.blockchain.getLatestBlock().blockNumber;
      const [res1, res2] = await Promise.allSettled([
        transactionService.processDistribution(
          { beneficiaryId: 'BEN-1024', shopId: 'FPS-102', commodity: 'Wheat', quantity: 1, timestamp: new Date(Date.now() + 1000).toISOString() },
          { username: 'shop1', role: 'SHOP', entityId: 'FPS-102' }
        ),
        transactionService.processDistribution(
          { beneficiaryId: 'BEN-1024', shopId: 'FPS-102', commodity: 'Sugar', quantity: 1, timestamp: new Date(Date.now() + 2000).toISOString() },
          { username: 'shop1', role: 'SHOP', entityId: 'FPS-102' }
        )
      ]);

      expect(res1.status).toBe('fulfilled');
      expect(res2.status).toBe('fulfilled');
      expect(res1.value.block.blockNumber).toBe(heightBefore + 1);
      expect(res2.value.block.blockNumber).toBe(heightBefore + 2);
      expect(blockchainService.validateChain().isValid).toBe(true);
    });
  });
});

