const request = require('supertest');
const app = require('../src/app');
const Block = require('../src/blockchain/Block');
const Blockchain = require('../src/blockchain/Blockchain');
const Transaction = require('../src/blockchain/Transaction');
const ValidatorVote = require('../src/consensus/ValidatorVote');
const VoteStore = require('../src/consensus/VoteStore');
const ConsensusCertificate = require('../src/consensus/ConsensusCertificate');
const fbaConsensus = require('../src/consensus/FBAConsensus');
const consensusService = require('../src/services/consensusService');
const blockchainService = require('../src/services/blockchainService');
const transactionService = require('../src/services/transactionService');
const stateManager = require('../src/execution/StateManager');
const { mempool } = require('../src/blockchain/mempool');
const { calculateMerkleRoot } = require('../src/blockchain/merkle');
const { calculateStateRoot } = require('../src/blockchain/state');
const { hashProposal } = require('../src/blockchain/hashing');
const {
  signTransaction,
  verifyTransactionSignature,
  signBlockProposal,
  verifyBlockProposalSignature,
  signValidatorVote,
  verifyValidatorVoteSignature
} = require('../src/blockchain/identity/signature');
const {
  getOrCreateDevParticipant,
  getParticipantPrivateKey,
  getPublicParticipantInfo
} = require('../src/blockchain/identity/keyManager');
const { validateBlock, validateChain, validateBlockConsensusCertificate } = require('../src/blockchain/validation');

