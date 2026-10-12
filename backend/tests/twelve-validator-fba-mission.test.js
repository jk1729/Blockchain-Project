const request = require('supertest');
const app = require('../src/app');
const fbaConsensus = require('../src/consensus/FBAConsensus');
const ConsensusCertificate = require('../src/consensus/ConsensusCertificate');
const blockchainService = require('../src/services/blockchainService');
const { seedDatabase } = require('../src/seed/seedDatabase');
const {
  startAllValidators,
  stopAllValidators,
  getValidatorProcessStatuses
} = require('../src/validators/startValidators');

describe('PDSChain Final Mission: 12-Validator FBA Consensus & 9-of-12 Quorum Suite', () => {
  const validatorTokens = {};

  beforeAll(async () => {
    await seedDatabase(true);
    await blockchainService.init();
    const ValidatorModel = require('../src/models/Validator');
    const records = await ValidatorModel.findAll({ order: [['id', 'ASC']] });
    fbaConsensus.loadValidatorsFromDB(records);
    await startAllValidators({ useChildProcesses: true });
  }, 30000);

  afterAll(async () => {
    await stopAllValidators();
  }, 15000);

  beforeEach(() => {
    fbaConsensus.getValidators().forEach(v => v.setStatus('Online'));
  });

  describe('1. 12 Distinct Validator Identities & 12 Isolated OS Processes (V1..V12 / VAL-01..VAL-12)', () => {
    test('provisions 12 distinct validators with unique Ed25519 public keys, addresses, and 3-of-4 quorum slices', async () => {
      const res = await request(app).get('/api/validators');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.validators).toHaveLength(12);

      const ids = new Set();
      const shortIds = new Set();
      const pubKeys = new Set();
      const addresses = new Set();

      res.body.validators.forEach((v, idx) => {
        const expectedValId = `VAL-${idx + 1 < 10 ? '0' + (idx + 1) : idx + 1}`;
        const expectedShortId = `V${idx + 1}`;
        expect(v.validatorId).toBe(expectedValId);
        expect(v.shortId).toBe(expectedShortId);
        expect(v.publicKey).toMatch(/^[0-9a-f]{64,96}$/i);
        expect(v.address).toMatch(/^PDS1/);
        expect(v.quorumSlice).toBeDefined();
        expect(v.quorumSlice.threshold).toBe(3);
        expect(v.quorumSlice.validators).toHaveLength(4);

        ids.add(v.validatorId);
        shortIds.add(v.shortId);
        pubKeys.add(v.publicKey);
        addresses.add(v.address);
      });

      expect(ids.size).toBe(12);
      expect(shortIds.size).toBe(12);
      expect(pubKeys.size).toBe(12);
      expect(addresses.size).toBe(12);
    });

    test('runs 12 isolated OS child processes on ports 4001..4012 with distinct PIDs', async () => {
      const res = await request(app).get('/api/validators/processes');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.processes).toHaveLength(12);

      const pids = new Set();
      res.body.processes.forEach((p, idx) => {
        expect(p.validatorId).toBe(`VAL-${idx + 1 < 10 ? '0' + (idx + 1) : idx + 1}`);
        expect(p.shortId).toBe(`V${idx + 1}`);
        expect(p.port).toBe(4001 + idx);
        expect(p.running).toBe(true);
        expect(['isolated-os-process', 'child_process']).toContain(p.mode);
        expect(typeof p.pid).toBe('number');
        pids.add(p.pid);
      });
      expect(pids.size).toBe(12);
    });

    test('authenticates all 12 validator logins (v1..v12) with distinct validatorId and shortValidatorId claims', async () => {
      for (let i = 1; i <= 12; i++) {
        const username = `v${i}`;
        const expectedValId = `VAL-${i < 10 ? '0' + i : i}`;
        const expectedShortId = `V${i}`;

        const loginRes = await request(app)
          .post('/api/auth/login')
          .send({ username, password: 'validator123' });

        expect(loginRes.status).toBe(200);
        expect(loginRes.body.success).toBe(true);
        expect(loginRes.body.token).toBeTruthy();
        expect(loginRes.body.user.role).toBe('VALIDATOR');
        expect(loginRes.body.user.validatorId).toBe(expectedValId);
        expect(loginRes.body.user.shortValidatorId).toBe(expectedShortId);

        validatorTokens[expectedShortId] = loginRes.body.token;
        validatorTokens[expectedValId] = loginRes.body.token;
      }
    });
  });

  describe('2. Mandatory 9-of-12 FBA Consensus Demonstration (Cases A, B, C)', () => {
    let activeProposalId = null;
    let initialChainHeight = 0;

    test('Case A — 8 approvals (V1..V8): proposal remains UNFINALIZED, certificate is null, and finalize endpoint refuses with 409 QUORUM_NOT_MET', async () => {
      initialChainHeight = blockchainService.blockchain.chain.length;

      // 1. V1 creates a pending candidate block proposal
      const createRes = await request(app)
        .post('/api/consensus/proposals')
        .set('Authorization', `Bearer ${validatorTokens.V1}`)
        .send({
          description: 'Mission Test Proposal — 9-of-12 FBA Verification',
          commodity: 'Fortified Rice',
          quantityKg: 50,
          shopId: 'FPS-102'
        });

      expect(createRes.status).toBe(201);
      expect(createRes.body.success).toBe(true);
      expect(createRes.body.proposal.status).toBe('PENDING');
      expect(createRes.body.proposal.finalized).toBe(false);
      expect(createRes.body.proposal.approvedCount).toBe(0);
      expect(createRes.body.proposal.threshold).toBe(9);
      activeProposalId = createRes.body.proposal.proposalId;

      // 2. Validators V1 through V8 sequentially cast authenticated ACCEPT votes
      for (let i = 1; i <= 8; i++) {
        const shortId = `V${i}`;
        const valId = `VAL-0${i}`;
        const voteRes = await request(app)
          .post(`/api/consensus/proposals/${activeProposalId}/vote`)
          .set('Authorization', `Bearer ${validatorTokens[shortId]}`)
          .send({
            decision: 'ACCEPT',
            reason: `Approved by ${shortId} (${valId})`,
            useHttpInTest: true
          });

        expect(voteRes.status).toBe(200);
        expect(voteRes.body.success).toBe(true);
        expect(voteRes.body.vote.validatorId).toBe(valId);
        expect(voteRes.body.vote.shortId).toBe(shortId);
        expect(voteRes.body.vote.vote).toBe('ACCEPT');
        expect(voteRes.body.vote.signature).toMatch(/^(0x)?[0-9a-f]{128}$/i);
        expect(voteRes.body.proposal.approvedCount).toBe(i);
        expect(voteRes.body.proposal.finalized).toBe(false);
        expect(voteRes.body.proposal.quorumAchieved).toBe(false);
        expect(voteRes.body.proposal.status).toBe('PENDING');
        expect(voteRes.body.proposal.certificate).toBeNull();
      }

      // 3. Verify explicit finalize attempt at 8 approvals is refused with 409 QUORUM_NOT_MET
      const finalizeAt8 = await request(app)
        .post(`/api/consensus/proposals/${activeProposalId}/finalize`)
        .set('Authorization', `Bearer ${validatorTokens.V1}`);

      expect(finalizeAt8.status).toBe(409);
      expect(finalizeAt8.body.success).toBe(false);
      expect(finalizeAt8.body.code).toBe('QUORUM_NOT_MET');
      expect(finalizeAt8.body.approvedCount).toBe(8);
      expect(finalizeAt8.body.threshold).toBe(9);
      expect(finalizeAt8.body.finalized).toBe(false);

      // 4. Verify telemetry round & ledger height confirm block is still unfinalized
      const roundAt8 = await request(app).get('/api/consensus/rounds/latest');
      expect(roundAt8.status).toBe(200);
      expect(roundAt8.body.round.verifiedCount).toBe(8);
      expect(roundAt8.body.round.signedCount).toBe(8);
      expect(roundAt8.body.round.quorumAchieved).toBe(false);
      expect(roundAt8.body.round.finalized).toBe(false);
      expect(roundAt8.body.round.status).toBe('PENDING');
      expect(blockchainService.blockchain.chain.length).toBe(initialChainHeight);
    });

    test('Case B — 9th approval (V9): satisfies 3-of-4 FBA quorum slices and 9-of-12 threshold, generates verifiable ConsensusCertificate, and finalizes block', async () => {
      // Cast the 9th approval as V9 (VAL-09)
      const vote9Res = await request(app)
        .post(`/api/consensus/proposals/${activeProposalId}/vote`)
        .set('Authorization', `Bearer ${validatorTokens.V9}`)
        .send({
          decision: 'ACCEPT',
          reason: '9th approval satisfying 9-of-12 FBA quorum',
          useHttpInTest: true
        });

      expect(vote9Res.status).toBe(200);
      expect(vote9Res.body.success).toBe(true);
      expect(vote9Res.body.proposal.approvedCount).toBe(9);
      expect(vote9Res.body.proposal.quorumAchieved).toBe(true);
      expect(vote9Res.body.proposal.quorumSize).toBe(9);
      expect(vote9Res.body.proposal.status).toBe('FINALIZED');
      expect(vote9Res.body.proposal.finalized).toBe(true);
      expect(vote9Res.body.proposal.certificate).toBeTruthy();
      expect(vote9Res.body.proposal.certificate.validatorApprovals).toHaveLength(9);

      // Verify the block was committed to the ledger and its certificate is cryptographically valid
      expect(blockchainService.blockchain.chain.length).toBe(initialChainHeight + 1);
      const latestBlock = blockchainService.blockchain.getLatestBlock();
      expect(latestBlock.proposalId).toBe(activeProposalId);
      expect(latestBlock.consensusCertificate).toBeTruthy();

      const certVerification = ConsensusCertificate.verify(
        latestBlock.consensusCertificate,
        latestBlock,
        fbaConsensus.validators
      );
      expect(certVerification.valid).toBe(true);

      const validateRes = await request(app).get('/api/blockchain/validate');
      expect(validateRes.status).toBe(200);
      expect(validateRes.body.isValid).toBe(true);
      expect(validateRes.body.certificatesVerified).toBe(true);
    });

    test('Case C — 12 approvals (V10..V12): records full 12-validator participation and updates certificate & telemetry to 12/12', async () => {
      for (let i = 10; i <= 12; i++) {
        const shortId = `V${i}`;
        const valId = `VAL-${i}`;
        const voteRes = await request(app)
          .post(`/api/consensus/proposals/${activeProposalId}/vote`)
          .set('Authorization', `Bearer ${validatorTokens[shortId]}`)
          .send({
            decision: 'ACCEPT',
            reason: `Full participation vote from ${shortId}`,
            useHttpInTest: true
          });

        expect(voteRes.status).toBe(200);
        expect(voteRes.body.success).toBe(true);
        expect(voteRes.body.proposal.approvedCount).toBe(i);
        expect(voteRes.body.proposal.quorumSize).toBe(i);
        expect(voteRes.body.proposal.finalized).toBe(true);
      }

      const propRes = await request(app).get(`/api/consensus/proposals/${activeProposalId}`);
      expect(propRes.status).toBe(200);
      expect(propRes.body.proposal.approvedCount).toBe(12);
      expect(propRes.body.proposal.certificate.validatorApprovals).toHaveLength(12);

      const roundAt12 = await request(app).get('/api/consensus/rounds/latest');
      expect(roundAt12.status).toBe(200);
      expect(roundAt12.body.round.verifiedCount).toBe(12);
      expect(roundAt12.body.round.signedCount).toBe(12);
      expect(roundAt12.body.round.quorumAchieved).toBe(true);
      expect(roundAt12.body.round.finalized).toBe(true);
      expect(roundAt12.body.round.status).toBe('ACHIEVED');
    });
  });

  describe('3. Case D — Rejections, Identity Mismatch, Equivocation, Invalid Signatures & Offline Faults', () => {
    let testProposalId = null;

    beforeEach(async () => {
      const createRes = await request(app)
        .post('/api/consensus/proposals')
        .set('Authorization', `Bearer ${validatorTokens.V1}`)
        .send({ description: 'Case D Adversarial & Rejection Proposal' });
      testProposalId = createRes.body.proposal.proposalId;
    });

    test('prevents Validator V1 from voting on behalf of V2 (403 VALIDATOR_IDENTITY_MISMATCH)', async () => {
      const res = await request(app)
        .post(`/api/consensus/proposals/${testProposalId}/vote`)
        .set('Authorization', `Bearer ${validatorTokens.V1}`)
        .send({
          validatorId: 'VAL-02',
          decision: 'ACCEPT'
        });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('VALIDATOR_IDENTITY_MISMATCH');
    });

    test('prevents non-validator roles (e.g. CITIZEN / SHOP) from casting validator votes (403 FORBIDDEN_ROLE)', async () => {
      const citizenLogin = await request(app)
        .post('/api/auth/login')
        .send({ username: 'citizen', password: 'citizen123' });

      const res = await request(app)
        .post(`/api/consensus/proposals/${testProposalId}/vote`)
        .set('Authorization', `Bearer ${citizenLogin.body.token}`)
        .send({ decision: 'ACCEPT' });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN_ROLE');
    });

    test('rejects duplicate votes from the same validator on the same proposal (409 DUPLICATE_VOTE)', async () => {
      const firstVote = await request(app)
        .post(`/api/consensus/proposals/${testProposalId}/vote`)
        .set('Authorization', `Bearer ${validatorTokens.V1}`)
        .send({ decision: 'ACCEPT' });
      expect(firstVote.status).toBe(200);

      const secondVote = await request(app)
        .post(`/api/consensus/proposals/${testProposalId}/vote`)
        .set('Authorization', `Bearer ${validatorTokens.V1}`)
        .send({ decision: 'ACCEPT' });

      expect(secondVote.status).toBe(409);
      expect(secondVote.body.code).toBe('DUPLICATE_VOTE');
    });

    test('detects and rejects conflicting equivocation votes from the same validator (409 CONFLICTING_VOTE)', async () => {
      const firstVote = await request(app)
        .post(`/api/consensus/proposals/${testProposalId}/vote`)
        .set('Authorization', `Bearer ${validatorTokens.V2}`)
        .send({ decision: 'ACCEPT' });
      expect(firstVote.status).toBe(200);

      const conflictingVote = await request(app)
        .post(`/api/consensus/proposals/${testProposalId}/vote`)
        .set('Authorization', `Bearer ${validatorTokens.V2}`)
        .send({ decision: 'REJECT' });

      expect(conflictingVote.status).toBe(409);
      expect(conflictingVote.body.code).toBe('CONFLICTING_VOTE');
    });

    test('rejects votes with forged or invalid Ed25519 signatures (400 INVALID_VOTE_SIGNATURE)', async () => {
      const res = await request(app)
        .post(`/api/consensus/proposals/${testProposalId}/vote`)
        .set('Authorization', `Bearer ${validatorTokens.V3}`)
        .send({
          decision: 'ACCEPT',
          signature: '0x' + 'deadbeef'.repeat(16)
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_VOTE_SIGNATURE');
    });

    test('rejects votes from offline validators (409 VALIDATOR_OFFLINE) and allows voting after recovery', async () => {
      await request(app)
        .post('/api/validators/V8/status')
        .set('Authorization', `Bearer ${validatorTokens.V8}`)
        .send({ status: 'Offline' });

      const offlineVote = await request(app)
        .post(`/api/consensus/proposals/${testProposalId}/vote`)
        .set('Authorization', `Bearer ${validatorTokens.V8}`)
        .send({ decision: 'ACCEPT' });

      expect(offlineVote.status).toBe(409);
      expect(offlineVote.body.code).toBe('VALIDATOR_OFFLINE');

      // Restore V8 to Online and verify it can vote again
      await request(app)
        .post('/api/validators/V8/status')
        .set('Authorization', `Bearer ${validatorTokens.V8}`)
        .send({ status: 'Online' });

      const recoveredVote = await request(app)
        .post(`/api/consensus/proposals/${testProposalId}/vote`)
        .set('Authorization', `Bearer ${validatorTokens.V8}`)
        .send({ decision: 'ACCEPT' });

      expect(recoveredVote.status).toBe(200);
      expect(recoveredVote.body.vote.validatorId).toBe('VAL-08');
    });

    test('marks proposal REJECTED when 4 validators reject (leaving max 8 possible approvals < 9)', async () => {
      for (let i = 1; i <= 4; i++) {
        const shortId = `V${i}`;
        const res = await request(app)
          .post(`/api/consensus/proposals/${testProposalId}/vote`)
          .set('Authorization', `Bearer ${validatorTokens[shortId]}`)
          .send({
            decision: 'REJECT',
            reason: `Rejected by ${shortId}`
          });

        expect(res.status).toBe(200);
        if (i < 4) {
          expect(res.body.proposal.status).toBe('PENDING');
          expect(res.body.proposal.canStillReachQuorum).toBe(true);
        } else {
          expect(res.body.proposal.rejectedCount).toBe(4);
          expect(res.body.proposal.canStillReachQuorum).toBe(false);
          expect(res.body.proposal.status).toBe('REJECTED');
          expect(res.body.proposal.finalized).toBe(false);
          expect(res.body.proposal.certificate).toBeNull();
        }
      }

      // Attempting to finalize a rejected proposal fails with 409 PROPOSAL_REJECTED
      const finalizeRes = await request(app)
        .post(`/api/consensus/proposals/${testProposalId}/finalize`)
        .set('Authorization', `Bearer ${validatorTokens.V1}`);

      expect(finalizeRes.status).toBe(409);
      expect(finalizeRes.body.code).toBe('PROPOSAL_REJECTED');
    });

    test('enforces real 3-of-4 FBA quorum slice pruning: 9 approvals with broken slice (V5, V6, V7 absent -> VAL-02 pruned -> quorumSize=8 < 9) refuses finality until slice is satisfied', async () => {
      // Subset of 9 validators where V5, V6, V7 have NOT voted: {V1, V2, V3, V4, V8, V9, V10, V11, V12}
      // VAL-02 trusts [VAL-02, VAL-03, VAL-05, VAL-06] (3-of-4). Without V5 & V6, VAL-02 only has 2/4 (< 3),
      // so iterative pruning removes VAL-02, leaving pruned quorumSize = 8 < 9!
      const nonQuorumNine = ['V1', 'V2', 'V3', 'V4', 'V8', 'V9', 'V10', 'V11', 'V12'];
      let lastVoteRes = null;
      for (const shortId of nonQuorumNine) {
        lastVoteRes = await request(app)
          .post(`/api/consensus/proposals/${testProposalId}/vote`)
          .set('Authorization', `Bearer ${validatorTokens[shortId]}`)
          .send({ decision: 'ACCEPT' });
        expect(lastVoteRes.status).toBe(200);
      }

      // Even though 9 validators voted ACCEPT, pruned FBA quorum size is 8 (< 9), so it MUST NOT finalize!
      expect(lastVoteRes.body.proposal.approvedCount).toBe(9);
      expect(lastVoteRes.body.proposal.quorumSize).toBe(8);
      expect(lastVoteRes.body.proposal.quorumAchieved).toBe(false);
      expect(lastVoteRes.body.proposal.finalized).toBe(false);
      expect(lastVoteRes.body.proposal.status).toBe('PENDING');

      const prematureFin = await request(app)
        .post(`/api/consensus/proposals/${testProposalId}/finalize`)
        .set('Authorization', `Bearer ${validatorTokens.V1}`);
      expect(prematureFin.status).toBe(409);
      expect(prematureFin.body.code).toBe('QUORUM_NOT_MET');

      // Now V5 votes ACCEPT, satisfying VAL-02's 3-of-4 slice -> pruned quorumSize becomes 10 (>= 9) -> FINALIZED!
      const v5Vote = await request(app)
        .post(`/api/consensus/proposals/${testProposalId}/vote`)
        .set('Authorization', `Bearer ${validatorTokens.V5}`)
        .send({ decision: 'ACCEPT' });
      expect(v5Vote.status).toBe(200);
      expect(v5Vote.body.proposal.approvedCount).toBe(10);
      expect(v5Vote.body.proposal.quorumSize).toBe(10);
      expect(v5Vote.body.proposal.quorumAchieved).toBe(true);
      expect(v5Vote.body.proposal.finalized).toBe(true);
      expect(v5Vote.body.proposal.status).toBe('FINALIZED');
    });

    test('rejects replayed vote signatures from a previous proposal and ignores spoofed frontend counters or manual certificates', async () => {
      // 1. Cast valid V1 vote on testProposalId and capture its real Ed25519 signature
      const validVote = await request(app)
        .post(`/api/consensus/proposals/${testProposalId}/vote`)
        .set('Authorization', `Bearer ${validatorTokens.V1}`)
        .send({ decision: 'ACCEPT' });
      expect(validVote.status).toBe(200);
      const capturedSignature = validVote.body.vote.signature;

      // 2. Create a second proposal attempting to spoof approvedCount, quorumAchieved, finalized, and certificate
      const spoofCreate = await request(app)
        .post('/api/consensus/proposals')
        .set('Authorization', `Bearer ${validatorTokens.V1}`)
        .send({
          description: 'Spoofed Frontend Counter Proposal',
          approvedCount: 12,
          quorumSize: 12,
          quorumAchieved: true,
          finalized: true,
          status: 'FINALIZED',
          certificate: { achieved: true, certificateHash: '0xspoofed' }
        });
      expect(spoofCreate.status).toBe(201);
      expect(spoofCreate.body.proposal.approvedCount).toBe(0);
      expect(spoofCreate.body.proposal.quorumAchieved).toBe(false);
      expect(spoofCreate.body.proposal.finalized).toBe(false);
      expect(spoofCreate.body.proposal.certificate).toBeNull();
      const secondProposalId = spoofCreate.body.proposal.proposalId;

      // 3. Replay V1's valid signature from testProposalId onto secondProposalId -> must fail with 400 INVALID_VOTE_SIGNATURE
      const replayRes = await request(app)
        .post(`/api/consensus/proposals/${secondProposalId}/vote`)
        .set('Authorization', `Bearer ${validatorTokens.V1}`)
        .send({
          decision: 'ACCEPT',
          signature: capturedSignature
        });
      expect(replayRes.status).toBe(400);
      expect(replayRes.body.code).toBe('INVALID_VOTE_SIGNATURE');

      // 4. Attempt to force finalization with spoofed body payload -> must fail with 409 QUORUM_NOT_MET
      const spoofFinalize = await request(app)
        .post(`/api/consensus/proposals/${secondProposalId}/finalize`)
        .set('Authorization', `Bearer ${validatorTokens.V1}`)
        .send({
          approvedCount: 12,
          quorumAchieved: true,
          finalized: true,
          certificate: { achieved: true, validatorApprovals: new Array(12).fill({}) }
        });
      expect(spoofFinalize.status).toBe(409);
      expect(spoofFinalize.body.code).toBe('QUORUM_NOT_MET');
    });
  });
});
