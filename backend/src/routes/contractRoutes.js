const express = require('express');
const router = express.Router();
const contractController = require('../controllers/contractController');
const { optionalAuthMiddleware, authMiddleware } = require('../middleware/authMiddleware');

// Public contract registry queries
router.get('/', contractController.getContracts);
router.get('/:address', contractController.getContractDetails);
router.get('/:address/events', contractController.getContractEvents);
router.get('/transactions/:id/receipt', contractController.getTransactionReceipt);

// Smart contract invocation (view calls allow optional auth; state-changing calls check auth or signed payload)
router.post('/call', optionalAuthMiddleware, contractController.callContract);

module.exports = router;
