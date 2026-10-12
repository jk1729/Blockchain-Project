const ValidatorNode = require('./ValidatorNode');
const ValidatorVote = require('./ValidatorVote');
const VoteStore = require('./VoteStore');
const ConsensusCertificate = require('./ConsensusCertificate');
const ConsensusRound = require('./ConsensusRound');
const { ConsensusState, ConsensusStateMachine } = require('./ConsensusStateMachine');
const QuorumEngine = require('./QuorumEngine');
const FinalityEngine = require('./FinalityEngine');
const ConsensusJournal = require('./ConsensusJournal');
const { DEFAULT_12_VALIDATORS, resolveValidatorId, getShortValidatorId } = require('./consensusConfig');
const { hashProposal, hashBlockHeader } = require('../blockchain/hashing');
const { calculateMerkleRoot } = require('../blockchain/merkle');
const logger = require('../utils/logger');
const http = require('http');
const fs = require('fs');
const path = require('path');

class FBAConsensus {
  constructor(options = {}) {
    this.chainId = parseInt(options.chainId || 1729, 10);
    this.validators = new Map();
    this.voteStore = new VoteStore();
    this.stateMachine = new ConsensusStateMachine();
    this.journal = new ConsensusJournal(options.journalOptions || {});
    this.initDefaultValidators();
    this.quorumEngine = new QuorumEngine(this.validators);
    this.finalityEngine = new FinalityEngine(this.validators);
    this.rounds = [];
    this.proposals = new Map();
    this.activeProposalId = null;
    this.proposalsFilePath = options.proposalsFilePath || path.resolve(__dirname, '../../../database/pending_proposals.json');

    // Timeout configurations
    this.proposalTimeoutMs = parseInt(options.proposalTimeoutMs || 3000, 10);
    this.voteTimeoutMs = parseInt(options.voteTimeoutMs || 3000, 10);
    this.roundTimeoutMs = parseInt(options.roundTimeoutMs || 5000, 10);

    this._loadPersistedProposals();
  }

  _loadPersistedProposals() {
    try {
      if (fs.existsSync(this.proposalsFilePath)) {
        const raw = JSON.parse(fs.readFileSync(this.proposalsFilePath, 'utf8'));
        if (raw && Array.isArray(raw.proposals)) {
          for (const p of raw.proposals) {
            if (p && p.proposalId) {
              this.proposals.set(p.proposalId, p);
            }
          }
          if (raw.activeProposalId && this.proposals.has(raw.activeProposalId)) {
            this.activeProposalId = raw.activeProposalId;
          }
        }
      }
    } catch (err) {
      logger.warn(`[FBAConsensus] Failed to load persisted proposals: ${err.message}`);
    }
  }

  _savePersistedProposals() {
    if (process.env.NODE_ENV === 'test') return;
    try {
      const dir = path.dirname(this.proposalsFilePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const serialized = {
        updatedAt: new Date().toISOString(),
        activeProposalId: this.activeProposalId,
        proposals: Array.from(this.proposals.values()).slice(-30)
      };
      fs.writeFileSync(this.proposalsFilePath, JSON.stringify(serialized, null, 2), 'utf8');
    } catch (err) {
      logger.warn(`[FBAConsensus] Failed to persist proposals: ${err.message}`);
    }
  }

  initDefaultValidators() {
    this.validators.clear();
    for (const vData of DEFAULT_12_VALIDATORS) {
      const node = new ValidatorNode(vData);
      this.validators.set(node.validatorId, node);
    }
    if (this.quorumEngine) {
      this.quorumEngine.loadValidators(this.validators);
    }
    if (this.finalityEngine) {
      this.finalityEngine.quorumEngine.loadValidators(this.validators);
    }
  }

  loadValidatorsFromDB(validatorRecords) {
    if (!validatorRecords || validatorRecords.length === 0) return;
    this.validators.clear();
    for (const r of validatorRecords) {
      const node = new ValidatorNode({
        validatorId: r.validatorId,
        name: r.name,
        org: r.org,
        publicKey: r.publicKey,
        address: r.address,
        status: r.status,
        blockHeight: r.blockHeight,
        txValidated: r.txValidated,
        participation: r.participation,
        trustConfiguration: r.trustConfiguration
      });
      this.validators.set(node.validatorId, node);
    }
    this.quorumEngine.loadValidators(this.validators);
    this.finalityEngine.quorumEngine.loadValidators(this.validators);
    logger.consensus(`Loaded ${this.validators.size} validators into FBA consensus engine.`);
  }

  getValidators() {
    return Array.from(this.validators.values());
  }

  getValidator(id) {
    if (!id) return null;
    const resolved = resolveValidatorId(id) || String(id).trim().toUpperCase();
    return this.validators.get(resolved) || null;
  }

  setValidatorStatus(id, status) {
    const resolved = resolveValidatorId(id) || String(id).trim().toUpperCase();
    const node = this.validators.get(resolved);
    if (!node) return false;
    const ok = node.setStatus(status);
    if (ok) {
      logger.consensus(`Validator ${resolved} (${node.shortId}) status updated to: ${status}`);
      this._syncValidatorProcessStatus(node, status);
    }
    return ok;
  }

  _syncValidatorProcessStatus(node, status) {
    try {
      const num = parseInt(node.validatorId.replace('VAL-', ''), 10);
      if (isNaN(num)) return;
      const port = 4000 + num;
      const postData = JSON.stringify({ status });
      const req = http.request({
        hostname: '127.0.0.1',
        port,
        path: '/status',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        },
        timeout: 150
      }, (res) => {
        res.resume();
      });
      req.on('error', () => {});
      req.on('timeout', () => req.destroy());
      req.write(postData);
      req.end();
    } catch (_) {}
  }

  getNetworkStatus() {
    const nodes = this.getValidators();
    const onlineNodes = [];
    for (const v of nodes) {
      if (v.isOnline()) onlineNodes.push(v.validatorId);
    }
    const qResult = this.quorumEngine.findQuorum(onlineNodes);

    return {
      totalValidators: nodes.length,
      onlineCount: onlineNodes.length,
      offlineCount: nodes.length - onlineNodes.length,
      hasQuorum: qResult.isQuorum,
      quorumMembers: qResult.quorumMembers,
      quorumPercentage: Math.round((qResult.quorumSize / nodes.length) * 100),
      threshold: 9
    };
  }

  getStateMachine() {
    return this.stateMachine;
  }

  getJournal() {
    return this.journal;
  }

  getQuorumEngine() {
    return this.quorumEngine;
  }

  getFinalityEngine() {
    return this.finalityEngine;
  }

