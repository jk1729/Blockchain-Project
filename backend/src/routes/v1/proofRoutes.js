/**
 * PDSChain Merkle Proof REST Routes (Phase 16 - Stage I)
 */

const express = require('express');
const router = express.Router();
const proofController = require('../../controllers/proofController');

// Proof Status & Metrics
router.get('/status', proofController.getProofStatus);

// Transaction Inclusion Proofs
router.get('/transactions/:txHash', proofController.getTransactionProof);
router.get('/blocks/:height/transactions/:index', proofController.getBlockTransactionProofByIndex);
router.get('/blocks/:identifier/tree', proofController.getBlockTree);

// Receipt & Event Inclusion Proofs
router.get('/receipts/:txHash', proofController.getReceiptProof);
router.get('/events/:eventId', proofController.getEventProof);

// Standalone Verification Endpoint
router.post('/verify', proofController.verifyProof);

module.exports = router;

