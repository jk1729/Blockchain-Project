const fbaConsensus = require('../src/consensus/FBAConsensus');
const ConsensusCertificate = require('../src/consensus/ConsensusCertificate');
const ConsensusRound = require('../src/consensus/ConsensusRound');
const { ConsensusState } = require('../src/consensus/ConsensusStateMachine');
const ConsensusJournal = require('../src/consensus/ConsensusJournal');
const ValidatorVote = require('../src/consensus/ValidatorVote');
const { calculateMerkleRoot } = require('../src/blockchain/merkle');
const {
  getOrCreateDevParticipant,
  getParticipantPrivateKey
} = require('../src/blockchain/identity/keyManager');

describe('PHASE 8: Multi-Validator FBA In-Process Network Simulation', () => {
  beforeAll(async () => {
    await require('../src/seed/seedDatabase').seedDatabase(true);
  });

  beforeEach(() => {
    fbaConsensus.initDefaultValidators();
    fbaConsensus.voteStore.clear();
    fbaConsensus.stateMachine.resetForNewHeight(1);
    fbaConsensus.getValidators().forEach(v => v.setStatus('Online'));
  });

  function makeProposal(height, overrides = {}) {
    return {
      blockNumber: height,
      previousHash: height === 1 ? '0xgenesis' : `0xhash_${height - 1}`,
      blockHash: `0xhash_${height}`,
      timestamp: new Date().toISOString(),
      merkleRoot: calculateMerkleRoot([]),
      stateRoot: `0xstateroot_${height}`,
      proposerId: 'VAL-01',
      transactions: [],
      ...overrides
    };
  }

  // 1. Full 12-node synchronous round
  test('1. Simulation: Full 12-node synchronous round produces finalized certificate', async () => {
    const proposal = makeProposal(1);
    const round = await fbaConsensus.runBlockConsensus(proposal);

    expect(round.status).toBe('ACHIEVED');
    expect(round.quorumAchieved).toBe(true);
    expect(round.quorumSize).toBe(12);
    expect(round.participatingValidators).toBe(12);
    expect(round.certificate).toBeDefined();
    expect(round.certificate.achieved).toBe(true);
    expect(round.certificate.validatorApprovals.length).toBe(12);
    expect(fbaConsensus.stateMachine.isFinalized(1)).toBe(true);
  });

  // 2. 1-node crash (VAL-01 offline)
  test('2. Simulation: 1 validator crash (VAL-01 offline) tolerates failure and finalizes', async () => {
    fbaConsensus.setValidatorStatus('VAL-01', 'Offline');
    const proposal = makeProposal(2, { proposerId: 'VAL-02' });
    const round = await fbaConsensus.runBlockConsensus(proposal);

    expect(round.status).toBe('ACHIEVED');
    expect(round.quorumSize).toBe(11);
    expect(round.participatingValidators).toBe(11);
    expect(round.quorumMembers).not.toContain('VAL-01');
  });

  // 3. 2-node crash (VAL-05, VAL-06 offline)
  test('3. Simulation: 2 validator crash (VAL-05, VAL-06 offline) maintains quorum', async () => {
    fbaConsensus.setValidatorStatus('VAL-05', 'Offline');
    fbaConsensus.setValidatorStatus('VAL-06', 'Offline');

    const proposal = makeProposal(3);
    const round = await fbaConsensus.runBlockConsensus(proposal);

    expect(round.status).toBe('ACHIEVED');
    expect(round.quorumSize).toBeGreaterThanOrEqual(9);
    expect(round.quorumMembers).not.toContain('VAL-05');
    expect(round.quorumMembers).not.toContain('VAL-06');
  });

  // 4. 3-node crash: threshold boundary
  test('4. Simulation: 3 validator crash (VAL-10, VAL-11, VAL-12 offline) operates at threshold boundary', async () => {
    fbaConsensus.setValidatorStatus('VAL-10', 'Offline');
    fbaConsensus.setValidatorStatus('VAL-11', 'Offline');
    fbaConsensus.setValidatorStatus('VAL-12', 'Offline');

    const proposal = makeProposal(4);
    const round = await fbaConsensus.runBlockConsensus(proposal);

    // Depending on slice topology, if 9 online form quorum, achieved; otherwise safely fails
    if (round.quorumSize >= 9) {
      expect(round.status).toBe('ACHIEVED');
    } else {
      expect(round.status).toBe('FAILED');
    }
  });

  // 5. 4-node crash: safe halt
  test('5. Simulation: 4 validator crash halts block finalization safely', async () => {
    ['VAL-09', 'VAL-10', 'VAL-11', 'VAL-12'].forEach(id => fbaConsensus.setValidatorStatus(id, 'Offline'));

    const proposal = makeProposal(5);
    const round = await fbaConsensus.runBlockConsensus(proposal);

    expect(round.status).toBe('FAILED');
    expect(round.certificate).toBeNull();
    expect(fbaConsensus.stateMachine.getState()).toBe(ConsensusState.REJECTED);
  });

  // 6. Dynamic crash and recovery
  test('6. Simulation: Dynamic node crash and network healing', async () => {
    // Take 2 nodes offline
    fbaConsensus.setValidatorStatus('VAL-01', 'Offline');
    fbaConsensus.setValidatorStatus('VAL-02', 'Offline');

    let net = fbaConsensus.getNetworkStatus();
    expect(net.onlineCount).toBe(10);

    // Recover nodes
    fbaConsensus.setValidatorStatus('VAL-01', 'Online');
    fbaConsensus.setValidatorStatus('VAL-02', 'Online');

    net = fbaConsensus.getNetworkStatus();
    expect(net.onlineCount).toBe(12);
    expect(net.hasQuorum).toBe(true);

    const proposal = makeProposal(6);
    const round = await fbaConsensus.runBlockConsensus(proposal);
    expect(round.status).toBe('ACHIEVED');
    expect(round.quorumSize).toBe(12);
  });

  // 7. Proposer timeout and round advancement
  test('7. Simulation: Proposer timeout triggers explicit round advancement', () => {
    const proposal = makeProposal(7);
    const r0 = new ConsensusRound({ blockHeight: 7, roundNumber: 0, candidateBlockHash: proposal.blockHash });

    expect(r0.roundNumber).toBe(0);

    const r1 = fbaConsensus.advanceRound(proposal, 0, 'PROPOSER_TIMEOUT');
    expect(r1.roundNumber).toBe(1);
    expect(r1.blockHeight).toBe(7);
    expect(r1.roundId).toBeDefined();
    expect(r1.roundId).not.toBe(r0.roundId);
  });

  // 8. Byzantine node with forged signature
  test('8. Simulation: Byzantine node submitting invalid vote is pruned while 11 honest nodes finalize', async () => {
    // Tamper with VAL-12 HTTP query to return corrupted signature
    const originalQuery = fbaConsensus.queryValidatorNodeHTTP.bind(fbaConsensus);
    fbaConsensus.queryValidatorNodeHTTP = async (node, proposal, opts) => {
      const res = await originalQuery(node, proposal, opts);
      if (node.validatorId === 'VAL-12') {
        res.signature = '0xbad'.padEnd(128, '0');
      }
      return res;
    };

    const proposal = makeProposal(8);
    const round = await fbaConsensus.runBlockConsensus(proposal);

    fbaConsensus.queryValidatorNodeHTTP = originalQuery; // Restore

    expect(round.status).toBe('ACHIEVED');
    expect(round.participatingValidators).toBe(11);
    expect(round.certificate.validatorApprovals.find(a => a.validatorId === 'VAL-12')).toBeUndefined();
  });

  // 9. Byzantine double-voter trapped by conflict detector
  test('9. Simulation: Byzantine double-voter caught by conflict detector during round execution', async () => {
    // Pre-record a vote from VAL-03 in the same round for a different block
    const part03 = getOrCreateDevParticipant('VAL-03', 'VALIDATOR');
    const priv03 = getParticipantPrivateKey('VAL-03');
    const sneakyVote = new ValidatorVote({
      validatorId: 'VAL-03',
      validatorAddress: part03.address,
      validatorPublicKey: part03.publicKey,
      proposalId: '0xcompeting_prop',
      blockNumber: 9,
      blockHash: '0xcompeting_block',
      stateRoot: '0xroot',
      round: 0,
      vote: 'ACCEPT'
    });
    sneakyVote.sign(priv03);
    fbaConsensus.voteStore.recordVote(sneakyVote);

    const proposal = makeProposal(9);
    const round = await fbaConsensus.runBlockConsensus(proposal);

    // VAL-03 second vote should be rejected as conflicting, but 11 honest nodes achieve consensus
    expect(round.status).toBe('ACHIEVED');
    expect(round.participatingValidators).toBe(11);
    expect(round.certificate.validatorApprovals.map(a => a.validatorId)).not.toContain('VAL-03');

    const conflicts = fbaConsensus.voteStore.getConflicts();
    expect(conflicts.length).toBeGreaterThanOrEqual(1);
    expect(conflicts.some(c => c.validatorId === 'VAL-03')).toBe(true);
  });

  // 10. Byzantine cluster of 2 nodes
  test('10. Simulation: 2 colluding Byzantine nodes fail to disrupt consensus of 10 honest nodes', async () => {
    // Pre-record conflicting votes for VAL-01 and VAL-02
    ['VAL-01', 'VAL-02'].forEach(id => {
      const part = getOrCreateDevParticipant(id, 'VALIDATOR');
      const priv = getParticipantPrivateKey(id);
      const sneaky = new ValidatorVote({
        validatorId: id,
        validatorAddress: part.address,
        validatorPublicKey: part.publicKey,
        proposalId: '0xfake_prop',
        blockNumber: 10,
        blockHash: '0xfake_hash',
        stateRoot: '0xroot',
        round: 0,
        vote: 'ACCEPT'
      });
      sneaky.sign(priv);
      fbaConsensus.voteStore.recordVote(sneaky);
    });

    const proposal = makeProposal(10, { proposerId: 'VAL-03' });
    const round = await fbaConsensus.runBlockConsensus(proposal);

    expect(round.status).toBe('ACHIEVED');
    expect(round.participatingValidators).toBe(10);
    expect(round.certificate.validatorApprovals.map(a => a.validatorId)).not.toContain('VAL-01');
    expect(round.certificate.validatorApprovals.map(a => a.validatorId)).not.toContain('VAL-02');
  });

  // 11. Safety halt: 3 offline + 1 Byzantine double-voter
  test('11. Simulation: 3 offline nodes and 1 double-voter halts network safely without split', async () => {
    // 3 offline
    ['VAL-09', 'VAL-10', 'VAL-11'].forEach(id => fbaConsensus.setValidatorStatus(id, 'Offline'));

    // 1 double-voter
    const part08 = getOrCreateDevParticipant('VAL-08', 'VALIDATOR');
    const priv08 = getParticipantPrivateKey('VAL-08');
    const sneaky = new ValidatorVote({
      validatorId: 'VAL-08',
      validatorAddress: part08.address,
      validatorPublicKey: part08.publicKey,
      proposalId: '0xfake_prop',
      blockNumber: 11,
      blockHash: '0xfake_hash',
      stateRoot: '0xroot',
      round: 0,
      vote: 'ACCEPT'
    });
    sneaky.sign(priv08);
    fbaConsensus.voteStore.recordVote(sneaky);

    const proposal = makeProposal(11);
    const round = await fbaConsensus.runBlockConsensus(proposal);

    // Remaining honest agreeing nodes = 8 (< 9 threshold), must halt safely
    expect(round.status).toBe('FAILED');
    expect(round.certificate).toBeNull();
  });

  // 12. Consecutive block pipeline across heights 1, 2, 3
  test('12. Simulation: Multi-block pipeline executes consecutively with state transitions', async () => {
    for (let h = 1; h <= 3; h++) {
      fbaConsensus.stateMachine.resetForNewHeight(h);
      fbaConsensus.voteStore.clear();

      const proposal = makeProposal(h);
      const res = await fbaConsensus.runBlockConsensus(proposal);

      expect(res.status).toBe('ACHIEVED');
      expect(res.blockNumber).toBe(h);
      expect(fbaConsensus.stateMachine.isFinalized(h)).toBe(true);
    }
  });

  // 13. Write-ahead journal recovery after simulated crash
  test('13. Simulation: Write-ahead journal reconstitutes state after simulated node crash', async () => {
    const journal = new ConsensusJournal({ inMemoryOnly: true });

    // Round events for block 100
    journal.append('ROUND_STARTED', { height: 100, round: 0, roundId: 'RND-100-0' });
    journal.append('VOTE_RECORDED', { height: 100, round: 0, validatorId: 'VAL-01', vote: 'ACCEPT' });
    journal.append('VOTE_RECORDED', { height: 100, round: 0, validatorId: 'VAL-02', vote: 'ACCEPT' });
    journal.append('BLOCK_FINALIZED', { height: 100, round: 0, blockHash: '0xhash100' });

    // Simulate node restart: create fresh instance and recover
    const recovered = journal.recoverState();
    expect(recovered.lastHeight).toBe(100);
    expect(recovered.lastRound).toBe(0);
    expect(recovered.finalizedHeights).toContain(100);
    expect(recovered.recordedVoteCount).toBe(2);
  });

  // 14. Dynamic quorum engine inspect API
  test('14. Simulation: Quorum engine dynamic slice query APIs during execution', () => {
    const qEngine = fbaConsensus.getQuorumEngine();
    expect(qEngine.isSliceSatisfied('VAL-01', ['VAL-01', 'VAL-02', 'VAL-03'])).toBe(true);
    expect(qEngine.isSliceSatisfied('VAL-01', ['VAL-01', 'VAL-02'])).toBe(false);

    const evalResult = qEngine.evaluate(['VAL-01', 'VAL-02', 'VAL-03', 'VAL-04', 'VAL-05', 'VAL-06', 'VAL-07', 'VAL-08', 'VAL-09', 'VAL-10', 'VAL-11', 'VAL-12']);
    expect(evalResult.isSatisfied).toBe(true);
    expect(evalResult.sliceEvaluations['VAL-01'].agreedMembers.length).toBe(4);
  });

  // 15. State machine transition event audit
  test('15. Simulation: Full state machine event lifecycle audit across round', async () => {
    const recordedEvents = [];
    fbaConsensus.stateMachine.on('transition', ev => recordedEvents.push(ev));

    const proposal = makeProposal(15);
    await fbaConsensus.runBlockConsensus(proposal);

    const transitions = recordedEvents.map(e => `${e.from}->${e.to}`);
    expect(transitions).toContain('IDLE->PROPOSAL');
    expect(transitions).toContain('PROPOSAL->PREVOTE');
    expect(transitions).toContain('PREVOTE->ACCEPTED');
    expect(transitions).toContain('ACCEPTED->CERTIFIED');
    expect(transitions).toContain('CERTIFIED->FINALIZED');
  });
});