describe('PHASE 6: PDSChain Professional Block Structure & Consensus Certificate Test Suite', () => {

  beforeAll(async () => {
    await require('../src/seed/seedDatabase').seedDatabase(true);
  });

  beforeEach(() => {
    // Reset validator statuses to Online
    fbaConsensus.getValidators().forEach(v => v.setStatus('Online'));
    fbaConsensus.voteStore.clear();
  });

  // =========================================================================
  // 1. VALIDATOR VOTE SIGNING, VERIFICATION & DOMAIN SEPARATION
  // =========================================================================
  describe('1. Validator Vote Model, Signing & Domain Separation', () => {
    test('1. should create and sign a validator vote statement with Ed25519 private key', () => {
      const valPart = getOrCreateDevParticipant('VAL-01', 'VALIDATOR');
      const valPrivKey = getParticipantPrivateKey('VAL-01');

      const vote = new ValidatorVote({
        validatorId: 'VAL-01',
        validatorAddress: valPart.address,
        validatorPublicKey: valPart.publicKey,
        proposalId: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        blockNumber: 10,
        blockHash: '0xaaaabbbbccccdddd1111222233334444555566667777888899990000aaaabbbb',
        stateRoot: '0x1111222233334444555566667777888899990000aaaabbbbccccdddd11112222',
        round: 0,
        vote: 'ACCEPT'
      });

      const sig = vote.sign(valPrivKey);
      expect(sig).toBeDefined();
      expect(typeof sig).toBe('string');
      expect(vote.signature).toBe(sig);

      const check = vote.verifySignature();
      expect(check.valid).toBe(true);
    });

    test('2. should reject validator vote if vote payload is modified after signing', () => {
      const valPrivKey = getParticipantPrivateKey('VAL-02');
      const valPart = getOrCreateDevParticipant('VAL-02', 'VALIDATOR');

      const vote = new ValidatorVote({
        validatorId: 'VAL-02',
        validatorAddress: valPart.address,
        validatorPublicKey: valPart.publicKey,
        proposalId: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        blockNumber: 5,
        blockHash: '0xhash5',
        stateRoot: '0xroot5',
        round: 0,
        vote: 'ACCEPT'
      });

      vote.sign(valPrivKey);
      expect(vote.verifySignature().valid).toBe(true);

      // Tamper with vote type
      vote.vote = 'REJECT';
      expect(vote.verifySignature().valid).toBe(false);
    });

    test('3. should reject validator vote when verified against wrong validator public key', () => {
      const val1PrivKey = getParticipantPrivateKey('VAL-01');
      const val1Part = getOrCreateDevParticipant('VAL-01', 'VALIDATOR');
      const val2Part = getOrCreateDevParticipant('VAL-02', 'VALIDATOR');

      const vote = new ValidatorVote({
        validatorId: 'VAL-01',
        validatorAddress: val1Part.address,
        validatorPublicKey: val1Part.publicKey,
        proposalId: '0xprop1',
        blockNumber: 1,
        blockHash: '0xhash1',
        stateRoot: '0xroot1',
        round: 0,
        vote: 'ACCEPT'
      });

      vote.sign(val1PrivKey);

      // Verify with VAL-02 public key
      const check = verifyValidatorVoteSignature(vote.toUnsignedPayload(), vote.signature, val2Part.publicKey);
      expect(check.valid).toBe(false);
    });

    test('4. should reject validator vote if proposalId, blockHash, or stateRoot is mismatched', () => {
      const valPrivKey = getParticipantPrivateKey('VAL-03');
      const valPart = getOrCreateDevParticipant('VAL-03', 'VALIDATOR');

      const vote = new ValidatorVote({
        validatorId: 'VAL-03',
        validatorAddress: valPart.address,
        validatorPublicKey: valPart.publicKey,
        proposalId: '0xpropA',
        blockNumber: 2,
        blockHash: '0xhashA',
        stateRoot: '0xrootA',
        round: 0,
        vote: 'ACCEPT'
      });
      vote.sign(valPrivKey);

      // Mismatched proposalId
      vote.proposalId = '0xpropB';
      expect(vote.verifySignature().valid).toBe(false);

      // Reset & tamper blockHash
      vote.proposalId = '0xpropA';
      vote.blockHash = '0xhashB';
      expect(vote.verifySignature().valid).toBe(false);

      // Reset & tamper stateRoot
      vote.blockHash = '0xhashA';
      vote.stateRoot = '0xrootB';
      expect(vote.verifySignature().valid).toBe(false);
    });

    test('5. should enforce domain separation: transaction signature cannot be reused as vote signature', () => {
      const valPart = getOrCreateDevParticipant('VAL-01', 'VALIDATOR');
      const valPrivKey = getParticipantPrivateKey('VAL-01');

      // Create and sign a transaction
      const tx = new Transaction({
        type: 'DISTRIBUTION',
        sender: valPart.address,
        payload: { commodity: 'Rice', quantity: 5 }
      });
      tx.sign(valPrivKey, valPart.publicKey);

      // Attempt to use tx.signature as a validator vote signature
      const vote = new ValidatorVote({
        validatorId: 'VAL-01',
        validatorAddress: valPart.address,
        validatorPublicKey: valPart.publicKey,
        proposalId: '0xprop1',
        blockNumber: 1,
        blockHash: '0xhash1',
        stateRoot: '0xroot1',
        round: 0,
        vote: 'ACCEPT',
        signature: tx.signature
      });

      expect(vote.verifySignature().valid).toBe(false);
    });

    test('6. should enforce domain separation: validator vote signature cannot be reused as block proposal signature', () => {
      const valPart = getOrCreateDevParticipant('VAL-01', 'VALIDATOR');
      const valPrivKey = getParticipantPrivateKey('VAL-01');

      const vote = new ValidatorVote({
        validatorId: 'VAL-01',
        validatorAddress: valPart.address,
        validatorPublicKey: valPart.publicKey,
        proposalId: '0xprop1',
        blockNumber: 1,
        blockHash: '0xhash1',
        stateRoot: '0xroot1',
        round: 0,
        vote: 'ACCEPT'
      });
      vote.sign(valPrivKey);

      // Attempt to verify vote signature against block proposal
      const proposalHeader = {
        version: 1,
        blockNumber: 1,
        previousHash: '0x0',
        timestamp: '2026-03-31T12:00:00.000Z',
        merkleRoot: '0xmerkle',
        stateRoot: '0xroot1',
        proposerId: 'VAL-01',
        proposerAddress: valPart.address,
        round: 0
      };

      const check = verifyBlockProposalSignature(proposalHeader, vote.signature, valPart.publicKey);
      expect(check.valid).toBe(false);
    });
  });

  // =========================================================================
  // 2. VOTE STORE, DUPLICATE VOTES & CONFLICTING DOUBLE-VOTE PROTECTION
  // =========================================================================
  describe('2. Vote Store, Duplicate Votes & Conflicting Double-Vote Protection', () => {
    test('7. should record valid vote in VoteStore', () => {
      const store = new VoteStore();
      const valPart = getOrCreateDevParticipant('VAL-01', 'VALIDATOR');
      const valPrivKey = getParticipantPrivateKey('VAL-01');

      const vote = new ValidatorVote({
        validatorId: 'VAL-01',
        validatorAddress: valPart.address,
        validatorPublicKey: valPart.publicKey,
        proposalId: '0xprop1',
        blockNumber: 1,
        blockHash: '0xhash1',
        stateRoot: '0xroot1',
        round: 0,
        vote: 'ACCEPT'
      });
      vote.sign(valPrivKey);

      const res = store.recordVote(vote);
      expect(res.success).toBe(true);
      expect(store.getVotesForProposal('0xprop1')).toHaveLength(1);
    });

    test('8. should detect and reject duplicate identical vote submission', () => {
      const store = new VoteStore();
      const valPart = getOrCreateDevParticipant('VAL-01', 'VALIDATOR');
      const valPrivKey = getParticipantPrivateKey('VAL-01');

      const vote1 = new ValidatorVote({
        validatorId: 'VAL-01',
        validatorAddress: valPart.address,
        validatorPublicKey: valPart.publicKey,
        proposalId: '0xprop1',
        blockNumber: 1,
        blockHash: '0xhash1',
        stateRoot: '0xroot1',
        round: 0,
        vote: 'ACCEPT'
      });
      vote1.sign(valPrivKey);

      const vote2 = new ValidatorVote({
        validatorId: 'VAL-01',
        validatorAddress: valPart.address,
        validatorPublicKey: valPart.publicKey,
        proposalId: '0xprop1',
        blockNumber: 1,
        blockHash: '0xhash1',
        stateRoot: '0xroot1',
        round: 0,
        vote: 'ACCEPT'
      });
      vote2.sign(valPrivKey);

      store.recordVote(vote1);
      const res = store.recordVote(vote2);
      expect(res.success).toBe(false);
      expect(res.code).toBe('DUPLICATE_VOTE');
    });

    test('9. should detect and reject conflicting double-vote in the same consensus round', () => {
      const store = new VoteStore();
      const valPart = getOrCreateDevParticipant('VAL-02', 'VALIDATOR');
      const valPrivKey = getParticipantPrivateKey('VAL-02');

      // Vote for Proposal A
      const voteA = new ValidatorVote({
        validatorId: 'VAL-02',
        validatorAddress: valPart.address,
        validatorPublicKey: valPart.publicKey,
        proposalId: '0xpropA',
        blockNumber: 5,
        blockHash: '0xhashAAA',
        stateRoot: '0xrootA',
        round: 2,
        vote: 'ACCEPT'
      });
      voteA.sign(valPrivKey);
      store.recordVote(voteA);

      // Competing Vote for Proposal B in the same round 2
      const voteB = new ValidatorVote({
        validatorId: 'VAL-02',
        validatorAddress: valPart.address,
        validatorPublicKey: valPart.publicKey,
        proposalId: '0xpropB',
        blockNumber: 5,
        blockHash: '0xhashBBB',
        stateRoot: '0xrootB',
        round: 2,
        vote: 'ACCEPT'
      });
      voteB.sign(valPrivKey);

      const res = store.recordVote(voteB);
      expect(res.success).toBe(false);
      expect(res.code).toBe('CONFLICTING_VOTE');
    });

    test('10. should allow same validator to vote in different rounds without conflict', () => {
      const store = new VoteStore();
      const valPart = getOrCreateDevParticipant('VAL-03', 'VALIDATOR');
      const valPrivKey = getParticipantPrivateKey('VAL-03');

      // Round 0 vote
      const voteR0 = new ValidatorVote({
        validatorId: 'VAL-03',
        validatorAddress: valPart.address,
        validatorPublicKey: valPart.publicKey,
        proposalId: '0xprop0',
        blockNumber: 5,
        blockHash: '0xhash0',
        stateRoot: '0xroot0',
        round: 0,
        vote: 'ACCEPT'
      });
      voteR0.sign(valPrivKey);
      expect(store.recordVote(voteR0).success).toBe(true);

      // Round 1 vote for different proposal
      const voteR1 = new ValidatorVote({
        validatorId: 'VAL-03',
        validatorAddress: valPart.address,
        validatorPublicKey: valPart.publicKey,
        proposalId: '0xprop1',
        blockNumber: 5,
        blockHash: '0xhash1',
        stateRoot: '0xroot1',
        round: 1,
        vote: 'ACCEPT'
      });
      voteR1.sign(valPrivKey);
      expect(store.recordVote(voteR1).success).toBe(true);
    });
  });

  // =========================================================================
  // 3. BLOCK PROPOSAL, PROPOSER SIGNATURE & PROPOSAL ID
  // =========================================================================
  describe('3. Block Proposal, Proposer Signature & Proposal ID', () => {
    test('11. should compute deterministic proposalId for candidate block header', () => {
      const headerA = {
        version: 1,
        blockNumber: 42,
        previousHash: '0xprevious123',
        timestamp: '2026-03-31T12:00:00.000Z',
        merkleRoot: '0xmerkle456',
        stateRoot: '0xstate789',
        proposerId: 'VAL-01',
        proposerAddress: 'PDS10000000000000000000000000000000000000000',
        round: 0
      };

      const headerB = {
        timestamp: '2026-03-31T12:00:00.000Z',
        version: 1,
        proposerId: 'VAL-01',
        merkleRoot: '0xmerkle456',
        blockNumber: 42,
        previousHash: '0xprevious123',
        stateRoot: '0xstate789',
        proposerAddress: 'PDS10000000000000000000000000000000000000000',
        round: 0
      };

      const idA = hashProposal(headerA);
      const idB = hashProposal(headerB);
      expect(idA).toHaveLength(64);
      expect(idA).toBe(idB);
    });

    test('12. should change proposalId if any header field changes', () => {
      const base = {
        version: 1,
        blockNumber: 10,
        previousHash: '0xprev',
        timestamp: '2026-03-31T12:00:00.000Z',
        merkleRoot: '0xmerkle',
        stateRoot: '0xstate',
        proposerId: 'VAL-01',
        round: 0
      };

      const baseId = hashProposal(base);
      expect(hashProposal({ ...base, blockNumber: 11 })).not.toBe(baseId);
      expect(hashProposal({ ...base, merkleRoot: '0xtampered' })).not.toBe(baseId);
      expect(hashProposal({ ...base, stateRoot: '0xtampered' })).not.toBe(baseId);
      expect(hashProposal({ ...base, proposerId: 'VAL-02' })).not.toBe(baseId);
    });

    test('13. should sign block proposal with proposer private key and verify successfully', () => {
      const proposerPart = getOrCreateDevParticipant('VAL-01', 'VALIDATOR');
      const proposerPrivKey = getParticipantPrivateKey('VAL-01');

      const block = new Block(
        10,
        '2026-03-31T12:00:00.000Z',
        [{ transactionId: 'TXN-001', type: 'DISTRIBUTION', qty: 5 }],
        '0xprevhash',
        0,
        'PROPOSED',
        [],
        '0xstateroot',
        { proposerId: 'VAL-01', round: 0 }
      );

      const sig = block.signProposal(proposerPrivKey);
      expect(sig).toBeDefined();
      expect(block.proposerSignature).toBe(sig);

      const check = block.verifyProposerSignature(proposerPart.publicKey);
      expect(check.valid).toBe(true);
    });

    test('14. should reject block proposal if header is modified after proposer signing', () => {
      const proposerPart = getOrCreateDevParticipant('VAL-01', 'VALIDATOR');
      const proposerPrivKey = getParticipantPrivateKey('VAL-01');

      const block = new Block(
        10,
        '2026-03-31T12:00:00.000Z',
        [{ transactionId: 'TXN-001', type: 'DISTRIBUTION', qty: 5 }],
        '0xprevhash',
        0,
        'PROPOSED',
        [],
        '0xstateroot',
        { proposerId: 'VAL-01', round: 0 }
      );
      block.signProposal(proposerPrivKey);

      // Tamper stateRoot
      block.stateRoot = '0xtamperedStateRoot';
      expect(block.verifyProposerSignature(proposerPart.publicKey).valid).toBe(false);
    });
  });

  // =========================================================================
  // 4. CONSENSUS CERTIFICATE GENERATION & DETERMINISTIC SORTING
  // =========================================================================
  describe('4. Consensus Certificate Generation & Deterministic Sorting', () => {
    test('15. should create valid ConsensusCertificate when threshold (>=9/12) and quorum are satisfied', () => {
      const all12 = fbaConsensus.getValidators();
      const approvals = all12.slice(0, 10).map(node => {
        const privKey = getParticipantPrivateKey(node.validatorId);
        const vote = new ValidatorVote({
          validatorId: node.validatorId,
          validatorAddress: node.address,
          validatorPublicKey: node.publicKey,
          proposalId: '0xprop100',
          blockNumber: 10,
          blockHash: '0xhash100',
          stateRoot: '0xroot100',
          round: 0,
          vote: 'ACCEPT'
        });
        vote.sign(privKey);
        return {
          validatorId: node.validatorId,
          validatorAddress: node.address,
          validatorPublicKey: node.publicKey,
          signature: vote.signature,
          timestamp: vote.timestamp,
          vote: 'ACCEPT'
        };
      });

      const cert = new ConsensusCertificate({
        version: 1,
        proposalId: '0xprop100',
        blockNumber: 10,
        blockHash: '0xhash100',
        stateRoot: '0xroot100',
        round: 0,
        threshold: 9,
        totalValidators: 12,
        achieved: true,
        validatorApprovals: approvals
      });

      expect(cert.achieved).toBe(true);
      expect(cert.validatorApprovals).toHaveLength(10);
      expect(cert.certificateHash).toHaveLength(64);
    });

    test('16. should enforce deterministic ascending sorting of validator approvals by validatorId', () => {
      const unsortedApprovals = [
        { validatorId: 'VAL-09', vote: 'ACCEPT', signature: '0xsig9' },
        { validatorId: 'VAL-01', vote: 'ACCEPT', signature: '0xsig1' },
        { validatorId: 'VAL-04', vote: 'ACCEPT', signature: '0xsig4' },
        { validatorId: 'VAL-12', vote: 'ACCEPT', signature: '0xsig12' },
        { validatorId: 'VAL-02', vote: 'ACCEPT', signature: '0xsig2' }
      ];

      const cert = new ConsensusCertificate({
        version: 1,
        proposalId: '0xprop',
        blockNumber: 1,
        blockHash: '0xhash',
        stateRoot: '0xroot',
        validatorApprovals: unsortedApprovals
      });

      const ids = cert.validatorApprovals.map(a => a.validatorId);
      expect(ids).toEqual(['VAL-01', 'VAL-02', 'VAL-04', 'VAL-09', 'VAL-12']);
    });

    test('17. should compute deterministic certificateHash regardless of input property ordering', () => {
      const approvals = [
        { validatorId: 'VAL-01', validatorPublicKey: 'pub1', signature: 'sig1', timestamp: '2026-03-31T00:00:00Z', vote: 'ACCEPT' },
        { validatorId: 'VAL-02', validatorPublicKey: 'pub2', signature: 'sig2', timestamp: '2026-03-31T00:00:00Z', vote: 'ACCEPT' }
      ];

      const certA = new ConsensusCertificate({
        version: 1,
        proposalId: '0xprop1',
        blockNumber: 1,
        blockHash: '0xhash1',
        stateRoot: '0xroot1',
        round: 0,
        threshold: 9,
        totalValidators: 12,
        achieved: true,
        validatorApprovals: approvals
      });

      const certB = new ConsensusCertificate({
        totalValidators: 12,
        stateRoot: '0xroot1',
        round: 0,
        achieved: true,
        version: 1,
        threshold: 9,
        blockHash: '0xhash1',
        proposalId: '0xprop1',
        blockNumber: 1,
        validatorApprovals: approvals
      });

      expect(certA.calculateHash()).toBe(certB.calculateHash());
    });
  });

  // =========================================================================
  // 5. INDEPENDENT CONSENSUS CERTIFICATE VERIFICATION
  // =========================================================================
  describe('5. Independent Consensus Certificate Verification', () => {
    let validBlock;
    let validCert;

    beforeEach(() => {
      const all12 = fbaConsensus.getValidators();
      const blockNumber = 15;
      const previousHash = '0xprev14';
      const stateRoot = '0xvalidStateRoot15';
      const transactions = [{ transactionId: 'TXN-150', type: 'DISTRIBUTION', qty: 10 }];
      const merkleRoot = calculateMerkleRoot(transactions);
      const proposerId = 'VAL-01';

      validBlock = new Block(
        blockNumber,
        '2026-03-31T12:00:00.000Z',
        transactions,
        previousHash,
        0,
        'FINALIZED',
        [],
        stateRoot,
        { proposerId, round: 0 }
      );

      const proposalId = validBlock.proposalId;
      const blockHash = validBlock.blockHash;

      const approvals = all12.slice(0, 10).map(node => {
        const privKey = getParticipantPrivateKey(node.validatorId);
        const vote = new ValidatorVote({
          validatorId: node.validatorId,
          validatorAddress: node.address,
          validatorPublicKey: node.publicKey,
          proposalId,
          blockNumber,
          blockHash,
          stateRoot,
          round: 0,
          vote: 'ACCEPT'
        });
        vote.sign(privKey);
        return {
          validatorId: node.validatorId,
          validatorAddress: node.address,
          validatorPublicKey: node.publicKey,
          signature: vote.signature,
          timestamp: vote.timestamp,
          vote: 'ACCEPT'
        };
      });

      validCert = new ConsensusCertificate({
        version: 1,
        proposalId,
        blockNumber,
        blockHash,
        stateRoot,
        round: 0,
        threshold: 9,
        totalValidators: 12,
        achieved: true,
        validatorApprovals: approvals
      });

      validBlock.consensusCertificate = validCert.toJSON();
    });

    test('18. should verify valid consensus certificate successfully', () => {
      const check = ConsensusCertificate.verify(validCert, validBlock, fbaConsensus.validators);
      expect(check.valid).toBe(true);
      expect(check.approvalCount).toBe(10);
      expect(check.threshold).toBe(9);
    });

    test('19. should reject certificate with modified certificateHash', () => {
      const tamperedCert = new ConsensusCertificate(validCert.toJSON());
      tamperedCert.certificateHash = '0x0000000000000000000000000000000000000000000000000000000000000000';

      const check = ConsensusCertificate.verify(tamperedCert, validBlock, fbaConsensus.validators);
      expect(check.valid).toBe(false);
      expect(check.code).toBe('CERTIFICATE_HASH_MISMATCH');
    });

    test('20. should reject certificate if blockHash does not match block', () => {
      const tamperedCert = new ConsensusCertificate({
        ...validCert.toJSON(),
        blockHash: '0xwrongBlockHash'
      });
      tamperedCert.certificateHash = tamperedCert.calculateHash();

      const check = ConsensusCertificate.verify(tamperedCert, validBlock, fbaConsensus.validators);
      expect(check.valid).toBe(false);
      expect(check.code).toBe('BLOCK_HASH_MISMATCH');
    });

    test('21. should reject certificate if proposalId does not match block', () => {
      const tamperedCert = new ConsensusCertificate({
        ...validCert.toJSON(),
        proposalId: '0xwrongProposalId'
      });
      tamperedCert.certificateHash = tamperedCert.calculateHash();

      const check = ConsensusCertificate.verify(tamperedCert, validBlock, fbaConsensus.validators);
      expect(check.valid).toBe(false);
      expect(check.code).toBe('PROPOSAL_ID_MISMATCH');
    });

    test('22. should reject certificate if stateRoot does not match block', () => {
      const tamperedCert = new ConsensusCertificate({
        ...validCert.toJSON(),
        stateRoot: '0xwrongStateRoot'
      });
      tamperedCert.certificateHash = tamperedCert.calculateHash();

      const check = ConsensusCertificate.verify(tamperedCert, validBlock, fbaConsensus.validators);
      expect(check.valid).toBe(false);
      expect(check.code).toBe('STATE_ROOT_MISMATCH');
    });

    test('23. should reject certificate with insufficient approvals (< threshold 9)', () => {
      const shortApprovals = validCert.validatorApprovals.slice(0, 8); // only 8 of 9
      const shortCert = new ConsensusCertificate({
        ...validCert.toJSON(),
        validatorApprovals: shortApprovals
      });
      shortCert.certificateHash = shortCert.calculateHash();

      const check = ConsensusCertificate.verify(shortCert, validBlock, fbaConsensus.validators);
      expect(check.valid).toBe(false);
      expect(check.code).toBe('INSUFFICIENT_APPROVALS');
    });

    test('24. should reject certificate with duplicate validator approval', () => {
      const dupApprovals = [...validCert.validatorApprovals, validCert.validatorApprovals[0]];
      const dupCert = new ConsensusCertificate({
        ...validCert.toJSON(),
        validatorApprovals: dupApprovals
      });
      dupCert.certificateHash = dupCert.calculateHash();

      const check = ConsensusCertificate.verify(dupCert, validBlock, fbaConsensus.validators);
      expect(check.valid).toBe(false);
      expect(check.code).toBe('DUPLICATE_VALIDATOR_APPROVAL');
    });

    test('25. should reject certificate with corrupted validator vote signature', () => {
      const corruptApprovals = validCert.validatorApprovals.map((a, idx) => {
        if (idx === 0) {
          return { ...a, signature: '0xdeadbeef12345678' };
        }
        return a;
      });

      const corruptCert = new ConsensusCertificate({
        ...validCert.toJSON(),
        validatorApprovals: corruptApprovals
      });
      corruptCert.certificateHash = corruptCert.calculateHash();

      const check = ConsensusCertificate.verify(corruptCert, validBlock, fbaConsensus.validators);
      expect(check.valid).toBe(false);
      expect(check.code).toBe('INVALID_VALIDATOR_SIGNATURE');
    });
  });

  // =========================================================================
  // 6. BLOCK FINALITY & REPLAY PROTECTION
  // =========================================================================
  describe('6. Block Finality & Certificate Replay Protection', () => {
    test('26. should reject committing a block that lacks valid consensus', () => {
      const unapprovedBlock = new Block(
        20,
        '2026-03-31T12:00:00.000Z',
        [{ transactionId: 'TXN-200', type: 'DISTRIBUTION' }],
        '0xprev',
        0,
        'PROPOSED',
        [],
        '0xstateroot20'
      );

      expect(unapprovedBlock.consensusStatus).toBe('PROPOSED');
      const certCheck = validateBlockConsensusCertificate(unapprovedBlock, fbaConsensus.validators);
      expect(certCheck.valid).toBe(false);
    });

    test('27. should finalize block upon attaching valid ConsensusCertificate', () => {
      const all12 = fbaConsensus.getValidators();
      const block = new Block(
        21,
        '2026-03-31T12:00:00.000Z',
        [{ transactionId: 'TXN-210', type: 'DISTRIBUTION' }],
        '0xprev',
        0,
        'PROPOSED',
        [],
        '0xstateroot21'
      );

      const approvals = all12.slice(0, 10).map(n => {
        const priv = getParticipantPrivateKey(n.validatorId);
        const vote = new ValidatorVote({
          validatorId: n.validatorId,
          validatorAddress: n.address,
          validatorPublicKey: n.publicKey,
          proposalId: block.proposalId,
          blockNumber: block.blockNumber,
          blockHash: block.blockHash,
          stateRoot: block.stateRoot,
          round: 0,
          vote: 'ACCEPT'
        });
        vote.sign(priv);
        return {
          validatorId: n.validatorId,
          validatorAddress: n.address,
          validatorPublicKey: n.publicKey,
          signature: vote.signature,
          timestamp: vote.timestamp,
          vote: 'ACCEPT'
        };
      });

      const cert = new ConsensusCertificate({
        version: 1,
        proposalId: block.proposalId,
        blockNumber: block.blockNumber,
        blockHash: block.blockHash,
        stateRoot: block.stateRoot,
        round: 0,
        threshold: 9,
        totalValidators: 12,
        achieved: true,
        validatorApprovals: approvals
      });

      block.attachCertificate(cert);
      expect(block.consensusStatus).toBe('FINALIZED');
      expect(block.isFinalized()).toBe(true);
      expect(validateBlockConsensusCertificate(block, fbaConsensus.validators).valid).toBe(true);
    });

    test('28. should reject reusing Block #10 certificate to finalize Block #11 (Replay Attack)', () => {
      const all12 = fbaConsensus.getValidators();
      const block10 = new Block(10, '2026-03-31T12:00:00.000Z', [], '0xprev', 0, 'FINALIZED', [], '0xroot10');
      const approvals = all12.slice(0, 10).map(n => ({
        validatorId: n.validatorId,
        validatorPublicKey: n.publicKey,
        signature: '0xsig',
        timestamp: '2026-03-31T12:00:00.000Z',
        vote: 'ACCEPT'
      }));

      const cert10 = new ConsensusCertificate({
        version: 1,
        proposalId: block10.proposalId,
        blockNumber: 10,
        blockHash: block10.blockHash,
        stateRoot: block10.stateRoot,
        round: 0,
        threshold: 9,
        totalValidators: 12,
        achieved: true,
        validatorApprovals: approvals
      });

      const block11 = new Block(11, '2026-03-31T12:01:00.000Z', [], block10.blockHash, 0, 'FINALIZED', [], '0xroot11');
      block11.consensusCertificate = cert10.toJSON();

      const check = validateBlockConsensusCertificate(block11, fbaConsensus.validators);
      expect(check.valid).toBe(false);
      expect(check.code).toBe('BLOCK_HASH_MISMATCH');
    });

    test('29. should reject Round 3 certificate for Round 4 proposal (Round Replay Protection)', () => {
      const all12 = fbaConsensus.getValidators();
      const block = new Block(10, '2026-03-31T12:00:00.000Z', [], '0xprev', 0, 'FINALIZED', [], '0xroot10', { round: 4 });
      const approvals = all12.slice(0, 10).map(n => ({
        validatorId: n.validatorId,
        validatorPublicKey: n.publicKey,
        signature: '0xsig',
        timestamp: '2026-03-31T12:00:00.000Z',
        vote: 'ACCEPT'
      }));

      const certRound3 = new ConsensusCertificate({
        version: 1,
        proposalId: block.proposalId,
        blockNumber: 10,
        blockHash: block.blockHash,
        stateRoot: block.stateRoot,
        round: 3, // Round 3 certificate
        threshold: 9,
        totalValidators: 12,
        achieved: true,
        validatorApprovals: approvals
      });

      block.consensusCertificate = certRound3.toJSON();
      const check = ConsensusCertificate.verify(certRound3, block, fbaConsensus.validators);
      expect(check.valid).toBe(false);
      expect(check.code).toBe('ROUND_MISMATCH');
    });
  });

  // =========================================================================
  // 7. FBA FAILURE MATRIX (12-VALIDATOR TOPOLOGY, 3-OF-4 SLICES, 9/12 THRESHOLD)
  // =========================================================================
  describe('7. FBA Failure Matrix Evaluation', () => {
    test('30. 12 online -> should achieve consensus and produce valid certificate', async () => {
      fbaConsensus.getValidators().forEach(v => v.setStatus('Online'));

      const proposal = {
        blockNumber: 100,
        previousHash: '0xprev99',
        timestamp: '2026-03-31T12:00:00.000Z',
        merkleRoot: calculateMerkleRoot([]),
        stateRoot: '0xstate100',
        proposerId: 'VAL-01',
        transactions: []
      };

      const res = await consensusService.runBlockConsensus(proposal);
      expect(res.status).toBe('ACHIEVED');
      expect(res.quorumAchieved).toBe(true);
      expect(res.participatingValidators).toBe(12);
      expect(res.certificate).toBeDefined();
      expect(res.certificate.achieved).toBe(true);
    });

    test('31. 11 online (VAL-07 OFFLINE) -> should achieve consensus (11 >= 9)', async () => {
      fbaConsensus.setValidatorStatus('VAL-07', 'Offline');

      const proposal = {
        blockNumber: 101,
        previousHash: '0xprev100',
        timestamp: '2026-03-31T12:00:00.000Z',
        merkleRoot: calculateMerkleRoot([]),
        stateRoot: '0xstate101',
        proposerId: 'VAL-01',
        transactions: []
      };

      const res = await consensusService.runBlockConsensus(proposal);
      expect(res.status).toBe('ACHIEVED');
      expect(res.quorumAchieved).toBe(true);
      expect(res.participatingValidators).toBe(11);
    });

    test('32. 10 online (VAL-05 and VAL-06 OFFLINE) -> should achieve consensus (10 >= 9)', async () => {
      fbaConsensus.setValidatorStatus('VAL-05', 'Offline');
      fbaConsensus.setValidatorStatus('VAL-06', 'Offline');

      const proposal = {
        blockNumber: 102,
        previousHash: '0xprev101',
        timestamp: '2026-03-31T12:00:00.000Z',
        merkleRoot: calculateMerkleRoot([]),
        stateRoot: '0xstate102',
        proposerId: 'VAL-01',
        transactions: []
      };

      const res = await consensusService.runBlockConsensus(proposal);
      expect(res.status).toBe('ACHIEVED');
      expect(res.quorumSize).toBeGreaterThanOrEqual(9);
      expect(res.certificate).toBeDefined();
    });

    test('33. 10 online (VAL-01 and VAL-02 OFFLINE) -> should achieve consensus (10 >= 9)', async () => {
      fbaConsensus.setValidatorStatus('VAL-01', 'Offline');
      fbaConsensus.setValidatorStatus('VAL-02', 'Offline');

      const proposal = {
        blockNumber: 103,
        previousHash: '0xprev102',
        timestamp: '2026-03-31T12:00:00.000Z',
        merkleRoot: calculateMerkleRoot([]),
        stateRoot: '0xstate103',
        proposerId: 'VAL-03',
        transactions: []
      };

      const res = await consensusService.runBlockConsensus(proposal);
      expect(res.status).toBe('ACHIEVED');
      expect(res.participatingValidators).toBe(10);
    });

    test('34. 9 online (VAL-05, VAL-06, VAL-07 OFFLINE) -> should fail consensus (quorum slices broken)', async () => {
      fbaConsensus.setValidatorStatus('VAL-05', 'Offline');
      fbaConsensus.setValidatorStatus('VAL-06', 'Offline');
      fbaConsensus.setValidatorStatus('VAL-07', 'Offline');

      const proposal = {
        blockNumber: 104,
        previousHash: '0xprev103',
        timestamp: '2026-03-31T12:00:00.000Z',
        merkleRoot: calculateMerkleRoot([]),
        stateRoot: '0xstate104',
        proposerId: 'VAL-01',
        transactions: []
      };

      const res = await consensusService.runBlockConsensus(proposal);
      expect(res.status).toBe('FAILED');
      expect(res.certificate).toBeNull();
    });

    test('35. 8 online -> should fail consensus (< 9 threshold)', async () => {
      ['VAL-01', 'VAL-02', 'VAL-03', 'VAL-04'].forEach(v => fbaConsensus.setValidatorStatus(v, 'Offline'));

      const proposal = {
        blockNumber: 105,
        previousHash: '0xprev104',
        timestamp: '2026-03-31T12:00:00.000Z',
        merkleRoot: calculateMerkleRoot([]),
        stateRoot: '0xstate105',
        proposerId: 'VAL-05',
        transactions: []
      };

      const res = await consensusService.runBlockConsensus(proposal);
      expect(res.status).toBe('FAILED');
      expect(res.certificate).toBeNull();
    });

    test('36. 7 online -> should fail consensus (< 9 threshold)', async () => {
      ['VAL-01', 'VAL-02', 'VAL-03', 'VAL-04', 'VAL-05'].forEach(v => fbaConsensus.setValidatorStatus(v, 'Offline'));

      const proposal = {
        blockNumber: 106,
        previousHash: '0xprev105',
        timestamp: '2026-03-31T12:00:00.000Z',
        merkleRoot: calculateMerkleRoot([]),
        stateRoot: '0xstate106',
        proposerId: 'VAL-06',
        transactions: []
      };

      const res = await consensusService.runBlockConsensus(proposal);
      expect(res.status).toBe('FAILED');
      expect(res.certificate).toBeNull();
    });
  });

  // =========================================================================
  // 8. END-TO-END PIPELINE & REST API INTEGRATION
  // =========================================================================
  describe('8. End-to-End Pipeline & REST API Integration', () => {
    test('37. should process full lifecycle: Tx -> Mempool -> Proposal -> FBA -> Certificate -> Finalized Block -> State Commit', async () => {
      fbaConsensus.getValidators().forEach(v => v.setStatus('Online'));

      const payload = {
        beneficiaryId: 'BEN-1024',
        shopId: 'FPS-102',
        commodity: 'Wheat',
        quantity: 3,
        name: 'Arun Kumar'
      };

      const result = await transactionService.processDistribution(payload);
      expect(result.success).toBe(true);
      expect(result.block).toBeDefined();
      expect(result.block.consensusStatus).toBe('FINALIZED');
      expect(result.block.consensusCertificate).toBeDefined();
      expect(result.block.consensusCertificate.achieved).toBe(true);
      expect(result.consensus.status).toBe('ACHIEVED');
      expect(result.receipt).toBeDefined();
    });

    test('38. GET /api/blockchain/blocks/:number/consensus should return consensus certificate details', async () => {
      const res = await request(app).get('/api/blockchain/blocks/1/consensus');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.blockNumber).toBe(1);
      expect(res.body.isFinalized).toBe(true);
      expect(res.body.consensusCertificate).toBeDefined();
      expect(res.body.consensusCertificate.threshold).toBe(9);
    });

    test('39. POST /api/blockchain/consensus/verify should verify supplied certificate against block', async () => {
      const blockRes = await request(app).get('/api/blockchain/blocks/1');
      const block = blockRes.body.block;

      const certRes = await request(app)
        .post('/api/blockchain/consensus/verify')
        .send({
          certificate: block.consensusCertificate,
          block
        });

      expect(certRes.status).toBe(200);
      expect(certRes.body.success).toBe(true);
      expect(certRes.body.valid).toBe(true);
    });
  });
});