  /**
   * Helper to query validator over HTTP with fallback to local in-process evaluation
   */
  async queryValidatorNodeHTTP(node, proposal, options = {}) {
    if (process.env.NODE_ENV === 'test' && !options.useHttpInTest) {
      return proposal.blockNumber !== undefined || proposal.merkleRoot !== undefined
        ? node.evaluateBlockProposal(proposal, options)
        : node.evaluateProposal(proposal);
    }

    const port = 4000 + parseInt(node.validatorId.replace('VAL-', ''), 10);
    const postData = JSON.stringify({ proposal, options });

    return new Promise((resolve) => {
      const req = http.request({
        hostname: '127.0.0.1',
        port,
        path: '/proposal',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        },
        timeout: 250
      }, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(body);
            if (parsed && (parsed.vote === 'ACCEPT' || parsed.vote === 'AGREE')) {
              node.txValidated += 1;
            }
            resolve(parsed);
          } catch (e) {
            resolve(proposal.blockNumber !== undefined || proposal.merkleRoot !== undefined
              ? node.evaluateBlockProposal(proposal, options)
              : node.evaluateProposal(proposal));
          }
        });
      });

      req.on('error', () => {
        resolve(proposal.blockNumber !== undefined || proposal.merkleRoot !== undefined
          ? node.evaluateBlockProposal(proposal, options)
          : node.evaluateProposal(proposal));
      });

      req.on('timeout', () => {
        req.destroy();
        resolve(proposal.blockNumber !== undefined || proposal.merkleRoot !== undefined
          ? node.evaluateBlockProposal(proposal, options)
          : node.evaluateProposal(proposal));
      });

      req.write(postData);
      req.end();
    });
  }

  /**
   * Request a cryptographically signed manual vote from the isolated validator process on port 4001..4012
   * with fallback to in-process ValidatorNode.signManualVote.
   */
  async queryValidatorManualVoteHTTP(node, proposal, decision, reason = '', options = {}) {
    if (process.env.NODE_ENV === 'test' && !options.useHttpInTest) {
      return node.signManualVote(proposal, decision, reason, options);
    }

    const port = 4000 + parseInt(node.validatorId.replace('VAL-', ''), 10);
    const postData = JSON.stringify({
      proposal,
      decision,
      reason,
      round: options.round,
      chainId: options.chainId,
      options
    });

    return new Promise((resolve) => {
      const req = http.request({
        hostname: '127.0.0.1',
        port,
        path: '/vote-proposal',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        },
        timeout: 400
      }, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(body);
            const votePayload = (parsed && parsed.vote && typeof parsed.vote === 'object') ? parsed.vote : parsed;
            if (votePayload && votePayload.validatorId && votePayload.signature) {
              if (votePayload.vote === 'ACCEPT') {
                node.txValidated += 1;
              }
              return resolve(new ValidatorVote(votePayload));
            }
            resolve(node.signManualVote(proposal, decision, reason, options));
          } catch (e) {
            resolve(node.signManualVote(proposal, decision, reason, options));
          }
        });
      });

      req.on('error', () => {
        resolve(node.signManualVote(proposal, decision, reason, options));
      });

      req.on('timeout', () => {
        req.destroy();
        resolve(node.signManualVote(proposal, decision, reason, options));
      });

      req.write(postData);
      req.end();
    });
  }

  /**
   * Advance consensus to next round on timeout or proposer stall
   * @param {Block|object} candidateBlock 
   * @param {number} currentRound 
   * @param {string} reason 
   * @returns {ConsensusRound}
   */
  advanceRound(candidateBlock, currentRound = 0, reason = 'TIMEOUT') {
    const nextRoundNumber = currentRound + 1;
    const blockNumber = parseInt(candidateBlock.blockNumber !== undefined ? candidateBlock.blockNumber : candidateBlock.index, 10) || 0;
    const previousHash = String(candidateBlock.previousHash || '');
    const blockHash = String(candidateBlock.blockHash || candidateBlock.hash || '');

    this.journal.append('ROUND_TIMEOUT', {
      height: blockNumber,
      round: currentRound,
      nextRound: nextRoundNumber,
      reason
    });

    if (this.stateMachine.canTransition(ConsensusState.TIMEOUT)) {
      this.stateMachine.transition(ConsensusState.TIMEOUT, { height: blockNumber, round: currentRound, reason });
    }
    if (this.stateMachine.canTransition(ConsensusState.RECOVERING)) {
      this.stateMachine.transition(ConsensusState.RECOVERING, { height: blockNumber, round: nextRoundNumber, reason: 'Advancing round' });
    }

    const nextRoundObj = new ConsensusRound({
      chainId: this.chainId,
      blockHeight: blockNumber,
      roundNumber: nextRoundNumber,
      previousBlockHash: previousHash,
      candidateBlockHash: blockHash
    });

    return nextRoundObj;
  }

  /**
   * Execute an FBA Consensus Round for a Candidate Block Proposal.
   * Produces signed validator votes, evaluates quorum slices and global threshold (9/12),
   * and creates a cryptographically verifiable ConsensusCertificate.
   * 
   * @param {Block|object} candidateBlock 
   * @param {object} [options] - { round, expectedStateRoot, threshold, blockchain }
   * @returns {Promise<object>} Round summary with ConsensusCertificate
   */
  async runBlockConsensus(candidateBlock, options = {}) {
    const round = parseInt(options.round !== undefined ? options.round : (candidateBlock.round || 0), 10);
    const threshold = parseInt(options.threshold || 9, 10);
    const startTime = Date.now();
    const nodes = this.getValidators();

    const proposalId = candidateBlock.proposalId || hashProposal(candidateBlock);
    const blockNumber = parseInt(candidateBlock.blockNumber !== undefined ? candidateBlock.blockNumber : candidateBlock.index, 10) || 0;
    const stateRoot = String(candidateBlock.stateRoot || options.stateRoot || '');
    const previousHash = String(candidateBlock.previousHash || '');
    const rawBlockHash = candidateBlock.blockHash || candidateBlock.hash;
    const blockHash = rawBlockHash
      ? String(rawBlockHash)
      : hashBlockHeader({
          version: parseInt(candidateBlock.version !== undefined ? candidateBlock.version : 1, 10),
          blockNumber,
          previousHash,
          timestamp: String(candidateBlock.timestamp || ''),
          merkleRoot: String(candidateBlock.merkleRoot || calculateMerkleRoot(Array.isArray(candidateBlock.transactions) ? candidateBlock.transactions : [])),
          stateRoot,
          proposerId: String(candidateBlock.proposerId || 'VAL-01'),
          nonce: parseInt(candidateBlock.blockNonce !== undefined ? candidateBlock.blockNonce : (candidateBlock.nonce || 0), 10) || 0,
          consensusStatus: String(candidateBlock.consensusStatus || 'FINALIZED')
        });

    // Deterministic Canonical ConsensusRound
    const consensusRound = new ConsensusRound({
      chainId: this.chainId,
      blockHeight: blockNumber,
      roundNumber: round,
      previousBlockHash: previousHash,
      candidateBlockHash: blockHash,
      proposerId: candidateBlock.proposerId || 'VAL-01'
    });
    const roundId = consensusRound.roundId;

    // Record round start in journal
    this.journal.append('ROUND_STARTED', {
      roundId,
      chainId: this.chainId,
      height: blockNumber,
      round,
      previousHash,
      blockHash
    });

    // State machine transition: IDLE -> PROPOSAL
    if (this.stateMachine.canTransition(ConsensusState.PROPOSAL)) {
      this.stateMachine.transition(ConsensusState.PROPOSAL, { height: blockNumber, round, roundId, reason: 'Candidate block proposal received' });
    }

    // State machine transition: PROPOSAL -> PREVOTE
    if (this.stateMachine.canTransition(ConsensusState.PREVOTE)) {
      this.stateMachine.transition(ConsensusState.PREVOTE, { height: blockNumber, round, roundId, reason: 'Beginning validator prevote querying' });
    }

    const reqChainId = candidateBlock.chainId !== undefined ? candidateBlock.chainId : options.chainId;

    const votes = [];
    const agreeingValidatorIds = [];
    const approvalMap = new Map();

    for (const node of nodes) {
      let voteResult;
      if (!node.isOnline()) {
        const offlineData = {
          validatorId: node.validatorId,
          validatorAddress: node.address,
          validatorPublicKey: node.publicKey,
          proposalId,
          blockNumber,
          blockHash,
          stateRoot,
          round,
          vote: 'REJECT',
          reason: 'Node is offline',
          timestamp: new Date().toISOString()
        };
        if (reqChainId !== undefined) {
          offlineData.chainId = reqChainId;
        }
        voteResult = new ValidatorVote(offlineData);
      } else {
        const queryOpts = { round, ...options };
        if (reqChainId !== undefined) queryOpts.chainId = reqChainId;
        const rawRes = await this.queryValidatorNodeHTTP(node, candidateBlock, queryOpts);
        voteResult = rawRes instanceof ValidatorVote ? rawRes : new ValidatorVote(rawRes);
      }

      // Record in voteStore (detects conflicting / duplicate votes via ConflictDetector)
      const recordRes = this.voteStore.recordVote(voteResult);
      const isConflictFree = recordRes.success || recordRes.code === 'DUPLICATE_VOTE';
      if (!recordRes.success && recordRes.code !== 'DUPLICATE_VOTE') {
        logger.consensus(`Vote rejected from ${node.validatorId}: ${recordRes.reason}`);
      } else if (recordRes.success) {
        this.journal.append('VOTE_RECORDED', {
          roundId,
          validatorId: node.validatorId,
          vote: voteResult.vote,
          signature: voteResult.signature
        });
      }

      votes.push(voteResult);
      consensusRound.addVote(voteResult);

      // Check if vote is valid signed ACCEPT AND was accepted without conflict
      if (isConflictFree && voteResult.isAccept()) {
        const sigCheck = voteResult.verifySignature();
        if (sigCheck.valid) {
          agreeingValidatorIds.push(node.validatorId);
          approvalMap.set(node.validatorId, {
            validatorId: node.validatorId,
            validatorAddress: node.address || voteResult.validatorAddress,
            validatorPublicKey: node.publicKey || voteResult.validatorPublicKey,
            signature: voteResult.signature,
            timestamp: voteResult.timestamp,
            vote: 'ACCEPT'
          });
        } else {
          logger.consensus(`Validator ${node.validatorId} vote signature verification failed: ${sigCheck.reason}`);
        }
      }
    }

    // Evaluate FBA Quorum Slices and Threshold via QuorumEngine using only verified, non-conflicting votes
    const verifiedVotes = votes.filter(v => !v.isAccept() || approvalMap.has(v.validatorId));
    const quorumResult = this.quorumEngine.evaluate(verifiedVotes, { threshold, round });
    const isQuorum = quorumResult.isQuorum;
    const quorumSize = quorumResult.quorumSize;

    let certificate = null;
    const finalApprovals = [];

    if (quorumResult.isSatisfied) {
      // Include all validated approvals from verified quorum members
      for (const mId of quorumResult.quorumMembers) {
        if (approvalMap.has(mId)) {
          finalApprovals.push(approvalMap.get(mId));
        }
      }
    }

    const isSuccess = quorumResult.isSatisfied && finalApprovals.length >= threshold;

    if (isSuccess) {
      // Transition: PREVOTE -> ACCEPTED
      if (this.stateMachine.canTransition(ConsensusState.ACCEPTED)) {
        this.stateMachine.transition(ConsensusState.ACCEPTED, { height: blockNumber, round, roundId, reason: 'Quorum slices and threshold satisfied' });
      }

      const certData = {
        version: 1,
        proposalId,
        blockNumber,
        blockHash,
        stateRoot,
        round,
        threshold,
        totalValidators: nodes.length,
        achieved: true,
        validatorApprovals: finalApprovals
      };
      if (reqChainId !== undefined) {
        certData.chainId = reqChainId;
      }
      certificate = new ConsensusCertificate(certData);

      consensusRound.certificate = certificate;
      consensusRound.status = 'ACHIEVED';

      // Transition: ACCEPTED -> CERTIFIED
      if (this.stateMachine.canTransition(ConsensusState.CERTIFIED)) {
        this.stateMachine.transition(ConsensusState.CERTIFIED, { height: blockNumber, round, roundId, reason: 'ConsensusCertificate generated' });
      }

      this.journal.append('CERTIFICATE_GENERATED', {
        roundId,
        certificateHash: certificate.certificateHash,
        approvalCount: finalApprovals.length,
        threshold
      });

      // Transition: CERTIFIED -> FINALIZED
      if (this.stateMachine.canTransition(ConsensusState.FINALIZED)) {
        this.stateMachine.transition(ConsensusState.FINALIZED, { height: blockNumber, round, roundId, reason: 'Block consensus fully achieved' });
        this.journal.append('BLOCK_FINALIZED', {
          roundId,
          height: blockNumber,
          blockHash,
          certificateHash: certificate.certificateHash
        });
      }
    } else {
      consensusRound.status = 'FAILED';

      // Transition: PREVOTE -> REJECTED
      if (this.stateMachine.canTransition(ConsensusState.REJECTED)) {
        this.stateMachine.transition(ConsensusState.REJECTED, {
          height: blockNumber,
          round,
          roundId,
          reason: quorumResult.failureReasons.join('; ') || 'Quorum not achieved'
        });
      }
    }

    const latencyMs = Math.max(Date.now() - startTime, 12);
    const roundSummary = {
      roundId,
      round,
      proposalId,
      blockNumber,
      blockHash,
      previousHash,
      merkleRoot: candidateBlock.merkleRoot || '',
      stateRoot,
      transactions: candidateBlock.transactions || [],
      transactionId: (candidateBlock.transactions && candidateBlock.transactions[0])
        ? (candidateBlock.transactions[0].transactionId || candidateBlock.transactions[0].id)
        : null,
      timestamp: new Date().toISOString(),
      latencyMs,
      totalValidators: nodes.length,
      participatingValidators: finalApprovals.length,
      agreeingValidators: quorumResult.quorumMembers || agreeingValidatorIds,
      quorumAchieved: isQuorum,
      quorumMembers: quorumResult.quorumMembers,
      quorumSize,
      threshold,
      status: isSuccess ? 'ACHIEVED' : 'FAILED',
      certificate: certificate ? certificate.toJSON() : null,
      validatorSignatures: finalApprovals.map(a => ({
        validatorId: a.validatorId,
        signature: a.signature,
        timestamp: a.timestamp
      })),
      votes: votes.map(v => v.toJSON())
    };

    this.rounds.unshift(roundSummary);
    if (this.rounds.length > 50) this.rounds.pop();

    logger.consensus(`Block #${blockNumber} Consensus Round ${roundId} -> Status: ${roundSummary.status} (Quorum: ${quorumSize}/${nodes.length}, Threshold: ${threshold})`);
    return roundSummary;
  }

  /**
   * Execute a full FBA Consensus Round (backward-compatible legacy and block dispatcher)
   */
  async runConsensusRound(proposal, options = {}) {
    // If proposal looks like candidate block with blockNumber / transactions array
    if (proposal && (proposal.blockNumber !== undefined || proposal.transactions !== undefined)) {
      return await this.runBlockConsensus(proposal, options);
    }

    // Legacy transaction proposal path
    const roundId = `RND-${Date.now().toString().slice(-6)}`;
    const startTime = Date.now();
    const nodes = this.getValidators();
    const votes = [];
    const agreeingNodes = [];
    const validatorSignatures = [];

    for (const node of nodes) {
      let voteResult;
      if (!node.isOnline()) {
        voteResult = {
          validatorId: node.validatorId,
          vote: 'OFFLINE',
          reason: 'Node is offline',
          signature: null
        };
      } else {
        voteResult = await this.queryValidatorNodeHTTP(node, proposal);
      }

      votes.push(voteResult);

      if (voteResult.vote === 'AGREE' || voteResult.vote === 'ACCEPT') {
        agreeingNodes.push(node.validatorId);
        validatorSignatures.push({
          validatorId: node.validatorId,
          signature: voteResult.signature,
          timestamp: voteResult.timestamp
        });
      }
    }

    const quorumResult = this.quorumEngine.findQuorum(agreeingNodes);
    const latencyMs = Math.max(Date.now() - startTime, 12);
    const isSuccess = quorumResult.isQuorum && quorumResult.quorumSize >= 9;

    const roundSummary = {
      roundId,
      transactionId: proposal ? proposal.transactionId : null,
      timestamp: new Date().toISOString(),
      latencyMs,
      totalValidators: nodes.length,
      participatingValidators: agreeingNodes.length,
      agreeingValidators: agreeingNodes,
      quorumAchieved: quorumResult.isQuorum,
      quorumMembers: quorumResult.quorumMembers,
      quorumSize: quorumResult.quorumSize,
      status: isSuccess ? 'ACHIEVED' : 'FAILED',
      validatorSignatures,
      votes
    };

    this.rounds.unshift(roundSummary);
    if (this.rounds.length > 50) this.rounds.pop();

    logger.consensus(`Round ${roundId} for ${proposal ? proposal.transactionId : 'N/A'} -> Status: ${roundSummary.status} (Quorum: ${roundSummary.quorumSize}/${nodes.length})`);
    return roundSummary;
  }

  verifyCertificate(certificate, block) {
    return ConsensusCertificate.verify(certificate, block, this.validators);
  }

  hydrateRoundsFromChain(chain = []) {
    if (!Array.isArray(chain) || chain.length === 0) return;
    if (this.rounds.length > 0) return;
    const recentBlocks = chain.slice(-15);
    for (const blk of recentBlocks) {
      const cert = blk.consensusCertificate || null;
      const approvals = (cert && Array.isArray(cert.validatorApprovals)) ? cert.validatorApprovals : [];
      const agreeingIds = approvals.length > 0
        ? approvals.map(a => a.validatorId)
        : (Array.isArray(blk.validatorSignatures)
            ? blk.validatorSignatures.map(s => (typeof s === 'string' ? s : s.validatorId)).filter(Boolean)
            : DEFAULT_12_VALIDATORS.map(v => v.validatorId));
      const votes = DEFAULT_12_VALIDATORS.map(v => {
        const app = approvals.find(a => a.validatorId === v.validatorId);
        const signed = agreeingIds.includes(v.validatorId);
        return {
          validatorId: v.validatorId,
          shortId: v.shortId,
          vote: signed ? 'ACCEPT' : 'OFFLINE',
          signature: app ? app.signature : (signed ? '0xCERTIFIED_LEDGER_SIG' : null),
          timestamp: app ? app.timestamp : blk.timestamp,
          reason: signed ? '' : 'Not in block certificate'
        };
      });
      this.rounds.unshift({
        roundId: `RND-BLK-${blk.blockNumber}`,
        round: blk.round || 0,
        proposalId: blk.proposalId || '',
        blockNumber: blk.blockNumber,
        blockHash: blk.blockHash || blk.hash,
        previousHash: blk.previousHash,
        merkleRoot: blk.merkleRoot || '',
        stateRoot: blk.stateRoot || '',
        transactions: blk.transactions || [],
        transactionId: (blk.transactions && blk.transactions[0])
          ? (blk.transactions[0].transactionId || blk.transactions[0].id)
          : null,
        timestamp: blk.timestamp,
        latencyMs: 18,
        totalValidators: 12,
        participatingValidators: agreeingIds.length,
        agreeingValidators: agreeingIds,
        quorumAchieved: agreeingIds.length >= 9,
        quorumMembers: agreeingIds,
        quorumSize: agreeingIds.length,
        threshold: (cert && cert.threshold) || 9,
        status: 'ACHIEVED',
        certificate: cert,
        validatorSignatures: approvals.map(a => ({
          validatorId: a.validatorId,
          signature: a.signature,
          timestamp: a.timestamp
        })),
        votes
      });
    }
  }

  _buildProposalError(message, code, statusCode = 400, details = {}) {
    const err = new Error(message);
    err.code = code;
    err.statusCode = statusCode;
    Object.assign(err, details);
    return err;
  }

  formatProposalSummary(proposal) {
    if (!proposal) return null;
    const nodes = this.getValidators();
    const validatorStatuses = nodes.map(node => {
      const cast = proposal.votes ? proposal.votes[node.validatorId] : null;
      const isOnline = node.isOnline();
      const rawSig = cast ? cast.signature : null;
      const sigDigest = rawSig && typeof rawSig === 'string' && rawSig.length > 16
        ? `${rawSig.slice(0, 10)}...${rawSig.slice(-6)}`
        : rawSig;

      return {
        validatorId: node.validatorId,
        shortId: node.shortId || getShortValidatorId(node.validatorId),
        name: node.name,
        org: node.org,
        address: node.address,
        publicKey: node.publicKey,
        status: node.status,
        isOnline,
        hasVoted: Boolean(cast),
        vote: cast ? cast.vote : (isOnline ? 'PENDING' : 'OFFLINE'),
        reason: cast ? (cast.reason || '') : (isOnline ? 'Awaiting validator vote' : 'Validator is offline'),
        votedAt: cast ? cast.timestamp : null,
        signature: rawSig || null,
        signatureDigest: sigDigest || null,
        verified: Boolean(cast && cast.vote === 'ACCEPT' && rawSig),
        quorumSlice: node.quorumSlice ? node.quorumSlice.toJSON() : null
      };
    });

    return {
      proposalId: proposal.proposalId,
      roundId: proposal.roundId,
      round: proposal.round,
      chainId: proposal.chainId,
      blockNumber: proposal.blockNumber,
      blockHash: proposal.blockHash,
      previousHash: proposal.previousHash,
      merkleRoot: proposal.merkleRoot,
      stateRoot: proposal.stateRoot,
      proposerId: proposal.proposerId,
      proposerShortId: proposal.proposerShortId || getShortValidatorId(proposal.proposerId),
      proposerAddress: proposal.proposerAddress,
      description: proposal.description,
      transactionId: proposal.transactionId,
      transactions: proposal.candidateBlock ? proposal.candidateBlock.transactions : [],
      createdAt: proposal.createdAt,
      createdBy: proposal.createdBy,
      threshold: proposal.threshold,
      totalValidators: proposal.totalValidators,
      autoFinalize: proposal.autoFinalize,
      status: proposal.status,
      finalized: Boolean(proposal.finalized),
      finalizedAt: proposal.finalizedAt || null,
      quorumAchieved: Boolean(proposal.quorumAchieved),
      quorumSize: proposal.quorumSize || 0,
      quorumMembers: proposal.quorumMembers || [],
      approvedCount: proposal.approvedCount || 0,
      rejectedCount: proposal.rejectedCount || 0,
      pendingCount: Math.max(0, proposal.totalValidators - ((proposal.approvedCount || 0) + (proposal.rejectedCount || 0))),
      remainingForQuorum: Math.max(0, proposal.threshold - (proposal.approvedCount || 0)),
      canStillReachQuorum: proposal.canStillReachQuorum !== false,
      certificate: proposal.certificate || null,
      certificateHash: proposal.certificate ? proposal.certificate.certificateHash : null,
      voteHistory: proposal.voteHistory || [],
      validators: validatorStatuses
    };
  }

  _syncProposalToTelemetryRound(proposal) {
    if (!proposal) return null;
    const castList = Object.values(proposal.votes || {});
    const acceptVotes = castList.filter(v => v.vote === 'ACCEPT');
    const roundSummary = {
      roundId: proposal.roundId,
      round: proposal.round,
      proposalId: proposal.proposalId,
      blockNumber: proposal.blockNumber,
      blockHash: proposal.blockHash,
      previousHash: proposal.previousHash,
      merkleRoot: proposal.merkleRoot,
      stateRoot: proposal.stateRoot,
      transactions: proposal.candidateBlock ? proposal.candidateBlock.transactions : [],
      transactionId: proposal.transactionId,
      timestamp: proposal.finalizedAt || proposal.createdAt || new Date().toISOString(),
      latencyMs: proposal.latencyMs || 16,
      totalValidators: proposal.totalValidators,
      participatingValidators: acceptVotes.length,
      agreeingValidators: proposal.quorumMembers && proposal.quorumMembers.length > 0
        ? proposal.quorumMembers
        : acceptVotes.map(v => v.validatorId),
      quorumAchieved: Boolean(proposal.quorumAchieved),
      quorumMembers: proposal.quorumMembers || [],
      quorumSize: proposal.quorumSize || 0,
      threshold: proposal.threshold || 9,
      status: proposal.finalized
        ? 'ACHIEVED'
        : (proposal.status === 'REJECTED' ? 'REJECTED' : 'PENDING'),
      finalized: Boolean(proposal.finalized),
      isInteractiveProposal: true,
      approvedCount: proposal.approvedCount || 0,
      rejectedCount: proposal.rejectedCount || 0,
      remainingForQuorum: Math.max(0, (proposal.threshold || 9) - (proposal.approvedCount || 0)),
      canStillReachQuorum: proposal.canStillReachQuorum !== false,
      certificate: proposal.certificate || null,
      validatorSignatures: acceptVotes.map(a => ({
        validatorId: a.validatorId,
        signature: a.signature,
        timestamp: a.timestamp
      })),
      votes: castList
    };

    const existingIdx = this.rounds.findIndex(r => r.proposalId === proposal.proposalId || r.roundId === proposal.roundId);
    if (existingIdx >= 0) {
      this.rounds.splice(existingIdx, 1);
    }
    this.rounds.unshift(roundSummary);
    if (this.rounds.length > 50) this.rounds.pop();
    return roundSummary;
  }

  /**
   * Create a new Pending Candidate Block Proposal for step-by-step 12-validator voting (V1..V12).
   */
  async createPendingProposal(payload = {}, options = {}) {
    const Block = require('../blockchain/Block');
    const Transaction = require('../blockchain/Transaction');
    const blockchainService = require('../services/blockchainService');
    const { getOrCreateDevParticipant, getParticipantPrivateKey } = require('../blockchain/identity/keyManager');

    const latestBlock = blockchainService.blockchain.getLatestBlock();
    const nextHeight = payload.blockNumber !== undefined
      ? parseInt(payload.blockNumber, 10)
      : (latestBlock.blockNumber + 1);
    let round = 0;
    if (payload.round !== undefined) {
      round = parseInt(payload.round, 10) || 0;
    } else {
      let maxRoundAtHeight = -1;
      for (const existing of this.proposals.values()) {
        if (existing.blockNumber === nextHeight && typeof existing.round === 'number') {
          if (existing.round > maxRoundAtHeight) maxRoundAtHeight = existing.round;
        }
      }
      round = maxRoundAtHeight + 1;
    }
    const threshold = parseInt(payload.threshold || 9, 10);
    const proposerId = resolveValidatorId(payload.proposerId || options.proposerId || 'VAL-01') || 'VAL-01';
    const proposerPart = getOrCreateDevParticipant(proposerId, 'VALIDATOR');
    const proposerPrivKey = getParticipantPrivateKey(proposerId);

    let stateRoot = payload.stateRoot;
    if (!stateRoot) {
      try {
        stateRoot = await blockchainService.getCurrentStateRoot();
      } catch (_) {
        stateRoot = latestBlock.stateRoot || '0'.repeat(64);
      }
    }

    const timestamp = payload.timestamp || new Date().toISOString();
    let txList = [];
    if (Array.isArray(payload.transactions) && payload.transactions.length > 0) {
      txList = payload.transactions.map(t => (t instanceof Transaction ? t : new Transaction(t)));
    } else {
      const txId = payload.transactionId || `TX-FBA-${nextHeight}-${Date.now().toString().slice(-5)}`;
      const txObj = new Transaction({
        version: '1.0',
        chainId: this.chainId,
        transactionId: txId,
        type: payload.type || 'DISTRIBUTION',
        sender: proposerPart.address,
        senderPublicKey: proposerPart.publicKey,
        receiver: payload.receiver || payload.shopId || 'FPS-1001',
        nonce: nextHeight,
        timestamp,
        payload: {
          transactionId: txId,
          description: payload.description || `12-Validator FBA Proposal for Block #${nextHeight}`,
          commodity: payload.commodity || 'Fortified Rice & Wheat',
          quantity: Number(payload.quantityKg || payload.quantity || 50),
          unit: 'KG',
          shopId: payload.shopId || 'FPS-1001',
          beneficiaryId: payload.beneficiaryId || 'BEN-1001'
        }
      });
      if (proposerPrivKey && !txObj.signature) {
        txObj.sign(proposerPrivKey, proposerPart.publicKey);
      }
      txList = [txObj];
    }

    const candidateBlock = new Block(
      nextHeight,
      timestamp,
      txList,
      latestBlock.blockHash,
      0,
      'FINALIZED',
      [],
      stateRoot,
      {
        version: 1,
        proposerId,
        proposerAddress: proposerPart.address,
        round
      }
    );

    if (proposerPrivKey) {
      candidateBlock.signProposal(proposerPrivKey);
    }
    candidateBlock.mineBlock(blockchainService.blockchain.difficulty);

    const consensusRound = new ConsensusRound({
      chainId: this.chainId,
      blockHeight: nextHeight,
      roundNumber: round,
      previousBlockHash: latestBlock.blockHash,
      candidateBlockHash: candidateBlock.blockHash,
      proposerId
    });

    const txPrimaryId = txList[0] ? (txList[0].transactionId || txList[0].id) : null;
    const proposal = {
      proposalId: candidateBlock.proposalId,
      roundId: consensusRound.roundId,
      round,
      chainId: this.chainId,
      blockNumber: nextHeight,
      blockHash: candidateBlock.blockHash,
      previousHash: candidateBlock.previousHash,
      merkleRoot: candidateBlock.merkleRoot,
      stateRoot: candidateBlock.stateRoot,
      proposerId,
      proposerShortId: getShortValidatorId(proposerId),
      proposerAddress: candidateBlock.proposerAddress,
      proposerSignature: candidateBlock.proposerSignature,
      timestamp: candidateBlock.timestamp,
      createdAt: new Date().toISOString(),
      createdBy: options.createdBy || proposerId,
      description: payload.description || `Candidate Block #${nextHeight} — 9-of-12 FBA Proposal`,
      transactionId: txPrimaryId,
      threshold,
      totalValidators: this.validators.size || 12,
      autoFinalize: payload.autoFinalize !== false,
      status: 'PENDING',
      finalized: false,
      finalizedAt: null,
      quorumAchieved: false,
      quorumSize: 0,
      quorumMembers: [],
      approvedCount: 0,
      rejectedCount: 0,
      remainingForQuorum: threshold,
      canStillReachQuorum: true,
      candidateBlock: candidateBlock.toJSON(),
      votes: {},
      voteHistory: [],
      certificate: null
    };

    this.proposals.set(proposal.proposalId, proposal);
    this.activeProposalId = proposal.proposalId;

    if (this.stateMachine.canTransition(ConsensusState.PROPOSAL)) {
      this.stateMachine.transition(ConsensusState.PROPOSAL, {
        height: nextHeight,
        round,
        roundId: consensusRound.roundId,
        reason: `Interactive proposal ${proposal.proposalId.slice(0, 12)} created`
      });
    }
    if (this.stateMachine.canTransition(ConsensusState.PREVOTE)) {
      this.stateMachine.transition(ConsensusState.PREVOTE, {
        height: nextHeight,
        round,
        roundId: consensusRound.roundId,
        reason: 'Awaiting 12-validator authenticated votes (9-of-12 quorum threshold)'
      });
    }

    this.journal.append('PROPOSAL_CREATED', {
      proposalId: proposal.proposalId,
      roundId: proposal.roundId,
      height: nextHeight,
      round,
      proposerId,
      threshold
    });

    this._syncProposalToTelemetryRound(proposal);
    this._savePersistedProposals();

    logger.consensus(`Created pending proposal ${proposal.proposalId.slice(0, 14)}... for Block #${nextHeight} (Proposer: ${proposerId})`);
    return this.formatProposalSummary(proposal);
  }

  getProposalById(proposalId) {
    if (!proposalId || proposalId === 'active' || proposalId === 'latest') {
      return this.getActiveProposal();
    }
    const proposal = this.proposals.get(proposalId);
    return proposal ? this.formatProposalSummary(proposal) : null;
  }

  getActiveProposal() {
    if (this.activeProposalId && this.proposals.has(this.activeProposalId)) {
      return this.formatProposalSummary(this.proposals.get(this.activeProposalId));
    }
    const all = Array.from(this.proposals.values());
    if (all.length === 0) return null;
    return this.formatProposalSummary(all[all.length - 1]);
  }

  getAllProposals() {
    return Array.from(this.proposals.values())
      .slice()
      .reverse()
      .map(p => this.formatProposalSummary(p));
  }

  /**
   * Cast an authenticated validator vote (ACCEPT/APPROVE or REJECT) on a pending proposal.
   * Enforces:
   * - Authenticated validator identity matching (V1 cannot vote as V2)
   * - Membership in the 12-validator set (VAL-01..VAL-12)
   * - Validator online status (Offline validators cannot vote)
   * - Duplicate vote prevention & equivocation detection
   * - Ed25519 signature generation & verification
   * - 9-of-12 FBA Quorum Slice & Threshold evaluation (Cases A, B, C, D)
   */
  async castValidatorVote(voteInput = {}, authenticatedUser = null) {
    const blockchainService = require('../services/blockchainService');
    const targetId = voteInput.proposalId || this.activeProposalId;
    const proposal = targetId ? this.proposals.get(targetId) : null;
    if (!proposal) {
      throw this._buildProposalError(
        `Pending proposal '${targetId || 'active'}' not found. Create a proposal first.`,
        'PROPOSAL_NOT_FOUND',
        404
      );
    }

    // 1. Enforce role & validator identity authorization
    let canonicalValidatorId = null;
    if (authenticatedUser) {
      const userRole = String(authenticatedUser.role || '').toUpperCase();
      if (userRole !== 'VALIDATOR') {
        throw this._buildProposalError(
          `Role '${userRole}' is not permitted to cast validator consensus votes. Only authenticated VALIDATOR accounts (V1..V12) may vote.`,
          'FORBIDDEN_ROLE',
          403
        );
      }
      const authValId = resolveValidatorId(authenticatedUser.validatorId || authenticatedUser.username);
      if (!authValId) {
        throw this._buildProposalError(
          `Authenticated user '${authenticatedUser.username}' is not bound to an authorized validator identity.`,
          'UNAUTHORIZED_VALIDATOR',
          403
        );
      }
      if (voteInput.validatorId) {
        const requestedValId = resolveValidatorId(voteInput.validatorId) || String(voteInput.validatorId).trim().toUpperCase();
        if (requestedValId !== authValId) {
          throw this._buildProposalError(
            `Validator identity mismatch: logged in as ${getShortValidatorId(authValId)} (${authValId}), cannot vote as ${getShortValidatorId(requestedValId) || requestedValId} (${requestedValId}).`,
            'VALIDATOR_IDENTITY_MISMATCH',
            403
          );
        }
      }
      canonicalValidatorId = authValId;
    } else {
      const rawId = voteInput.validatorId;
      if (!rawId) {
        throw this._buildProposalError('validatorId is required.', 'MISSING_VALIDATOR_ID', 400);
      }
      canonicalValidatorId = resolveValidatorId(rawId) || String(rawId).trim().toUpperCase();
    }

    // 2. Verify validator exists in the 12-validator set
    const node = this.validators.get(canonicalValidatorId);
    if (!node) {
      throw this._buildProposalError(
        `Validator '${voteInput.validatorId || canonicalValidatorId}' is not an authorized member of the 12-validator FBA network (V1..V12).`,
        'UNAUTHORIZED_VALIDATOR',
        403
      );
    }

    // 3. Verify validator is Online
    if (!node.isOnline()) {
      throw this._buildProposalError(
        `Validator ${node.shortId} (${node.validatorId}) is currently Offline and cannot cast a consensus vote.`,
        'VALIDATOR_OFFLINE',
        409
      );
    }

    // 4. Verify proposal status & round/height freshness
    if (proposal.status === 'REJECTED') {
      throw this._buildProposalError(
        `Proposal ${proposal.proposalId} has already been REJECTED (${proposal.rejectedCount} rejections make 9-of-12 quorum impossible).`,
        'PROPOSAL_ALREADY_REJECTED',
        409
      );
    }

    const latestBlock = blockchainService.blockchain.getLatestBlock();
    if (!proposal.finalized && latestBlock && proposal.blockNumber <= latestBlock.blockNumber) {
      throw this._buildProposalError(
        `Proposal for Block #${proposal.blockNumber} is stale because ledger is already at Block #${latestBlock.blockNumber}.`,
        'STALE_PROPOSAL',
        409
      );
    }

    if (voteInput.round !== undefined && parseInt(voteInput.round, 10) !== proposal.round) {
      throw this._buildProposalError(
        `Stale or mismatched consensus round: vote specifies round ${voteInput.round}, proposal is at round ${proposal.round}.`,
        'STALE_ROUND',
        409
      );
    }

    // 5. Normalize vote decision
    const rawDecision = String(voteInput.decision || voteInput.vote || 'ACCEPT').trim().toUpperCase();
    let normalizedDecision;
    if (['ACCEPT', 'APPROVE', 'APPROVED', 'AGREE', 'YES'].includes(rawDecision)) {
      normalizedDecision = 'ACCEPT';
    } else if (['REJECT', 'REJECTED', 'DENY', 'NO'].includes(rawDecision)) {
      normalizedDecision = 'REJECT';
    } else {
      throw this._buildProposalError(
        `Invalid vote decision '${voteInput.decision}'. Must be APPROVE/ACCEPT or REJECT.`,
        'INVALID_VOTE_DECISION',
        400
      );
    }

    // 6. Check duplicate or conflicting vote on this proposal
    const existingVote = proposal.votes[canonicalValidatorId];
    if (existingVote) {
      if (existingVote.vote === normalizedDecision) {
        throw this._buildProposalError(
          `Duplicate vote rejected: Validator ${node.shortId} (${canonicalValidatorId}) has already cast an ${existingVote.vote} vote on proposal ${proposal.proposalId.slice(0, 12)}...`,
          'DUPLICATE_VOTE',
          409
        );
      } else {
        // Record equivocation attempt in VoteStore
        const conflictingVoteObj = node.signManualVote(
          proposal.candidateBlock,
          normalizedDecision,
          voteInput.reason || 'Equivocation attempt',
          { round: proposal.round, chainId: proposal.chainId }
        );
        this.voteStore.recordVote(conflictingVoteObj);
        throw this._buildProposalError(
          `Conflicting vote (equivocation) rejected: Validator ${node.shortId} (${canonicalValidatorId}) attempted to vote ${normalizedDecision} after already voting ${existingVote.vote} on proposal ${proposal.proposalId.slice(0, 12)}...`,
          'CONFLICTING_VOTE',
          409
        );
      }
    }

    // 7. Construct and cryptographically verify the ValidatorVote
    let voteObj;
    const reasonText = normalizedDecision === 'ACCEPT'
      ? ''
      : (voteInput.reason || `Rejected by ${node.shortId} (${node.validatorId})`);

    if (voteInput.signature !== undefined) {
      // Explicit signature provided (e.g. external signer or adversarial invalid signature test)
      voteObj = new ValidatorVote({
        chainId: proposal.chainId,
        validatorId: node.validatorId,
        validatorAddress: node.address,
        validatorPublicKey: node.publicKey,
        proposalId: proposal.proposalId,
        blockNumber: proposal.blockNumber,
        blockHash: proposal.blockHash,
        stateRoot: proposal.stateRoot,
        round: proposal.round,
        vote: normalizedDecision,
        reason: reasonText,
        timestamp: voteInput.timestamp || new Date().toISOString(),
        signature: voteInput.signature
      });
    } else {
      voteObj = await this.queryValidatorManualVoteHTTP(
        node,
        proposal.candidateBlock,
        normalizedDecision,
        reasonText,
        {
          round: proposal.round,
          chainId: proposal.chainId,
          useHttpInTest: voteInput.useHttpInTest
        }
      );
      if (!(voteObj instanceof ValidatorVote)) {
        voteObj = new ValidatorVote(voteObj);
      }
    }

    const sigCheck = voteObj.verifySignature();
    if (!sigCheck.valid) {
      throw this._buildProposalError(
        `Invalid cryptographic signature for validator ${node.shortId} (${node.validatorId}): ${sigCheck.reason}`,
        'INVALID_VOTE_SIGNATURE',
        400
      );
    }

    // 8. Record in VoteStore (checks cross-proposal equivocation at same height/round)
    const storeRes = this.voteStore.recordVote(voteObj);
    if (!storeRes.success && storeRes.code !== 'DUPLICATE_VOTE') {
      throw this._buildProposalError(
        `Vote rejected by VoteStore [${storeRes.code}]: ${storeRes.reason}`,
        storeRes.code || 'CONFLICTING_VOTE',
        409,
        { conflict: storeRes.conflict }
      );
    }

    const voteJson = {
      ...voteObj.toJSON(),
      shortId: node.shortId || getShortValidatorId(node.validatorId)
    };
    proposal.votes[canonicalValidatorId] = voteJson;
    proposal.voteHistory.push(voteJson);

    this.journal.append('VOTE_RECORDED', {
      proposalId: proposal.proposalId,
      roundId: proposal.roundId,
      validatorId: node.validatorId,
      shortId: node.shortId,
      vote: normalizedDecision,
      signature: voteObj.signature
    });

    // 9. Recompute vote tallies & evaluate FBA Quorum Engine (3-of-4 slices + 9-of-12 global threshold)
    const allVoteObjs = Object.values(proposal.votes).map(v => new ValidatorVote(v));
    const acceptVotes = allVoteObjs.filter(v => v.isAccept());
    const rejectVotes = allVoteObjs.filter(v => !v.isAccept());

    proposal.approvedCount = acceptVotes.length;
    proposal.rejectedCount = rejectVotes.length;
    proposal.remainingForQuorum = Math.max(0, proposal.threshold - proposal.approvedCount);

    const remainingUnvoted = proposal.totalValidators - (proposal.approvedCount + proposal.rejectedCount);
    proposal.canStillReachQuorum = (proposal.approvedCount + remainingUnvoted) >= proposal.threshold;

    const quorumResult = this.quorumEngine.evaluate(allVoteObjs, {
      threshold: proposal.threshold,
      round: proposal.round
    });

    proposal.quorumAchieved = Boolean(quorumResult.isSatisfied && proposal.approvedCount >= proposal.threshold);
    proposal.quorumSize = quorumResult.quorumSize || 0;
    proposal.quorumMembers = quorumResult.quorumMembers || [];

    // Case D: Rejections make reaching 9-of-12 impossible
    if (!proposal.finalized && !proposal.canStillReachQuorum) {
      proposal.status = 'REJECTED';
      proposal.finalized = false;
      proposal.certificate = null;

      if (this.stateMachine.canTransition(ConsensusState.REJECTED)) {
        this.stateMachine.transition(ConsensusState.REJECTED, {
          height: proposal.blockNumber,
          round: proposal.round,
          roundId: proposal.roundId,
          reason: `Proposal rejected: ${proposal.rejectedCount} rejections recorded, cannot reach ${proposal.threshold}-of-${proposal.totalValidators} threshold`
        });
      }

      this.journal.append('PROPOSAL_REJECTED', {
        proposalId: proposal.proposalId,
        roundId: proposal.roundId,
        height: proposal.blockNumber,
        approvedCount: proposal.approvedCount,
        rejectedCount: proposal.rejectedCount,
        threshold: proposal.threshold
      });
    } else if (!proposal.finalized && proposal.quorumAchieved) {
      // Case B: 9-of-12 Quorum + FBA slices achieved!
      if (proposal.autoFinalize !== false) {
        await this.finalizeProposal(proposal.proposalId);
      } else {
        const certApprovals = proposal.quorumMembers
          .map(mId => proposal.votes[mId])
          .filter(Boolean)
          .map(v => ({
            validatorId: v.validatorId,
            validatorAddress: v.validatorAddress,
            validatorPublicKey: v.validatorPublicKey,
            signature: v.signature,
            timestamp: v.timestamp,
            vote: 'ACCEPT'
          }));
        const cert = new ConsensusCertificate({
          version: 1,
          chainId: proposal.chainId,
          proposalId: proposal.proposalId,
          blockNumber: proposal.blockNumber,
          blockHash: proposal.blockHash,
          stateRoot: proposal.stateRoot,
          round: proposal.round,
          threshold: proposal.threshold,
          totalValidators: proposal.totalValidators,
          achieved: true,
          validatorApprovals: certApprovals
        });
        proposal.certificate = cert.toJSON();
      }
    } else if (proposal.finalized && normalizedDecision === 'ACCEPT' && proposal.quorumAchieved) {
      // Case C: Additional validators (V10..V12) ratifying after 9-of-12 finality was reached
      const certApprovals = proposal.quorumMembers
        .map(mId => proposal.votes[mId])
        .filter(Boolean)
        .map(v => ({
          validatorId: v.validatorId,
          validatorAddress: v.validatorAddress,
          validatorPublicKey: v.validatorPublicKey,
          signature: v.signature,
          timestamp: v.timestamp,
          vote: 'ACCEPT'
        }));

      const updatedCert = new ConsensusCertificate({
        version: 1,
        chainId: proposal.chainId,
        proposalId: proposal.proposalId,
        blockNumber: proposal.blockNumber,
        blockHash: proposal.blockHash,
        stateRoot: proposal.stateRoot,
        round: proposal.round,
        threshold: proposal.threshold,
        totalValidators: proposal.totalValidators,
        achieved: true,
        validatorApprovals: certApprovals
      });
      proposal.certificate = updatedCert.toJSON();

      // Update in-memory block certificate & SQLite Block record for the ratifying validator
      const memBlock = blockchainService.blockchain.getBlockByNumber(proposal.blockNumber);
      const updatedSigs = certApprovals.map(a => ({
        validatorId: a.validatorId,
        signature: a.signature,
        timestamp: a.timestamp
      }));
      if (memBlock && memBlock.proposalId === proposal.proposalId) {
        memBlock.consensusCertificate = updatedCert.toJSON();
        memBlock.validatorSignatures = updatedSigs;
      }
      try {
        const BlockModel = require('../models/Block');
        await BlockModel.update(
          {
            consensusCertificate: updatedCert.toJSON(),
            validatorSignatures: updatedSigs
          },
          { where: { blockNumber: proposal.blockNumber }, individualHooks: false }
        );
      } catch (_) {}

      node.blockHeight = Math.max(node.blockHeight || 0, proposal.blockNumber);
      try {
        const ValidatorModel = require('../models/Validator');
        await ValidatorModel.update(
          { blockHeight: node.blockHeight, txValidated: node.txValidated },
          { where: { validatorId: node.validatorId } }
        );
      } catch (_) {}
    }

    const roundSummary = this._syncProposalToTelemetryRound(proposal);
    this._savePersistedProposals();

    return {
      vote: voteJson,
      proposal: this.formatProposalSummary(proposal),
      round: this.formatRoundForTelemetry(roundSummary)
    };
  }

  /**
   * Explicitly evaluate finality and commit a pending proposal to the blockchain ledger.
   * Refuses with 409 QUORUM_NOT_MET if < 9 valid approvals or FBA slices are not satisfied (Case A).
   */
  async finalizeProposal(proposalId) {
    const Block = require('../blockchain/Block');
    const blockchainService = require('../services/blockchainService');

    const targetId = proposalId || this.activeProposalId;
    const proposal = targetId ? this.proposals.get(targetId) : null;
    if (!proposal) {
      throw this._buildProposalError(
        `Proposal '${targetId || 'active'}' not found.`,
        'PROPOSAL_NOT_FOUND',
        404
      );
    }

    if (proposal.finalized) {
      return {
        alreadyFinalized: true,
        proposal: this.formatProposalSummary(proposal)
      };
    }

    if (proposal.status === 'REJECTED') {
      throw this._buildProposalError(
        `Cannot finalize proposal ${proposal.proposalId}: proposal has been REJECTED (${proposal.rejectedCount} rejections).`,
        'PROPOSAL_REJECTED',
        409,
        { proposal: this.formatProposalSummary(proposal) }
      );
    }

    const allVoteObjs = Object.values(proposal.votes || {}).map(v => new ValidatorVote(v));
    const acceptVotes = allVoteObjs.filter(v => v.isAccept());

    const quorumResult = this.quorumEngine.evaluate(allVoteObjs, {
      threshold: proposal.threshold,
      round: proposal.round
    });

    if (!quorumResult.isSatisfied || acceptVotes.length < proposal.threshold) {
      throw this._buildProposalError(
        `Cannot finalize Block #${proposal.blockNumber}: only ${acceptVotes.length} of ${proposal.totalValidators} validators have approved (minimum ${proposal.threshold} required with satisfied 3-of-4 FBA quorum slices).`,
        'QUORUM_NOT_MET',
        409,
        {
          approvedCount: acceptVotes.length,
          rejectedCount: proposal.rejectedCount || 0,
          threshold: proposal.threshold,
          quorumAchieved: false,
          finalized: false,
          failureReasons: quorumResult.failureReasons,
          proposal: this.formatProposalSummary(proposal)
        }
      );
    }

    const certApprovals = quorumResult.quorumMembers
      .map(mId => proposal.votes[mId])
      .filter(Boolean)
      .map(v => ({
        validatorId: v.validatorId,
        validatorAddress: v.validatorAddress,
        validatorPublicKey: v.validatorPublicKey,
        signature: v.signature,
        timestamp: v.timestamp,
        vote: 'ACCEPT'
      }));

    const certificate = new ConsensusCertificate({
      version: 1,
      chainId: proposal.chainId,
      proposalId: proposal.proposalId,
      blockNumber: proposal.blockNumber,
      blockHash: proposal.blockHash,
      stateRoot: proposal.stateRoot,
      round: proposal.round,
      threshold: proposal.threshold,
      totalValidators: proposal.totalValidators,
      achieved: true,
      validatorApprovals: certApprovals
    });

    const rawBlock = proposal.candidateBlock;
    const candidateBlockObj = new Block(
      rawBlock.blockNumber,
      rawBlock.timestamp,
      rawBlock.transactions,
      rawBlock.previousHash,
      rawBlock.nonce,
      'FINALIZED',
      certApprovals.map(a => ({
        validatorId: a.validatorId,
        signature: a.signature,
        timestamp: a.timestamp
      })),
      rawBlock.stateRoot,
      {
        version: rawBlock.version || 1,
        proposerId: rawBlock.proposerId,
        proposerAddress: rawBlock.proposerAddress,
        proposerSignature: rawBlock.proposerSignature,
        proposalId: rawBlock.proposalId,
        round: rawBlock.round || 0,
        consensusCertificate: certificate.toJSON()
      }
    );
    candidateBlockObj.merkleRoot = rawBlock.merkleRoot;
    candidateBlockObj.blockHash = rawBlock.blockHash;

    // Verify finality via FinalityEngine before committing to ledger
    const finalityCheck = this.finalityEngine.evaluateFinality(
      candidateBlockObj,
      certificate,
      blockchainService.blockchain
    );
    if (!finalityCheck.final) {
      throw this._buildProposalError(
        `FinalityEngine rejected Block #${proposal.blockNumber} [${finalityCheck.code}]: ${finalityCheck.reason}`,
        finalityCheck.code || 'FINALITY_REJECTED',
        409,
        { finalityCheck }
      );
    }

    // State machine transitions: PREVOTE -> ACCEPTED -> CERTIFIED -> FINALIZED
    if (this.stateMachine.canTransition(ConsensusState.ACCEPTED)) {
      this.stateMachine.transition(ConsensusState.ACCEPTED, {
        height: proposal.blockNumber,
        round: proposal.round,
        roundId: proposal.roundId,
        reason: `9-of-12 FBA quorum achieved (${certApprovals.length}/${proposal.totalValidators})`
      });
    }
    if (this.stateMachine.canTransition(ConsensusState.CERTIFIED)) {
      this.stateMachine.transition(ConsensusState.CERTIFIED, {
        height: proposal.blockNumber,
        round: proposal.round,
        roundId: proposal.roundId,
        reason: `ConsensusCertificate ${certificate.certificateHash.slice(0, 12)} generated`
      });
    }

    const committedBlock = await blockchainService.addBlock(
      candidateBlockObj,
      candidateBlockObj.validatorSignatures,
      null,
      candidateBlockObj.stateRoot,
      {
        consensusCertificate: certificate.toJSON(),
        requireFinality: true
      }
    );

    if (this.stateMachine.canTransition(ConsensusState.FINALIZED)) {
      this.stateMachine.transition(ConsensusState.FINALIZED, {
        height: proposal.blockNumber,
        round: proposal.round,
        roundId: proposal.roundId,
        reason: `Block #${proposal.blockNumber} committed to immutable ledger`
      });
    }

    proposal.status = 'FINALIZED';
    proposal.finalized = true;
    proposal.finalizedAt = new Date().toISOString();
    proposal.quorumAchieved = true;
    proposal.quorumSize = quorumResult.quorumSize;
    proposal.quorumMembers = quorumResult.quorumMembers;
    proposal.certificate = certificate.toJSON();

    this.journal.append('CERTIFICATE_GENERATED', {
      roundId: proposal.roundId,
      proposalId: proposal.proposalId,
      certificateHash: certificate.certificateHash,
      approvalCount: certApprovals.length,
      threshold: proposal.threshold
    });
    this.journal.append('BLOCK_FINALIZED', {
      roundId: proposal.roundId,
      proposalId: proposal.proposalId,
      height: proposal.blockNumber,
      blockHash: proposal.blockHash,
      certificateHash: certificate.certificateHash
    });

    // Update validator heights & txValidated counts in memory and DB
    try {
      const ValidatorModel = require('../models/Validator');
      for (const mId of quorumResult.quorumMembers) {
        const vNode = this.validators.get(mId);
        if (vNode) {
          vNode.blockHeight = Math.max(vNode.blockHeight || 0, proposal.blockNumber);
          await ValidatorModel.update(
            { blockHeight: vNode.blockHeight, txValidated: vNode.txValidated },
            { where: { validatorId: mId } }
          );
        }
      }
    } catch (_) {}

    const roundSummary = this._syncProposalToTelemetryRound(proposal);
    this._savePersistedProposals();

    logger.consensus(`Finalized Proposal ${proposal.proposalId.slice(0, 14)}... -> Block #${proposal.blockNumber} (${certApprovals.length}/${proposal.totalValidators} approvals)`);

    return {
      finalized: true,
      block: committedBlock,
      certificate: certificate.toJSON(),
      proposal: this.formatProposalSummary(proposal),
      round: this.formatRoundForTelemetry(roundSummary)
    };
  }

  formatRoundForTelemetry(round) {
    if (!round) return null;
    const nodes = this.getValidators();
    const sigMap = new Map();
    if (round.validatorSignatures && Array.isArray(round.validatorSignatures)) {
      for (const s of round.validatorSignatures) {
        if (s.validatorId) sigMap.set(s.validatorId, s.signature);
      }
    }
    const voteMap = new Map();
    if (round.votes && Array.isArray(round.votes)) {
      for (const v of round.votes) {
        if (v.validatorId) voteMap.set(v.validatorId, v);
      }
    }

    const isInteractive = Boolean(round.isInteractiveProposal);

    const validatorLifecycle = nodes.map(node => {
      const vId = node.validatorId;
      const hasVoteEntry = voteMap.has(vId);
      const voteObj = voteMap.get(vId) || {};
      const rawSig = sigMap.get(vId) || voteObj.signature || null;
      const isOnline = node.isOnline() && voteObj.vote !== 'OFFLINE' && voteObj.reason !== 'Node is offline';
      const voteDecision = voteObj.vote || (isInteractive ? (isOnline ? 'PENDING' : 'OFFLINE') : (isOnline ? 'ACCEPT' : 'OFFLINE'));
      const isVerified = isOnline && (voteDecision === 'ACCEPT' || voteDecision === 'AGREE' || (voteObj.isAccept && voteObj.isAccept()));
      const isSigned = Boolean(rawSig && (isVerified || (isInteractive && hasVoteEntry)));

      // Create safe, non-sensitive signature digest
      let sigDigest = null;
      if (rawSig) {
        sigDigest = typeof rawSig === 'string' && rawSig.length > 16
          ? `${rawSig.slice(0, 10)}...${rawSig.slice(-6)}`
          : '0xPRESENT';
      }

      let status = 'COMPLETE';
      if (!isOnline) {
        status = 'OFFLINE';
      } else if (isInteractive && !hasVoteEntry) {
        status = 'PENDING';
      } else if (!isVerified) {
        status = 'REJECTED';
      }

      return {
        validatorId: vId,
        shortId: node.shortId || getShortValidatorId(vId),
        name: node.name,
        org: node.org,
        address: node.address,
        isOnline,
        hasVoted: isInteractive ? hasVoteEntry : true,
        verified: isVerified,
        signed: Boolean(isVerified && rawSig),
        signatureDigest: sigDigest,
        vote: !isOnline ? 'OFFLINE' : voteDecision,
        status,
        reason: voteObj.reason || (status === 'PENDING' ? 'Awaiting validator vote' : '')
      };
    });

    const verifiedCount = validatorLifecycle.filter(v => v.verified).length;
    const signedCount = validatorLifecycle.filter(v => v.signed).length;
    const rejectedCount = validatorLifecycle.filter(v => v.status === 'REJECTED').length;
    const pendingCount = validatorLifecycle.filter(v => v.status === 'PENDING').length;
    const threshold = round.threshold || 9;
    const isQuorum = Boolean(round.quorumAchieved || (verifiedCount >= threshold && signedCount >= threshold));
    const isFinalized = Boolean((round.status === 'ACHIEVED' || round.finalized) && isQuorum);

    let telemetryStatus = isFinalized ? 'ACHIEVED' : 'FAILED';
    if (isInteractive && !isFinalized) {
      telemetryStatus = round.status === 'REJECTED' ? 'REJECTED' : 'PENDING';
    }

    return {
      roundId: round.roundId,
      round: round.round || 0,
      proposalId: round.proposalId || '',
      blockNumber: round.blockNumber !== undefined ? round.blockNumber : null,
      blockHash: round.blockHash || '',
      merkleRoot: round.merkleRoot || '',
      stateRoot: round.stateRoot || '',
      timestamp: round.timestamp,
      latencyMs: round.latencyMs || 0,
      totalValidators: nodes.length,
      verifiedCount,
      signedCount,
      rejectedCount,
      pendingCount,
      remainingForQuorum: Math.max(0, threshold - verifiedCount),
      threshold,
      quorumAchieved: isQuorum,
      status: telemetryStatus,
      finalized: isFinalized,
      isInteractiveProposal: isInteractive,
      transactionId: round.transactionId || (round.transactions && round.transactions[0] ? (round.transactions[0].transactionId || round.transactions[0].id) : null),
      validators: validatorLifecycle,
      certificateHash: round.certificate ? round.certificate.certificateHash : null,
      certificate: round.certificate || null
    };
  }

  getLatestRound() {
    if (this.rounds.length === 0) {
      const nodes = this.getValidators();
      const onlineCount = nodes.filter(n => n.isOnline()).length;
      return {
        roundId: 'RND-GENESIS',
        round: 0,
        proposalId: '0x0000000000000000000000000000000000000000000000000000000000000000',
        blockNumber: 0,
        blockHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
        merkleRoot: '0x0000000000000000000000000000000000000000000000000000000000000000',
        stateRoot: '0x0000000000000000000000000000000000000000000000000000000000000000',
        timestamp: new Date().toISOString(),
        latencyMs: 14,
        totalValidators: nodes.length,
        verifiedCount: onlineCount,
        signedCount: onlineCount,
        rejectedCount: 0,
        pendingCount: 0,
        remainingForQuorum: Math.max(0, 9 - onlineCount),
        threshold: 9,
        quorumAchieved: onlineCount >= 9,
        status: onlineCount >= 9 ? 'ACHIEVED' : 'FAILED',
        finalized: true,
        transactionId: null,
        validators: nodes.map(node => ({
          validatorId: node.validatorId,
          shortId: node.shortId || getShortValidatorId(node.validatorId),
          name: node.name,
          org: node.org,
          address: node.address,
          isOnline: node.isOnline(),
          hasVoted: true,
          verified: node.isOnline(),
          signed: node.isOnline(),
          signatureDigest: node.isOnline() ? '0xGenesisSig' : null,
          vote: node.isOnline() ? 'ACCEPT' : 'OFFLINE',
          status: node.isOnline() ? 'COMPLETE' : 'OFFLINE',
          reason: node.isOnline() ? '' : 'Node is offline'
        })),
        certificateHash: '0xGenesisCertificate'
      };
    }
    return this.formatRoundForTelemetry(this.rounds[0]);
  }

  getRoundByTransactionId(txId) {
    if (!txId) return null;
    const cleanId = String(txId).trim().toUpperCase();
    const found = this.rounds.find(r => {
      if (r.transactionId && String(r.transactionId).toUpperCase() === cleanId) return true;
      if (r.proposalId && String(r.proposalId).toUpperCase() === cleanId) return true;
      if (r.roundId && String(r.roundId).toUpperCase() === cleanId) return true;
      if (r.transactions && Array.isArray(r.transactions)) {
        return r.transactions.some(t => String(t.transactionId || t.id).toUpperCase() === cleanId);
      }
      return false;
    });
    return found ? this.formatRoundForTelemetry(found) : null;
  }
}

// Singleton consensus coordinator
const fbaInstance = new FBAConsensus();

module.exports = fbaInstance;
