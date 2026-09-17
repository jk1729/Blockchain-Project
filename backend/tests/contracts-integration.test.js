const request = require('supertest');
const app = require('../src/app');
const { contractRegistry, evmRuntime } = require('../src/evm');
const transactionService = require('../src/services/transactionService');
const blockchainService = require('../src/services/blockchainService');
const fbaConsensus = require('../src/consensus/FBAConsensus');
const { mempool } = require('../src/blockchain/mempool');
const { calculateMerkleRoot } = require('../src/blockchain/merkle');
const { calculateStateRoot } = require('../src/blockchain/state');
const stateManager = require('../src/execution/StateManager');
const {
  getOrCreateDevParticipant,
  getParticipantPrivateKey
} = require('../src/blockchain/identity/keyManager');

describe('PHASE 7: PDSChain Native Solidity Contracts & EVM Execution Integration Test Suite', () => {

  beforeAll(async () => {
    // Seed DB and clean ledger
    await require('../src/seed/seedDatabase').seedDatabase(true);
    await evmRuntime.initialize();
  });

  beforeEach(() => {
    // Reset all 12 validators to Online
    fbaConsensus.getValidators().forEach(v => v.setStatus('Online'));
    fbaConsensus.voteStore.clear();
    mempool.clear();
  });

  describe('1. Contract Registry & Discovery REST APIs', () => {
    test('1. should discover all deployed contracts via GET /api/contracts', async () => {
      const res = await request(app)
        .get('/api/contracts')
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.chainId).toBe(1729);
      expect(res.body.evmStateRoot).toBeDefined();
      expect(res.body.contracts).toBeInstanceOf(Array);
      expect(res.body.contracts.length).toBeGreaterThanOrEqual(8);

      const contractNames = res.body.contracts.map(c => c.name);
      expect(contractNames).toContain('PDSRegistry');
      expect(contractNames).toContain('CommodityRegistry');
      expect(contractNames).toContain('BeneficiaryRegistry');
      expect(contractNames).toContain('ShopRegistry');
      expect(contractNames).toContain('WarehouseRegistry');
      expect(contractNames).toContain('InventoryManager');
      expect(contractNames).toContain('EntitlementManager');
      expect(contractNames).toContain('DistributionManager');
    });

    test('2. should fetch contract metadata and ABI via GET /api/contracts/:addressOrName', async () => {
      const res = await request(app)
        .get('/api/contracts/CommodityRegistry')
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.contract.name).toBe('CommodityRegistry');
      expect(res.body.contract.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
      expect(res.body.contract.abi).toBeInstanceOf(Array);
      expect(res.body.contract.codeHash).toMatch(/^0x[0-9a-fA-F]{64}$/);
    });

    test('3. should return 404 for unknown contract name or address', async () => {
      const res = await request(app)
        .get('/api/contracts/NonExistentContract')
        .expect(404);

      expect(res.body.success).toBe(false);
    });
  });

  describe('2. Read-Only / View Contract Invocations', () => {
    test('4. should execute view call to getCommodityCount() without altering state', async () => {
      const comAddress = contractRegistry.getAddress('CommodityRegistry');
      const rootBefore = await evmRuntime.getStateRoot();

      const res = await request(app)
        .post('/api/contracts/call')
        .send({
          contractAddress: comAddress,
          method: 'getCommodityCount',
          args: [],
          isView: true
        })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.mode).toBe('VIEW');
      expect(Number(res.body.result)).toBeGreaterThanOrEqual(0);

      // View call should not mutate state root
      const rootAfter = await evmRuntime.getStateRoot();
      expect(rootAfter).toBe(rootBefore);
    });

    test('5. should execute view call to verify non-existent commodity returns false', async () => {
      const comAddress = contractRegistry.getAddress('CommodityRegistry');

      const res = await request(app)
        .post('/api/contracts/call')
        .send({
          contractAddress: comAddress,
          method: 'isValidCommodity',
          args: ['NonExistentGrain'],
          isView: true
        })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.result).toBe(false);
    });
  });

  describe('3. End-to-End State-Changing CONTRACT_CALL through 12-Validator FBA Consensus', () => {
    test('6. should submit signed CONTRACT_CALL, achieve FBA consensus, commit block, and update EVM state', async () => {
      const comAddress = contractRegistry.getAddress('CommodityRegistry');
      const adminParticipant = getOrCreateDevParticipant('ADMIN', 'ADMIN');
      const initialChainLength = blockchainService.blockchain.chain.length;

      const payload = {
        contractAddress: comAddress,
        method: 'registerCommodity',
        args: ['Sorghum', 'KG'],
        gasLimit: 500000
      };

      const result = await transactionService.processContractCall(payload, {
        id: 'ADMIN',
        username: 'admin',
        role: 'ADMIN',
        address: adminParticipant.address
      });

      expect(result.success).toBe(true);
      expect(result.block.blockNumber).toBe(initialChainLength);
      expect(result.consensus.status).toBe('ACHIEVED');
      expect(result.consensus.participatingValidators).toBeGreaterThanOrEqual(9);
      expect(result.receipt).toBeDefined();
      expect(result.receipt.status).toBe('SUCCESS');
      expect(result.receipt.gasUsed).toBeGreaterThan(0);

      // Verify block finalized on chain
      const latestBlock = blockchainService.blockchain.getLatestBlock();
      expect(latestBlock.blockNumber).toBe(initialChainLength);
      expect(latestBlock.receiptsRoot).toBeDefined();
      expect(latestBlock.consensusStatus).toBe('FINALIZED');
      expect(latestBlock.consensusCertificate).toBeDefined();
      expect(latestBlock.consensusCertificate.achieved).toBe(true);
      expect(latestBlock.consensusCertificate.certificateHash).toMatch(/^[0-9a-fA-F]{64}$/);

      // Verify EVM state updated persistently via view call
      const viewRes = await evmRuntime.executeViewCall({
        contractAddress: comAddress,
        method: 'getCommodity',
        args: ['Sorghum']
      });

      expect(viewRes.unit || viewRes[0]).toBe('KG');
      expect(viewRes.isActive || viewRes[1]).toBe(true);
    });

    test('7. should register beneficiary and verify pseudonymous EVM registration', async () => {
      const benRegistryAddr = contractRegistry.getAddress('BeneficiaryRegistry');
      const adminParticipant = getOrCreateDevParticipant('ADMIN', 'ADMIN');

      const pseudoId = 'BEN-PDS-ANON-7788';
      const category = 'BPL';
      const familySize = 4;

      const payload = {
        contractAddress: benRegistryAddr,
        method: 'registerBeneficiary',
        args: [pseudoId, category, familySize],
        gasLimit: 500000
      };

      const result = await transactionService.processContractCall(payload, {
        id: 'ADMIN',
        username: 'admin',
        role: 'ADMIN',
        address: adminParticipant.address
      });

      expect(result.success).toBe(true);
      expect(result.receipt.status).toBe('SUCCESS');

      // Check view call
      const isEligible = await evmRuntime.executeViewCall({
        contractAddress: benRegistryAddr,
        method: 'isEligible',
        args: [pseudoId]
      });

      expect(isEligible).toBe(true);
    });
  });

  describe('4. Deterministic EVM Receipts & REST Receipts API', () => {
    test('8. should query transaction receipt by transactionId via GET /api/contracts/transactions/:id/receipt', async () => {
      const comAddress = contractRegistry.getAddress('CommodityRegistry');
      const adminParticipant = getOrCreateDevParticipant('ADMIN', 'ADMIN');

      const payload = {
        contractAddress: comAddress,
        method: 'registerCommodity',
        args: ['Barley', 'KG'],
        gasLimit: 500000
      };

      const result = await transactionService.processContractCall(payload, {
        id: 'ADMIN',
        username: 'admin',
        role: 'ADMIN',
        address: adminParticipant.address
      });

      const txId = result.receipt.transactionId;

      const res = await request(app)
        .get(`/api/contracts/transactions/${txId}/receipt`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.receipt.transactionId).toBe(txId);
      expect(res.body.receipt.status).toBe('SUCCESS');
      expect(res.body.receipt.contractAddress.toLowerCase()).toBe(comAddress.toLowerCase());
      expect(res.body.receipt.gasUsed).toBeGreaterThan(0);
      expect(res.body.receipt.receiptHash).toMatch(/^0x[0-9a-fA-F]{64}$/);
    });

    test('9. should ensure block receiptsRoot cryptographically matches receiptHash', async () => {
      const latestBlock = blockchainService.blockchain.getLatestBlock();
      expect(latestBlock.executionReceipts).toBeDefined();
      expect(latestBlock.executionReceipts.length).toBeGreaterThan(0);

      const receiptsLeaves = latestBlock.executionReceipts.map(r => ({ receiptHash: r.receiptHash }));
      const computedReceiptsRoot = calculateMerkleRoot(receiptsLeaves);

      expect(latestBlock.receiptsRoot).toBe(computedReceiptsRoot);
    });
  });

  describe('5. Consensus Fault Tolerance with EVM Contracts', () => {
    test('10. should tolerate up to 3 non-critical validator outages and still reach consensus on CONTRACT_CALL', async () => {
      // Set VAL-05 and VAL-06 to OFFLINE (10/12 online)
      const val05 = fbaConsensus.getValidators().find(v => v.validatorId === 'VAL-05');
      const val06 = fbaConsensus.getValidators().find(v => v.validatorId === 'VAL-06');
      val05.setStatus('Offline');
      val06.setStatus('Offline');

      const comAddress = contractRegistry.getAddress('CommodityRegistry');
      const adminParticipant = getOrCreateDevParticipant('ADMIN', 'ADMIN');

      const payload = {
        contractAddress: comAddress,
        method: 'registerCommodity',
        args: ['Rye', 'KG'],
        gasLimit: 500000
      };

      const result = await transactionService.processContractCall(payload, {
        id: 'ADMIN',
        username: 'admin',
        role: 'ADMIN',
        address: adminParticipant.address
      });

      expect(result.success).toBe(true);
      expect(result.consensus.status).toBe('ACHIEVED');
      expect(result.consensus.participatingValidators).toBeGreaterThanOrEqual(9);
      expect(result.consensus.agreeingValidators).not.toContain('VAL-05');
      expect(result.consensus.agreeingValidators).not.toContain('VAL-06');
    });
  });
});
