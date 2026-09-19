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
router.post('/propose', authMiddleware, roleMiddleware('SHOP', 'ADMIN', 'VALIDATOR'), consensusController.propose);

module.exports = router;
