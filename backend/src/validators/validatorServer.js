const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const ValidatorNode = require('../consensus/ValidatorNode');
const ValidatorVote = require('../consensus/ValidatorVote');
const VoteStore = require('../consensus/VoteStore');
const { resolveValidatorId, getShortValidatorId } = require('../consensus/consensusConfig');
const { getOrCreateDevParticipant, registerCustomParticipant } = require('../blockchain/identity/keyManager');
const { hashProposal, hashBlockHeader } = require('../blockchain/hashing');
const { calculateMerkleRoot } = require('../blockchain/merkle');

function resolveValidatorDataDir(validatorId) {
  const parentDb = path.resolve(process.cwd(), '..', 'database');
  const baseDir = fs.existsSync(parentDb) ? parentDb : path.resolve(process.cwd(), 'database');
  const dir = path.join(baseDir, 'validators', validatorId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function createValidatorApp(validatorConfig) {
  const app = express();
  app.use(cors());
  app.use(express.json());

  const validatorId = resolveValidatorId(validatorConfig.validatorId || 'VAL-01');
  const shortId = validatorConfig.shortId || getShortValidatorId(validatorId);
  const dataDir = validatorConfig.dataDir || resolveValidatorDataDir(validatorId);
  const identityFile = path.join(dataDir, 'identity.json');
  const stateFile = path.join(dataDir, 'consensus_state.json');

  // Load isolated identity from disk if provisioned, otherwise provision deterministic dev identity
  let participant;
  if (fs.existsSync(identityFile)) {
    try {
      const loaded = JSON.parse(fs.readFileSync(identityFile, 'utf8'));
      if (loaded && loaded.publicKey && loaded.privateKey) {
        participant = registerCustomParticipant({
          entityId: validatorId,
          entityType: 'VALIDATOR',
          address: loaded.address,
          publicKey: loaded.publicKey,
          privateKey: loaded.privateKey
        });
      }
    } catch (e) {
      // Fallback to getOrCreateDevParticipant
    }
  }
  if (!participant) {
    participant = getOrCreateDevParticipant(validatorId, 'VALIDATOR');
  }

  const node = new ValidatorNode({
    ...validatorConfig,
    validatorId,
    shortId,
    publicKey: participant.publicKey,
    address: participant.address
  });

  const voteStore = new VoteStore();
  let lastHeartbeat = new Date().toISOString();

  // Recover persisted state & vote history if present
  if (fs.existsSync(stateFile)) {
    try {
      const saved = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      if (saved.status && ['Online', 'Offline', 'Degraded'].includes(saved.status)) {
        node.setStatus(saved.status);
      }
      if (typeof saved.blockHeight === 'number') node.blockHeight = saved.blockHeight;
      if (typeof saved.txValidated === 'number') node.txValidated = saved.txValidated;
      if (Array.isArray(saved.votes)) {
        for (const v of saved.votes) {
          try {
            const voteObj = new ValidatorVote(v);
            voteStore.recordVote(voteObj);
            node.statementHistory.push(voteObj.toJSON());
          } catch (e) {}
        }
      }
    } catch (e) {}
  }

  function persistState() {
    try {
      const payload = {
        validatorId,
        shortId,
        pid: process.pid,
        status: node.status,
        blockHeight: node.blockHeight,
        txValidated: node.txValidated,
        lastHeartbeat,
        updatedAt: new Date().toISOString(),
        votes: node.statementHistory.slice(-200)
      };
      const tmpFile = `${stateFile}.tmp.${process.pid}`;
      fs.writeFileSync(tmpFile, JSON.stringify(payload, null, 2), 'utf8');
      try {
        fs.renameSync(tmpFile, stateFile);
      } catch (renameErr) {
        fs.copyFileSync(tmpFile, stateFile);
        try { fs.unlinkSync(tmpFile); } catch (_) {}
      }
    } catch (e) {}
  }

  // Health & Liveness Checks
  app.get('/health', (req, res) => {
    lastHeartbeat = new Date().toISOString();
    node.lastHeartbeat = lastHeartbeat;
    res.json({
      status: 'OK',
      validatorId: node.validatorId,
      shortId: node.shortId,
      nodeStatus: node.status,
      isConsensusReady: node.isOnline(),
      port: node.port,
      p2pPort: node.p2pPort,
      pid: process.pid,
      lastHeartbeat,
      uptime: process.uptime()
    });
  });

  app.get('/health/live', (req, res) => {
    lastHeartbeat = new Date().toISOString();
    res.status(200).json({
      status: 'LIVE',
      validatorId: node.validatorId,
      shortId: node.shortId,
      pid: process.pid,
      uptime: process.uptime()
    });
  });

  app.get('/health/ready', (req, res) => {
    lastHeartbeat = new Date().toISOString();
    res.status(200).json({
      status: 'READY',
      validatorId: node.validatorId,
      shortId: node.shortId,
      pid: process.pid,
      isConsensusReady: node.isOnline()
    });
  });

  // Node Status & Quorum Slice
  app.get('/status', (req, res) => {
    lastHeartbeat = new Date().toISOString();
    node.lastHeartbeat = lastHeartbeat;
    res.json({
      validatorId: node.validatorId,
      shortId: node.shortId,
      pid: process.pid,
      name: node.name,
      org: node.org,
      publicKey: node.publicKey,
      address: node.address,
      status: node.status,
      authorized: true,
      port: node.port,
      p2pPort: node.p2pPort,
      blockHeight: node.blockHeight,
      txValidated: node.txValidated,
      participation: node.participation,
      lastHeartbeat,
      voteHistoryCount: node.statementHistory.length,
      trustConfiguration: node.quorumSlice.toJSON()
    });
  });

  // Toggle Node Status (for failure & recovery simulation)
  app.post('/status', (req, res) => {
    const { status } = req.body || {};
    if (node.setStatus(status)) {
      lastHeartbeat = new Date().toISOString();
      persistState();
      return res.json({
        success: true,
        validatorId: node.validatorId,
        shortId: node.shortId,
        pid: process.pid,
        status: node.status
      });
    }
    res.status(400).json({ success: false, message: 'Invalid status. Must be Online, Offline, or Degraded.' });
  });

  // Evaluate Candidate Block Proposal or Transaction Proposal with Ed25519 signing
  app.post('/proposal', async (req, res) => {
    try {
      const body = req.body || {};
      const proposal = body.proposal || body;
      const options = body.options || {};
      lastHeartbeat = new Date().toISOString();
      node.lastHeartbeat = lastHeartbeat;

      // Candidate Block Proposal path
      if (proposal && (proposal.blockNumber !== undefined || proposal.index !== undefined || Array.isArray(proposal.transactions) || proposal.merkleRoot !== undefined)) {
        const voteObj = await node.evaluateBlockProposal(proposal, options);
        voteStore.recordVote(voteObj);
        if (proposal.blockNumber !== undefined && voteObj.isAccept()) {
          node.blockHeight = Math.max(node.blockHeight || 0, parseInt(proposal.blockNumber, 10) || 0);
        }
        persistState();
        return res.json(voteObj.toJSON());
      }

      // Legacy Transaction Proposal path
      const txVote = node.evaluateProposal(proposal);
      persistState();
      return res.json(txVote);
    } catch (err) {
      return res.status(500).json({
        validatorId: node.validatorId,
        vote: 'REJECT',
        reason: err.message || 'Internal validator proposal evaluation error',
        signature: null
      });
    }
  });

  // Explicit Authenticated Validator Vote Signing Endpoint (for interactive 12-validator voting)
  app.post('/vote-proposal', async (req, res) => {
    try {
      const { proposal, decision = 'ACCEPT', reason = '', round = 0, chainId = 1729 } = req.body || {};
      lastHeartbeat = new Date().toISOString();
      node.lastHeartbeat = lastHeartbeat;

      if (!node.isOnline()) {
        return res.status(409).json({
          success: false,
          code: 'VALIDATOR_OFFLINE',
          message: `Validator ${node.validatorId} (${node.shortId}) is currently ${node.status} and cannot sign votes.`
        });
      }

      if (!proposal) {
        return res.status(400).json({
          success: false,
          code: 'MISSING_PROPOSAL',
          message: 'Proposal payload is required for voting.'
        });
      }

      const normalizedDecision = String(decision).toUpperCase() === 'REJECT' ? 'REJECT' : 'ACCEPT';

      // If validator is voting ACCEPT, run full structural & cryptographic block verification first!
      if (normalizedDecision === 'ACCEPT') {
        const evaluated = await node.evaluateBlockProposal(proposal, { round, chainId });
        if (!evaluated.isAccept()) {
          return res.status(422).json({
            success: false,
            code: 'INVALID_PROPOSAL_BLOCK',
            message: `Validator ${node.validatorId} refused to sign invalid block proposal: ${evaluated.reason}`,
            vote: evaluated.toJSON()
          });
        }
        voteStore.recordVote(evaluated);
        persistState();
        return res.status(200).json({
          success: true,
          validatorId: node.validatorId,
          shortId: node.shortId,
          pid: process.pid,
          vote: evaluated.toJSON()
        });
      }

      // Explicit REJECT vote signed by this validator's private key
      const blockNumber = parseInt(proposal.blockNumber !== undefined ? proposal.blockNumber : proposal.index, 10) || 0;
      const proposalId = proposal.proposalId || hashProposal(proposal);
      const stateRoot = String(proposal.stateRoot || '');
      const rawBlockHash = proposal.blockHash || proposal.hash;
      const blockHash = rawBlockHash
        ? String(rawBlockHash)
        : hashBlockHeader({
            version: parseInt(proposal.version !== undefined ? proposal.version : 1, 10),
            blockNumber,
            previousHash: String(proposal.previousHash || ''),
            timestamp: String(proposal.timestamp || ''),
            merkleRoot: String(proposal.merkleRoot || calculateMerkleRoot(Array.isArray(proposal.transactions) ? proposal.transactions : [])),
            stateRoot,
            proposerId: String(proposal.proposerId || 'VAL-01'),
            nonce: parseInt(proposal.blockNonce !== undefined ? proposal.blockNonce : (proposal.nonce || 0), 10) || 0,
            consensusStatus: String(proposal.consensusStatus || 'FINALIZED')
          });

      const rejectVote = new ValidatorVote({
        chainId,
        validatorId: node.validatorId,
        validatorAddress: node.address,
        validatorPublicKey: node.publicKey,
        proposalId,
        blockNumber,
        blockHash,
        stateRoot,
        round: parseInt(round, 10) || 0,
        vote: 'REJECT',
        reason: reason || `Rejected by ${node.shortId} (${node.validatorId})`,
        timestamp: new Date().toISOString()
      });
      const privKey = node.getPrivateKey();
      if (privKey) {
        rejectVote.sign(privKey);
      }
      voteStore.recordVote(rejectVote);
      node.statementHistory.push(rejectVote.toJSON());
      persistState();

      return res.status(200).json({
        success: true,
        validatorId: node.validatorId,
        shortId: node.shortId,
        pid: process.pid,
        vote: rejectVote.toJSON()
      });
    } catch (err) {
      return res.status(500).json({
        success: false,
        message: err.message
      });
    }
  });

  // Peer Vote Propagation & Quorum Slice Check
  app.post('/vote', (req, res) => {
    const { peerVotes } = req.body || {};
    const agreeingList = (peerVotes || [])
      .filter(v => v.vote === 'AGREE' || v.vote === 'ACCEPT')
      .map(v => resolveValidatorId(v.validatorId));
    const sliceSatisfied = node.quorumSlice.isSatisfied(agreeingList);

    res.json({
      validatorId: node.validatorId,
      shortId: node.shortId,
      sliceSatisfied,
      threshold: node.quorumSlice.threshold,
      peerAgreementsCount: agreeingList.length
    });
  });

  // Recorded Votes History
  app.get('/votes', (req, res) => {
    res.json({
      success: true,
      validatorId: node.validatorId,
      shortId: node.shortId,
      count: node.statementHistory.length,
      votes: node.statementHistory.slice(-100)
    });
  });

  // Chain state synchronization
  app.get('/chain', (req, res) => {
    res.json({
      validatorId: node.validatorId,
      shortId: node.shortId,
      blockHeight: node.blockHeight,
      lastSync: new Date().toISOString()
    });
  });

  return { app, state: node, node, voteStore, persistState };
}

module.exports = {
  createValidatorApp
};
