const request = require('supertest');
const app = require('../src/app');
const { contractRegistry, evmRuntime } = require('../src/evm');
const transactionService = require('../src/services/transactionService');
const blockchainService = require('../src/services/blockchainService');
const consensusService = require('../src/services/consensusService');
const fbaConsensus = require('../src/consensus/FBAConsensus');
const { mempool } = require('../src/blockchain/mempool');
const { calculateMerkleRoot } = require('../src/blockchain/merkle');
const { calculateStateRoot } = require('../src/blockchain/state');
const stateManager = require('../src/execution/StateManager');
const Transaction = require('../src/blockchain/Transaction');
const { hashProposal } = require('../src/blockchain/hashing');
const {
  getOrCreateDevParticipant,
  getParticipantPrivateKey
} = require('../src/blockchain/identity/keyManager');
const { signBlockProposal } = require('../src/blockchain/identity/signature');

describe('PHASE 7: PDSChain Native Solidity Contracts & EVM Execution Adversarial Test Suite', () => {

  beforeAll(async () => {
    await require('../src/seed/seedDatabase').seedDatabase(true);
    await evmRuntime.initialize();
  });

  beforeEach(() => {
    fbaConsensus.getValidators().forEach(v => v.setStatus('Online'));
    fbaConsensus.voteStore.clear();
    mempool.clear();
  });

  describe('1. Unauthorized Caller & Role Escalation Protection', () => {
    test('1. should reject unauthorized non-admin actor attempting registerCommodity()', async () => {
      const comAddress = contractRegistry.getAddress('CommodityRegistry');
      const unauthorizedParticipant = getOrCreateDevParticipant('CITIZEN-99', 'CITIZEN');

      const payload = {
        contractAddress: comAddress,
        method: 'registerCommodity',
        args: ['IllicitGrain', 'KG'],
        senderId: 'CITIZEN-99',
        senderRole: 'CITIZEN',
        gasLimit: 500000
      };

      await expect(
        transactionService.processContractCall(payload, {
          id: 'CITIZEN-99',
          username: 'citizen99',
          role: 'CITIZEN',
          address: unauthorizedParticipant.address
        })
      ).rejects.toThrow(/reverted|BUSINESS_RULE_VIOLATION/i);

      // Verify illicit grain was NOT registered in EVM
      const isRegistered = await evmRuntime.executeViewCall({
        contractAddress: comAddress,
        method: 'isValidCommodity',
        args: ['IllicitGrain']
      });

      expect(isRegistered).toBe(false);
    });

    test('2. should reject unauthorized actor attempting to allocate stock directly in InventoryManager', async () => {
      const invAddr = contractRegistry.getAddress('InventoryManager');
      const unauthorizedParticipant = getOrCreateDevParticipant('FPS-999', 'SHOP');

      const payload = {
        contractAddress: invAddr,
        method: 'addShopStock',
        args: ['FPS-101', 'Rice', 50000],
        senderId: 'FPS-999',
        senderRole: 'SHOP',
        gasLimit: 500000
      };

      await expect(
        transactionService.processContractCall(payload, {
          id: 'FPS-999',
          username: 'shop999',
          role: 'SHOP',
          address: unauthorizedParticipant.address
        })
      ).rejects.toThrow(/reverted|BUSINESS_RULE_VIOLATION/i);
    });
  });

  describe('2. Calldata & Signature Tampering Resistance', () => {
    test('3. should reject transaction when calldata is tampered after signing', async () => {
      const comAddress = contractRegistry.getAddress('CommodityRegistry');
      const adminParticipant = getOrCreateDevParticipant('ADMIN', 'ADMIN');

      const tx = new Transaction({
        type: 'CONTRACT_CALL',
        sender: adminParticipant.address,
        senderPublicKey: adminParticipant.publicKey,
        receiver: comAddress,
        payload: {
          contractAddress: comAddress,
          method: 'registerCommodity',
          args: ['LegitGrain', 'KG'],
          gasLimit: 500000,
          senderId: 'ADMIN',
          senderPublicKey: adminParticipant.publicKey
        },
        nonce: 1
      });

      tx.sign(adminParticipant.privateKey, adminParticipant.publicKey);

      // Tamper with payload method/args after signing
      tx.payload.args = ['TamperedGrain', 'KG'];

      // Verification of signature must fail
      const sigCheck = tx.verify();
      expect(sigCheck.valid).toBe(false);

      // Mempool must reject tampered transaction
      expect(() => mempool.addTransaction(tx)).toThrow(/INVALID_SIGNATURE|TRANSACTION_ID_MISMATCH|INVALID_TRANSACTION_ID/);
    });
  });

  describe('3. Validator Independent EVM Execution & State Root Discrepancy Detection', () => {
    test('4. all 12 validators should reject block proposal with forged stateRoot', async () => {
      const comAddress = contractRegistry.getAddress('CommodityRegistry');
      const adminParticipant = getOrCreateDevParticipant('ADMIN', 'ADMIN');
      const proposerParticipant = getOrCreateDevParticipant('VAL-01', 'VALIDATOR');

      const tx = new Transaction({
        type: 'CONTRACT_CALL',
        sender: adminParticipant.address,
        senderPublicKey: adminParticipant.publicKey,
        receiver: comAddress,
        payload: {
          contractAddress: comAddress,
          method: 'registerCommodity',
          args: ['Mustard', 'KG'],
          gasLimit: 500000,
          senderId: 'ADMIN',
          senderPublicKey: adminParticipant.publicKey
        },
        nonce: 100
      });
      tx.sign(adminParticipant.privateKey, adminParticipant.publicKey);

      const latestBlock = blockchainService.blockchain.getLatestBlock();
      const nextBlockNumber = latestBlock.blockNumber + 1;
      const txPayload = tx.toBlockPayload();
      const merkleRoot = calculateMerkleRoot([txPayload]);

      // Malicious proposer injects fabricated stateRoot
      const fabricatedStateRoot = '0xbad0bad0bad0bad0bad0bad0bad0bad0bad0bad0bad0bad0bad0bad0bad0bad0';

      const proposalHeader = {
        version: 1,
        blockNumber: nextBlockNumber,
        previousHash: latestBlock.blockHash,
        timestamp: new Date().toISOString(),
        merkleRoot,
        stateRoot: fabricatedStateRoot,
        receiptsRoot: '0x0000000000000000000000000000000000000000000000000000000000000000',
        proposerId: 'VAL-01',
        proposerAddress: proposerParticipant.address,
        round: 0
      };

      const proposalId = hashProposal(proposalHeader);
      const proposerPrivKey = getParticipantPrivateKey('VAL-01');
      const proposerSignature = signBlockProposal(proposalHeader, proposerPrivKey);

      const candidateProposal = {
        ...proposalHeader,
        proposalId,
        proposerSignature,
        proposerPublicKey: proposerParticipant.publicKey,
        transactions: [txPayload],
        transactionId: tx.transactionId,
        nonce: tx.nonce,
        signature: tx.signature,
        senderPublicKey: tx.senderPublicKey,
        sender: tx.sender,
        receiver: tx.receiver,
        payload: tx.payload
      };

      const genuineState = await stateManager.getConsensusStateSnapshot();
      const genuineStateRoot = calculateStateRoot(genuineState);

      // Run FBA consensus round with network expecting genuineStateRoot
      const consensusResult = await consensusService.runBlockConsensus(candidateProposal, {
        round: 0,
        expectedStateRoot: genuineStateRoot,
        threshold: 9
      });

      // Consensus MUST fail because validators independently simulate and detect stateRoot mismatch
      expect(consensusResult.status).toBe('FAILED');
      expect(consensusResult.certificate).toBeNull();
      expect(consensusResult.participatingValidators).toBeLessThan(9);
    });
  });

  describe('4. Isolated State Snapshots & Rollback Protection', () => {
    test('5. should leave EVM state completely clean when simulation or consensus fails', async () => {
      const rootBefore = await evmRuntime.getStateRoot();
      const comAddress = contractRegistry.getAddress('CommodityRegistry');
      const unauthorizedParticipant = getOrCreateDevParticipant('ATTACKER-01', 'CITIZEN');

      const payload = {
        contractAddress: comAddress,
        method: 'registerCommodity',
        args: ['PoisonGrain', 'KG'],
        senderId: 'ATTACKER-01',
        senderRole: 'CITIZEN',
        gasLimit: 500000
      };

      try {
        await transactionService.processContractCall(payload, {
          id: 'ATTACKER-01',
          username: 'attacker',
          role: 'CITIZEN',
          address: unauthorizedParticipant.address
        });
      } catch (err) {
        // Expected revert
      }

      // Verify EVM state root is IDENTICAL to pre-attempt state root (zero dirty state)
      const rootAfter = await evmRuntime.getStateRoot();
      expect(rootAfter).toBe(rootBefore);
    });
  });

  describe('5. Consensus Outage Tolerance & Halting Safety with EVM', () => {
    test('6. should safely halt consensus when >= 4 validators are offline (8/12 online < 9 threshold)', async () => {
      // Offline 4 validators: VAL-01, VAL-02, VAL-03, VAL-04
      ['VAL-01', 'VAL-02', 'VAL-03', 'VAL-04'].forEach(id => {
        const v = fbaConsensus.getValidators().find(n => n.validatorId === id);
        if (v) v.setStatus('Offline');
      });

      const comAddress = contractRegistry.getAddress('CommodityRegistry');
      const adminParticipant = getOrCreateDevParticipant('ADMIN', 'ADMIN');
      const initialChainLength = blockchainService.blockchain.chain.length;

      const payload = {
        contractAddress: comAddress,
        method: 'registerCommodity',
        args: ['FailSafeGrain', 'KG'],
        gasLimit: 500000
      };

      const result = await transactionService.processContractCall(payload, {
        id: 'ADMIN',
        username: 'admin',
        role: 'ADMIN',
        address: adminParticipant.address
      });

      // Transaction must not be committed to chain
      expect(result.success).toBe(false);
      expect(result.consensus.status).toBe('FAILED');
      expect(blockchainService.blockchain.chain.length).toBe(initialChainLength);

      // Verify EVM state was not updated
      const isValid = await evmRuntime.executeViewCall({
        contractAddress: comAddress,
        method: 'isValidCommodity',
        args: ['FailSafeGrain']
      });
      expect(isValid).toBe(false);
    });
  });
});
