const crypto = require('crypto');
const ValidatorVote = require('../src/consensus/ValidatorVote');
const VoteStore = require('../src/consensus/VoteStore');
const ConsensusCertificate = require('../src/consensus/ConsensusCertificate');
const ConsensusRound = require('../src/consensus/ConsensusRound');
const { ConsensusState, ConsensusStateMachine } = require('../src/consensus/ConsensusStateMachine');
const { ConflictDetector, ConflictCode } = require('../src/consensus/ConflictDetector');
const FinalityEngine = require('../src/consensus/FinalityEngine');
const QuorumEngine = require('../src/consensus/QuorumEngine');
const ConsensusJournal = require('../src/consensus/ConsensusJournal');
const fbaConsensus = require('../src/consensus/FBAConsensus');
const Block = require('../src/blockchain/Block');
const Blockchain = require('../src/blockchain/Blockchain');
const { calculateMerkleRoot } = require('../src/blockchain/merkle');
const { hashProposal } = require('../src/blockchain/hashing');
const {
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

describe('PHASE 8: Adversarial Consensus & Byzantine Safety Test Suite', () => {
  let quorumEngine;
  let finalityEngine;
  let conflictDetector;
  let stateMachine;
  let voteStore;

  beforeAll(async () => {
    await require('../src/seed/seedDatabase').seedDatabase(true);
  });

  beforeEach(() => {
    fbaConsensus.initDefaultValidators();
    fbaConsensus.voteStore.clear();
    quorumEngine = new QuorumEngine();
    finalityEngine = new FinalityEngine();
    conflictDetector = new ConflictDetector();
    stateMachine = new ConsensusStateMachine();
    voteStore = new VoteStore();
  });

  // Helper to construct and sign a valid vote
  function createSignedVote(validatorId, overrides = {}) {
    const part = getOrCreateDevParticipant(validatorId, 'VALIDATOR');
    const privKey = getParticipantPrivateKey(validatorId);
    const voteData = {
      validatorId,
      validatorAddress: part.address,
      validatorPublicKey: part.publicKey,
      proposalId: '0xprop_test',
      blockNumber: 1,
      blockHash: '0xblockhash_test',
      stateRoot: '0xstateroot_test',
      round: 0,
      vote: 'ACCEPT',
      ...overrides
    };
    const vote = new ValidatorVote(voteData);
    vote.sign(privKey);
    return vote;
  }

  // =========================================================================
  // 1. EQUIVOCATION & DOUBLE-VOTING ATTACKS
  // =========================================================================
  describe('1. Equivocation & Double-Voting Attacks', () => {
    test('1. should detect validator double-voting for two competing blocks at same height and round', () => {
      const voteA = createSignedVote('VAL-01', { blockHash: '0xblock_A', proposalId: '0xprop_A' });
      const voteB = createSignedVote('VAL-01', { blockHash: '0xblock_B', proposalId: '0xprop_B' });

      const check = conflictDetector.checkVote(voteB, [voteA]);
      expect(check.hasConflict).toBe(true);
      expect(check.code).toBe(ConflictCode.CONFLICTING_DOUBLE_VOTE);
    });

    test('2. should reject conflicting double-vote in VoteStore and preserve the first vote', () => {
      const voteA = createSignedVote('VAL-02', { blockHash: '0xhash1', proposalId: '0xprop1' });
      const voteB = createSignedVote('VAL-02', { blockHash: '0xhash2', proposalId: '0xprop2' });

      const resA = voteStore.recordVote(voteA);
      expect(resA.success).toBe(true);

      const resB = voteStore.recordVote(voteB);
      expect(resB.success).toBe(false);
      expect(resB.code).toBe('CONFLICTING_VOTE');

      const stored = voteStore.getVoteForValidatorRound('VAL-02', 0);
      expect(stored.blockHash).toBe('0xhash1');
    });

    test('3. should detect equivocation when validator votes both ACCEPT and REJECT for same proposal', () => {
      const voteAccept = createSignedVote('VAL-03', { vote: 'ACCEPT' });
      const voteReject = createSignedVote('VAL-03', { vote: 'REJECT' });

      const check = conflictDetector.checkVote(voteReject, [voteAccept]);
      expect(check.hasConflict).toBe(true);
      expect(check.code).toBe(ConflictCode.EQUIVOCATION);
    });

    test('4. should identify conflicting votes in batch scan across multiple validators', () => {
      const votes = [
        createSignedVote('VAL-01', { blockHash: '0xhashA' }),
        createSignedVote('VAL-02', { blockHash: '0xhashA' }),
        createSignedVote('VAL-01', { blockHash: '0xhashB' }) // Malicious double-vote
      ];

      const batch = conflictDetector.checkBatch(votes);
      expect(batch.hasConflict).toBe(true);
      expect(batch.conflicts.length).toBe(1);
      expect(batch.conflicts[0].conflictingVote.validatorId).toBe('VAL-01');
    });
  });

  // =========================================================================
  // 2. REPLAY ATTACKS (ROUND, HEIGHT, CROSS-CHAIN)
  // =========================================================================
  describe('2. Replay Attacks (Round, Height, Cross-Chain)', () => {
    test('5. should reject round 0 vote replayed into round 1', () => {
      const voteR0 = createSignedVote('VAL-04', { round: 0 });
      // Attempt to verify against round 1 expected payload
      const tampered = { ...voteR0.toUnsignedPayload(), round: 1 };
      const check = verifyValidatorVoteSignature(tampered, voteR0.signature, voteR0.validatorPublicKey);
      expect(check.valid).toBe(false);
    });

    test('6. should reject block #10 vote replayed to finalize block #11', () => {
      const voteH10 = createSignedVote('VAL-05', { blockNumber: 10 });
      const tampered = { ...voteH10.toUnsignedPayload(), blockNumber: 11 };
      const check = verifyValidatorVoteSignature(tampered, voteH10.signature, voteH10.validatorPublicKey);
      expect(check.valid).toBe(false);
    });

    test('7. should reject cross-chain vote replay when chainId is bound', () => {
      const voteMainnet = createSignedVote('VAL-06', { chainId: 1729 });
      // Replay against chainId 9999
      const tampered = { ...voteMainnet.toUnsignedPayload(), chainId: 9999 };
      const check = verifyValidatorVoteSignature(tampered, voteMainnet.signature, voteMainnet.validatorPublicKey);
      expect(check.valid).toBe(false);
    });

    test('8. should allow same validator to legitimately vote in distinct rounds without conflict', () => {
      const voteR0 = createSignedVote('VAL-07', { round: 0 });
      const voteR1 = createSignedVote('VAL-07', { round: 1 });

      const check = conflictDetector.checkVote(voteR1, [voteR0]);
      expect(check.hasConflict).toBe(false);
      expect(check.code).toBe(ConflictCode.VALID);
    });

    test('9. should allow same validator to legitimately vote for consecutive block heights without conflict', () => {
      const voteH1 = createSignedVote('VAL-08', { blockNumber: 1 });
      const voteH2 = createSignedVote('VAL-08', { blockNumber: 2 });

      const check = conflictDetector.checkVote(voteH2, [voteH1]);
      expect(check.hasConflict).toBe(false);
      expect(check.code).toBe(ConflictCode.VALID);
    });
  });

  // =========================================================================
  // 3. CRYPTOGRAPHIC FORGERY & KEY INTEGRITY
  // =========================================================================
  describe('3. Cryptographic Forgery & Key Integrity', () => {
    test('10. should reject validator vote with forged / random signature bytes', () => {
      const vote = createSignedVote('VAL-01');
      vote.signature = 'a'.repeat(128); // Fake 64-byte hex signature
      const check = vote.verifySignature();
      expect(check.valid).toBe(false);
    });

    test('11. should reject validator vote signed by non-validator private key', () => {
      const imposterPart = getOrCreateDevParticipant('BEN-999', 'BENEFICIARY');
      const imposterPrivKey = getParticipantPrivateKey('BEN-999');

      const valPart = getOrCreateDevParticipant('VAL-01', 'VALIDATOR');
      const vote = new ValidatorVote({
        validatorId: 'VAL-01',
        validatorAddress: valPart.address,
        validatorPublicKey: valPart.publicKey,
        proposalId: '0xprop',
        blockNumber: 1,
        blockHash: '0xhash',
        stateRoot: '0xroot',
        round: 0,
        vote: 'ACCEPT'
      });

      vote.sign(imposterPrivKey);
      const check = vote.verifySignature();
      expect(check.valid).toBe(false);
    });

    test('12. should reject validator vote if validatorAddress does not match derived address', () => {
      const valPart = getOrCreateDevParticipant('VAL-02', 'VALIDATOR');
      const valPrivKey = getParticipantPrivateKey('VAL-02');
      const fakeAddr = 'PDS10000000000000000000000000000000000000000';

      const vote = new ValidatorVote({
        validatorId: 'VAL-02',
        validatorAddress: fakeAddr,
        validatorPublicKey: valPart.publicKey,
        proposalId: '0xprop',
        blockNumber: 1,
        blockHash: '0xhash',
        stateRoot: '0xroot',
        round: 0,
        vote: 'ACCEPT'
      });

      vote.sign(valPrivKey);
      const check = vote.verifySignature();
      expect(check.valid).toBe(false);
      expect(check.reason).toContain('VALIDATOR_ADDRESS_MISMATCH');
    });

    test('13. should reject block proposal with invalid proposer signature', () => {
      const proposal = {
        version: 1,
        blockNumber: 5,
        previousHash: '0xprev',
        timestamp: '2026-03-31T12:00:00.000Z',
        merkleRoot: '0xmerkle',
        stateRoot: '0xstate',
        proposerId: 'VAL-01',
        round: 0
      };

      const val2PrivKey = getParticipantPrivateKey('VAL-02');
      const forgedSig = signBlockProposal(proposal, val2PrivKey);

      const val1Part = getOrCreateDevParticipant('VAL-01', 'VALIDATOR');
      const check = verifyBlockProposalSignature(proposal, forgedSig, val1Part.publicKey);
      expect(check.valid).toBe(false);
    });

    test('14. should reject vote when validator public key is missing or invalid hex', () => {
      const vote = new ValidatorVote({
        validatorId: '',
        validatorPublicKey: 'not_valid_hex',
        signature: '1234'
      });

      const check = vote.verifySignature();
      expect(check.valid).toBe(false);
    });
  });

  // =========================================================================
  // 4. PAYLOAD TAMPERING & INTEGRITY
  // =========================================================================
  describe('4. Payload Tampering & Integrity', () => {
    test('15. should detect tampering with vote stateRoot after signing', () => {
      const vote = createSignedVote('VAL-03', { stateRoot: '0xoriginal_root' });
      expect(vote.verifySignature().valid).toBe(true);

      vote.stateRoot = '0xtampered_root';
      expect(vote.verifySignature().valid).toBe(false);
    });

    test('16. should detect tampering with vote blockHash after signing', () => {
      const vote = createSignedVote('VAL-04', { blockHash: '0xoriginal_hash' });
      vote.blockHash = '0xtampered_hash';
      expect(vote.verifySignature().valid).toBe(false);
    });

    test('17. should detect tampering with vote proposalId after signing', () => {
      const vote = createSignedVote('VAL-05', { proposalId: '0xoriginal_prop' });
      vote.proposalId = '0xtampered_prop';
      expect(vote.verifySignature().valid).toBe(false);
    });

    test('18. should detect tampering with vote type from REJECT to ACCEPT', () => {
      const vote = createSignedVote('VAL-06', { vote: 'REJECT' });
      expect(vote.verifySignature().valid).toBe(true);

      vote.vote = 'ACCEPT';
      expect(vote.verifySignature().valid).toBe(false);
    });

    test('19. should reject duplicate identical vote submission in VoteStore', () => {
      const vote = createSignedVote('VAL-07');
      expect(voteStore.recordVote(vote).success).toBe(true);

      const dup = voteStore.recordVote(vote);
      expect(dup.success).toBe(false);
      expect(dup.code).toBe('DUPLICATE_VOTE');
    });
  });

  // =========================================================================
  // 5. CONSENSUS CERTIFICATE HARDENING & IMMUTABILITY
  // =========================================================================
  describe('5. Consensus Certificate Hardening & Immutability', () => {
    test('20. should compute identical deterministic certificateHash regardless of input key ordering', () => {
      const approvals = [
        { validatorId: 'VAL-02', signature: '0x222', timestamp: '2026-03-31T12:00:00.000Z', vote: 'ACCEPT' },
        { validatorId: 'VAL-01', signature: '0x111', timestamp: '2026-03-31T12:00:00.000Z', vote: 'ACCEPT' }
      ];

      const certA = new ConsensusCertificate({
        version: 1,
        proposalId: '0xprop',
        blockNumber: 1,
        blockHash: '0xhash',
        stateRoot: '0xroot',
        round: 0,
        threshold: 9,
        totalValidators: 12,
        achieved: true,
        validatorApprovals: approvals
      });

      const certB = new ConsensusCertificate({
        validatorApprovals: [approvals[1], approvals[0]],
        achieved: true,
        totalValidators: 12,
        threshold: 9,
        round: 0,
        stateRoot: '0xroot',
        blockHash: '0xhash',
        blockNumber: 1,
        proposalId: '0xprop',
        version: 1
      });

      expect(certA.certificateHash).toBe(certB.certificateHash);
    });

    test('21. should reject certificate with tampered certificateHash', () => {
      const cert = new ConsensusCertificate({
        proposalId: '0xprop',
        blockNumber: 1,
        blockHash: '0xhash',
        stateRoot: '0xroot',
        round: 0,
        threshold: 9,
        achieved: true,
        validatorApprovals: []
      });

      cert.certificateHash = '0xbadhash';
      const check = ConsensusCertificate.verify(cert, { blockHash: '0xhash', blockNumber: 1 });
      expect(check.valid).toBe(false);
      expect(check.code).toBe('CERTIFICATE_HASH_MISMATCH');
    });

    test('22. should reject certificate with insufficient approvals (< threshold)', () => {
      // 8 approvals when threshold is 9
      const approvals = [];
      for (let i = 1; i <= 8; i++) {
        const id = `VAL-0${i}`;
        const vote = createSignedVote(id, { blockNumber: 2, blockHash: '0xblock2', stateRoot: '0xroot2', proposalId: '0xprop2' });
        approvals.push({
          validatorId: id,
          signature: vote.signature,
          validatorAddress: vote.validatorAddress,
          validatorPublicKey: vote.validatorPublicKey,
          vote: 'ACCEPT'
        });
      }

      const cert = new ConsensusCertificate({
        blockNumber: 2,
        blockHash: '0xblock2',
        stateRoot: '0xroot2',
        proposalId: '0xprop2',
        round: 0,
        threshold: 9,
        achieved: true,
        validatorApprovals: approvals
      });

      const check = ConsensusCertificate.verify(cert, { blockHash: '0xblock2', blockNumber: 2, stateRoot: '0xroot2' });
      expect(check.valid).toBe(false);
      expect(check.code).toBe('INSUFFICIENT_APPROVALS');
    });

    test('23. should reject certificate with duplicate validator approval', () => {
      const vote = createSignedVote('VAL-01', { blockNumber: 3, blockHash: '0xblock3', stateRoot: '0xroot3', proposalId: '0xprop3' });
      const approvals = [];
      // 9 approvals but VAL-01 is repeated
      for (let i = 1; i <= 8; i++) {
        const id = `VAL-0${i}`;
        const v = createSignedVote(id, { blockNumber: 3, blockHash: '0xblock3', stateRoot: '0xroot3', proposalId: '0xprop3' });
        approvals.push({
          validatorId: id,
          signature: v.signature,
          validatorAddress: v.validatorAddress,
          validatorPublicKey: v.validatorPublicKey,
          vote: 'ACCEPT'
        });
      }
      approvals.push({
        validatorId: 'VAL-01',
        signature: vote.signature,
        validatorAddress: vote.validatorAddress,
        validatorPublicKey: vote.validatorPublicKey,
        vote: 'ACCEPT'
      });

      const cert = new ConsensusCertificate({
        blockNumber: 3,
        blockHash: '0xblock3',
        stateRoot: '0xroot3',
        proposalId: '0xprop3',
        round: 0,
        threshold: 9,
        achieved: true,
        validatorApprovals: approvals
      });

      const check = ConsensusCertificate.verify(cert, { blockHash: '0xblock3', blockNumber: 3, stateRoot: '0xroot3' });
      expect(check.valid).toBe(false);
      expect(check.code).toBe('DUPLICATE_VALIDATOR_APPROVAL');
    });

    test('24. should reject certificate when an approval contains corrupted signature', () => {
      const approvals = [];
      for (let i = 1; i <= 9; i++) {
        const id = `VAL-0${i}`;
        const v = createSignedVote(id, { blockNumber: 4, blockHash: '0xblock4', stateRoot: '0xroot4', proposalId: '0xprop4' });
        approvals.push({
          validatorId: id,
          signature: i === 9 ? 'b'.repeat(128) : v.signature,
          validatorAddress: v.validatorAddress,
          validatorPublicKey: v.validatorPublicKey,
          vote: 'ACCEPT'
        });
      }

      const cert = new ConsensusCertificate({
        blockNumber: 4,
        blockHash: '0xblock4',
        stateRoot: '0xroot4',
        proposalId: '0xprop4',
        round: 0,
        threshold: 9,
        achieved: true,
        validatorApprovals: approvals
      });

      const check = ConsensusCertificate.verify(cert, { blockHash: '0xblock4', blockNumber: 4, stateRoot: '0xroot4' });
      expect(check.valid).toBe(false);
      expect(check.code).toBe('INVALID_VALIDATOR_SIGNATURE');
    });

    test('25. should reject certificate when block stateRoot does not match certificate stateRoot', () => {
      const cert = new ConsensusCertificate({
        blockNumber: 5,
        blockHash: '0xblock5',
        stateRoot: '0xroot_A',
        round: 0,
        threshold: 9,
        achieved: true,
        validatorApprovals: []
      });

      const check = ConsensusCertificate.verify(cert, { blockHash: '0xblock5', blockNumber: 5, stateRoot: '0xroot_B' });
      expect(check.valid).toBe(false);
      expect(check.code).toBe('STATE_ROOT_MISMATCH');
    });

    test('26. should reject certificate when blockNumber does not match certificate blockNumber', () => {
      const cert = new ConsensusCertificate({
        blockNumber: 5,
        blockHash: '0xblock5',
        stateRoot: '0xroot5',
        round: 0,
        threshold: 9,
        achieved: true,
        validatorApprovals: []
      });

      const check = ConsensusCertificate.verify(cert, { blockHash: '0xblock5', blockNumber: 6, stateRoot: '0xroot5' });
      expect(check.valid).toBe(false);
      expect(check.code).toBe('BLOCK_NUMBER_MISMATCH');
    });
  });

  // =========================================================================
  // 6. FINALITY ENGINE PREREQUISITES & CHAIN CONTINUITY
  // =========================================================================
  describe('6. Finality Engine & Chain Continuity', () => {
    test('27. should reject finality if candidate block is missing consensus certificate', () => {
      const block = {
        blockNumber: 1,
        blockHash: '0xhash',
        previousHash: '0xprev',
        merkleRoot: calculateMerkleRoot([]),
        stateRoot: '0xstate',
        transactions: []
      };

      const result = finalityEngine.evaluateFinality(block, null, null);
      expect(result.final).toBe(false);
      expect(result.code).toBe('MISSING_CERTIFICATE');
    });

    test('28. should reject finality if candidate block height does not match chain continuity (height gap)', () => {
      const mockBlockchain = {
        getLatestBlock: () => ({ blockNumber: 5, blockHash: '0xhash5' })
      };

      const block = {
        blockNumber: 7, // Gap: expected 6
        blockHash: '0xhash7',
        previousHash: '0xhash5',
        merkleRoot: calculateMerkleRoot([]),
        stateRoot: '0xstate7',
        transactions: []
      };

      const cert = new ConsensusCertificate({
        blockNumber: 7,
        blockHash: '0xhash7',
        stateRoot: '0xstate7',
        achieved: true
      });

      const result = finalityEngine.evaluateFinality(block, cert, mockBlockchain);
      expect(result.final).toBe(false);
      expect(result.code).toBe('HEIGHT_MISMATCH');
    });

    test('29. should reject finality if candidate block previousHash does not match latest block hash', () => {
      const mockBlockchain = {
        getLatestBlock: () => ({ blockNumber: 5, blockHash: '0xexpected_hash5' })
      };

      const block = {
        blockNumber: 6,
        blockHash: '0xhash6',
        previousHash: '0xwrong_previous_hash',
        merkleRoot: calculateMerkleRoot([]),
        stateRoot: '0xstate6',
        transactions: []
      };

      const cert = new ConsensusCertificate({
        blockNumber: 6,
        blockHash: '0xhash6',
        stateRoot: '0xstate6',
        achieved: true
      });

      const result = finalityEngine.evaluateFinality(block, cert, mockBlockchain);
      expect(result.final).toBe(false);
      expect(result.code).toBe('PREVIOUS_HASH_MISMATCH');
    });

    test('30. should reject finality if block merkleRoot does not match computed transaction root', () => {
      const txs = [{ transactionId: 'TXN-01', payload: { quantity: 5 } }];
      const block = {
        blockNumber: 1,
        blockHash: '0xhash1',
        previousHash: '0xprev',
        merkleRoot: '0xcorrupted_merkle',
        stateRoot: '0xstate1',
        transactions: txs
      };

      const cert = new ConsensusCertificate({ blockNumber: 1, blockHash: '0xhash1', stateRoot: '0xstate1', achieved: true });
      const result = finalityEngine.evaluateFinality(block, cert, null);
      expect(result.final).toBe(false);
      expect(result.code).toBe('MERKLE_ROOT_MISMATCH');
    });
  });

  // =========================================================================
  // 7. CONSENSUS STATE MACHINE TRANSITIONS & GUARDS
  // =========================================================================
  describe('7. Consensus State Machine Transitions & Guards', () => {
    test('31. should prevent illegal state machine transition (e.g. IDLE directly to FINALIZED)', () => {
      expect(stateMachine.getState()).toBe(ConsensusState.IDLE);
      const res = stateMachine.transition(ConsensusState.FINALIZED);
      expect(res.success).toBe(false);
      expect(res.error).toContain('ILLEGAL_STATE_TRANSITION');
      expect(stateMachine.getState()).toBe(ConsensusState.IDLE);
    });

    test('32. should enforce legal path: IDLE -> PROPOSAL -> PREVOTE -> ACCEPTED -> CERTIFIED -> FINALIZED', () => {
      expect(stateMachine.transition(ConsensusState.PROPOSAL, { height: 1 }).success).toBe(true);
      expect(stateMachine.transition(ConsensusState.PREVOTE, { height: 1 }).success).toBe(true);
      expect(stateMachine.transition(ConsensusState.ACCEPTED, { height: 1 }).success).toBe(true);
      expect(stateMachine.transition(ConsensusState.CERTIFIED, { height: 1 }).success).toBe(true);
      expect(stateMachine.transition(ConsensusState.FINALIZED, { height: 1 }).success).toBe(true);
      expect(stateMachine.getState()).toBe(ConsensusState.FINALIZED);
    });

    test('33. should prevent modifying or reverting a finalized block height (Finality Immutability Guard)', () => {
      stateMachine.transition(ConsensusState.PROPOSAL, { height: 1 });
      stateMachine.transition(ConsensusState.PREVOTE, { height: 1 });
      stateMachine.transition(ConsensusState.ACCEPTED, { height: 1 });
      stateMachine.transition(ConsensusState.CERTIFIED, { height: 1 });
      stateMachine.transition(ConsensusState.FINALIZED, { height: 1 });

      // Attempt to re-enter PROPOSAL for height #1
      const res = stateMachine.transition(ConsensusState.PROPOSAL, { height: 1 });
      expect(res.success).toBe(false);
      expect(res.error).toContain('FINALIZED_HEIGHT_IMMUTABLE');
    });

    test('34. should handle proposal timeout transition and round advancement', () => {
      stateMachine.transition(ConsensusState.PROPOSAL, { height: 2, round: 0 });
      const timeoutRes = stateMachine.transition(ConsensusState.TIMEOUT, { height: 2, round: 0, reason: 'Proposer timed out' });
      expect(timeoutRes.success).toBe(true);
      expect(stateMachine.getState()).toBe(ConsensusState.TIMEOUT);

      const recoverRes = stateMachine.transition(ConsensusState.RECOVERING, { height: 2, round: 1, reason: 'Round advance' });
      expect(recoverRes.success).toBe(true);
      expect(stateMachine.getState()).toBe(ConsensusState.RECOVERING);

      const propRes = stateMachine.transition(ConsensusState.PROPOSAL, { height: 2, round: 1 });
      expect(propRes.success).toBe(true);
      expect(stateMachine.getState()).toBe(ConsensusState.PROPOSAL);
    });

    test('35. should log state transitions in history for post-mortem auditing', () => {
      stateMachine.transition(ConsensusState.PROPOSAL, { height: 3, round: 0 });
      stateMachine.transition(ConsensusState.REJECTED, { height: 3, round: 0, reason: 'Quorum failed' });

      const history = stateMachine.getHistory();
      expect(history.length).toBe(2);
      expect(history[0].from).toBe(ConsensusState.IDLE);
      expect(history[0].to).toBe(ConsensusState.PROPOSAL);
      expect(history[1].from).toBe(ConsensusState.PROPOSAL);
      expect(history[1].to).toBe(ConsensusState.REJECTED);
      expect(history[1].reason).toBe('Quorum failed');
    });
  });

  // =========================================================================
  // 8. WRITE-AHEAD CONSENSUS JOURNAL & CRASH RECOVERY
  // =========================================================================
  describe('8. Write-Ahead Consensus Journal & Recovery', () => {
    test('36. should append consensus events to journal and recover active state', () => {
      const journal = new ConsensusJournal({ inMemoryOnly: true });

      journal.append('ROUND_STARTED', { height: 10, round: 0, roundId: 'RND-10-0' });
      journal.append('VOTE_RECORDED', { height: 10, round: 0, validatorId: 'VAL-01', vote: 'ACCEPT' });
      journal.append('BLOCK_FINALIZED', { height: 10, round: 0, blockHash: '0xhash10' });

      const state = journal.recoverState();
      expect(state.lastHeight).toBe(10);
      expect(state.lastRound).toBe(0);
      expect(state.finalizedHeights).toContain(10);
      expect(state.activeRoundId).toBe('RND-10-0');
      expect(state.entryCount).toBe(3);
    });
  });
});

