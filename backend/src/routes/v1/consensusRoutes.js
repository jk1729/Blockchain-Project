/**
 * PDSChain v1 Consensus Routes (Phase 14)
 */

const express = require('express');
const router = express.Router();
const consensusService = require('../../services/consensusService');
const { authMiddleware, optionalAuthMiddleware } = require('../../middleware/authMiddleware');
const roleMiddleware = require('../../middleware/roleMiddleware');
const { sendSuccess } = require('../../api/ResponseEnvelope');

// GET /api/v1/consensus/status
router.get('/status', optionalAuthMiddleware, (req, res) => {
  const status = consensusService.getStatus();
  return sendSuccess(res, status);
});

// GET /api/v1/consensus/quorum
router.get('/quorum', optionalAuthMiddleware, (req, res) => {
  const quorum = consensusService.getQuorumDetails();
  return sendSuccess(res, quorum);
});

// GET /api/v1/consensus/state
router.get('/state', optionalAuthMiddleware, (req, res) => {
  const state = {
    currentState: consensusService.getStateMachineState(),
    history: consensusService.getStateMachineHistory()
  };
  return sendSuccess(res, state);
});

// GET /api/v1/consensus/conflicts
router.get('/conflicts', optionalAuthMiddleware, (req, res) => {
  const conflicts = consensusService.getConflicts();
  return sendSuccess(res, conflicts);
});

// GET /api/v1/consensus/votes/height/:height
router.get('/votes/height/:height', optionalAuthMiddleware, (req, res) => {
  const height = parseInt(req.params.height, 10);
  const votes = consensusService.getVotesByHeight(height);
  return sendSuccess(res, {
    height,
    voteCount: votes.length,
    votes
  });
});

// POST /api/v1/consensus/propose
router.post('/propose',
  authMiddleware,
  roleMiddleware('SHOP', 'ADMIN', 'VALIDATOR'),
  async (req, res, next) => {
    try {
      const result = await consensusService.runConsensus(req.body);
      return sendSuccess(res, result, {}, 201);
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;

