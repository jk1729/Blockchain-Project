const express = require('express');
const router = express.Router();
const blockchainController = require('../controllers/blockchainController');

router.get('/', blockchainController.getBlockchain);
router.get('/blocks', blockchainController.getBlocks);
router.get('/blocks/:number', blockchainController.getBlockByNumber);
router.get('/blocks/:number/consensus', blockchainController.getBlockConsensus);
router.get('/transactions/:transactionId', blockchainController.getTransactionById);
router.get('/validate', blockchainController.validate);

// Phase 2 Cryptographic Identity & Signature Verification routes
router.get('/identity/:idOrAddress', blockchainController.getIdentity);
router.post('/transactions/verify', blockchainController.verifyTransaction);

// Phase 3 Transaction Mempool routes
router.get('/mempool', blockchainController.getMempool);
router.get('/mempool/stats', blockchainController.getMempoolStats);
router.get('/mempool/:transactionId', blockchainController.getMempoolTransaction);

// Phase 5 Deterministic State Root routes
router.get('/state/root', blockchainController.getStateRoot);
router.get('/state/snapshot', blockchainController.getConsensusState);

// Phase 6 Consensus Certificate Verification route
router.post('/consensus/verify', blockchainController.verifyConsensusCertificate);

module.exports = router;
