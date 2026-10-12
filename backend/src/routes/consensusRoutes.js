const express = require('express');
const router = express.Router();
const consensusController = require('../controllers/consensusController');
const { authMiddleware, optionalAuthMiddleware } = require('../middleware/authMiddleware');
const roleMiddleware = require('../middleware/roleMiddleware');

router.get('/status', optionalAuthMiddleware, consensusController.getStatus);
router.get('/quorum', optionalAuthMiddleware, consensusController.getQuorum);
router.get('/state', optionalAuthMiddleware, consensusController.getState);
router.get('/conflicts', optionalAuthMiddleware, consensusController.getConflicts);
router.get('/votes/height/:height', optionalAuthMiddleware, consensusController.getVotesByHeight);
router.get('/journal', optionalAuthMiddleware, consensusController.getJournal);
router.get('/rounds/latest', optionalAuthMiddleware, consensusController.getLatestRound);
router.get('/rounds/tx/:txId', optionalAuthMiddleware, consensusController.getRoundByTransaction);

// Interactive 12-validator proposal & step-by-step voting endpoints
router.get('/proposals', optionalAuthMiddleware, consensusController.getProposals);
router.get('/proposals/active', optionalAuthMiddleware, consensusController.getActiveProposal);
router.get('/proposals/:id', optionalAuthMiddleware, consensusController.getProposalById);
router.post('/proposals', authMiddleware, roleMiddleware('VALIDATOR', 'ADMIN', 'SHOP', 'WAREHOUSE'), consensusController.createProposal);
router.post('/proposals/:id/vote', authMiddleware, consensusController.voteOnProposal);
router.post('/vote', authMiddleware, consensusController.voteOnProposal);
router.post('/proposals/:id/finalize', authMiddleware, roleMiddleware('VALIDATOR', 'ADMIN'), consensusController.finalizeProposal);
router.post('/finalize', authMiddleware, roleMiddleware('VALIDATOR', 'ADMIN'), consensusController.finalizeProposal);

// Full automated round proposal
router.post('/propose', authMiddleware, roleMiddleware('SHOP', 'ADMIN', 'VALIDATOR'), consensusController.propose);

module.exports = router;

