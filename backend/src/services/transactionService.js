const TransactionModel = require('../models/Transaction');
const BlockModel = require('../models/Block');
const { sequelize } = require('../config/database');
const executionEngine = require('../execution/ExecutionEngine');
const stateManager = require('../execution/StateManager');
const consensusService = require('./consensusService');
const blockchainService = require('./blockchainService');
const Transaction = require('../blockchain/Transaction');
const { getOrCreateDevParticipant, getParticipantPrivateKey } = require('../blockchain/identity/keyManager');
const { validateTransactionPayload } = require('../validators/schemas');
const { mempool, MempoolError } = require('../blockchain/mempool');
const { calculateMerkleRoot } = require('../blockchain/merkle');
const { calculateStateRoot } = require('../blockchain/state');
const { hashProposal } = require('../blockchain/hashing');
const { signBlockProposal } = require('../blockchain/identity/signature');
const { ConflictError, ValidationError, NotFoundError } = require('../utils/errors');
const logger = require('../utils/logger');
const crypto = require('crypto');
const { evmRuntime, resolveEVMCaller } = require('../evm');

class TransactionService {
  async getAllTransactions(limit = 100) {
    return await TransactionModel.findAll({
      order: [['createdAt', 'DESC']],
      limit: parseInt(limit, 10) || 100
    });
  }

  async getTransactionById(transactionId) {
    const { Op } = require('sequelize');
    let tx = await TransactionModel.findOne({
      where: {
        [Op.or]: [
          { transactionId },
          { hash: transactionId }
        ]
      }
    });
    if (!tx) {
      const memoryTx = blockchainService.getTransactionById(transactionId);
      if (memoryTx) {
        return memoryTx.transaction;
      }
      throw new NotFoundError(`Transaction '${transactionId}' not found.`);
    }
    return tx;
  }

  async getTransactionsByBeneficiary(beneficiaryId) {
    return await TransactionModel.findAll({
      where: { beneficiaryId },
      order: [['createdAt', 'DESC']]
    });
  }

  async getTransactionsByShop(shopId) {
    return await TransactionModel.findAll({
      where: { shopId },
      order: [['createdAt', 'DESC']]
    });
  }

  /**
   * Process a complete PDS Grain Distribution Transaction through:
   * 1. Beneficiary Pre-check & Identity Resolution
   * 2. Cryptographic Digital Signing (Ed25519)
   * 3. Pre-validation via ExecutionEngine (Simulation)
   * 4. Candidate Block Proposal Construction & Proposer Signing
   * 5. 12-Validator Federated Byzantine Agreement (FBA) Consensus with Signed Votes
   * 6. Consensus Certificate Generation
   * 7. Atomic Execution & State Transition via ExecutionEngine
   * 8. Blockchain Block Commit with Dual Commitments & Certificate
   */
  async processDistribution(payload, user = null) {
    const validData = validateTransactionPayload(payload);
    const { beneficiaryId, shopId, commodity, quantity } = validData;

    // 1. Check duplicate transactions within last 5 seconds (Debounce protection)
    const recentDuplicate = await TransactionModel.findOne({
      where: {
        beneficiaryId,
        commodity,
        quantity,
        status: 'Verified'
      },
      order: [['createdAt', 'DESC']]
    });

    if (recentDuplicate) {
      const diffMs = Date.now() - new Date(recentDuplicate.createdAt).getTime();
      if (diffMs < 5000) {
        throw new ConflictError('Duplicate transaction detected. Please wait before submitting another identical request.');
      }
    }

    const timestamp = payload.timestamp || new Date().toISOString();

    // 2. Fetch official beneficiary name for accurate immutable payload
    const ben = await stateManager.getBeneficiaryState(beneficiaryId);
    const finalCitizenName = validData.name || ben.name || 'Citizen';

    // 3. Resolve Cryptographic Identity & Nonce
    let tx;
    if (payload.signature && payload.transactionId) {
      // Pre-signed transaction submission
      tx = Transaction.fromJSON(payload);
    } else {
      // Resolve sender identity (Shop actor initiating distribution)
      const senderEntityId = (user && user.entityId) || shopId || 'FPS-102';
      const senderParticipant = getOrCreateDevParticipant(senderEntityId, 'SHOP');
      const expectedNonce = stateManager.getExpectedNonce(senderParticipant.address);

      tx = new Transaction({
        type: 'DISTRIBUTION',
        sender: senderParticipant.address,
        senderPublicKey: senderParticipant.publicKey,
        beneficiaryId,
        receiver: shopId,
        payload: {
          beneficiaryId,
          shopId,
          commodity,
          quantity,
          unit: 'KG',
          name: finalCitizenName,
          senderPublicKey: senderParticipant.publicKey
        },
        timestamp,
        nonce: expectedNonce
      });

      // Digitally sign transaction using sender's Ed25519 private key
      tx.sign(senderParticipant.privateKey, senderParticipant.publicKey);
    }

    // 4. Pre-validate state transitions, digital signature, and business rules via ExecutionEngine
    await executionEngine.validateTransaction(tx);

    // 5. Stage Transaction in Mempool (Admission Pipeline)
    try {
      mempool.addTransaction(tx);
    } catch (mempoolErr) {
      if (mempoolErr instanceof MempoolError) {
        if (mempoolErr.code === 'DUPLICATE_TRANSACTION' || mempoolErr.code === 'CONFLICTING_NONCE') {
          throw new ConflictError(mempoolErr.message);
        }
        throw new ValidationError(`Mempool admission rejected: ${mempoolErr.message}`);
      }
      throw mempoolErr;
    }

    // 6. Construct Candidate Block Proposal for 12-Validator FBA Network
    const latestBlock = blockchainService.blockchain.getLatestBlock();
    const nextBlockNumber = latestBlock ? (latestBlock.blockNumber + 1) : 1;
    const previousHash = latestBlock ? latestBlock.blockHash : '0000000000000000000000000000000000000000000000000000000000000000';
    const txPayload = tx.toBlockPayload();
    const merkleRoot = calculateMerkleRoot([txPayload]);

    // Simulate state transition to predict resulting state root for proposal verification
    const currentConsensusState = await stateManager.getConsensusStateSnapshot();
    const predictedState = JSON.parse(JSON.stringify(currentConsensusState));
    // Apply predicted modifications in-memory
    const pBen = predictedState.beneficiaries.find(b => b.id === beneficiaryId);
    if (pBen) {
      pBen.currentMonthClaimed[commodity] = (pBen.currentMonthClaimed[commodity] || 0) + quantity;
    }
    const pShopInv = predictedState.shopInventory.find(i => i.shopId === shopId && i.commodity === commodity);
    if (pShopInv) {
      pShopInv.quantity -= quantity;
    }
    const predictedStateRoot = calculateStateRoot(predictedState);

    // Proposer Identity & Signature
    const proposerId = 'VAL-01';
    const proposerParticipant = getOrCreateDevParticipant(proposerId, 'VALIDATOR');
    const proposerAddress = proposerParticipant.address;
    const round = 0;

    const proposalHeader = {
      version: 1,
      blockNumber: nextBlockNumber,
      previousHash,
      timestamp,
      merkleRoot,
      stateRoot: predictedStateRoot,
      proposerId,
      proposerAddress,
      round
    };

    const proposalId = hashProposal(proposalHeader);
    const proposerPrivKey = getParticipantPrivateKey(proposerId);
    const proposerSignature = proposerPrivKey ? signBlockProposal(proposalHeader, proposerPrivKey) : null;

    const candidateProposal = {
      ...proposalHeader,
      proposalId,
      proposerSignature,
      proposerPublicKey: proposerParticipant.publicKey,
      transactions: [txPayload],
      transactionId: tx.transactionId,
      beneficiaryId,
      beneficiaryName: finalCitizenName,
      shopId,
      commodity,
      quantity,
      nonce: tx.nonce,
      signature: tx.signature,
      senderPublicKey: tx.senderPublicKey,
      sender: tx.sender,
      receiver: tx.receiver,
      payload: tx.payload
    };

    logger.info(`Initiating FBA Block Consensus for Block #${nextBlockNumber} Proposal ${proposalId} (Tx: ${tx.transactionId})...`);

    // 7. Run FBA Consensus Round across 12 Validators (Independently verifies structure, signatures, stateRoot)
    const consensusResult = await consensusService.runBlockConsensus(candidateProposal, {
      round,
      expectedStateRoot: predictedStateRoot,
      threshold: 9
    });

    if (consensusResult.status !== 'ACHIEVED') {
      // Consensus Failed: Remove from mempool and record rejected transaction without mutating state
      mempool.removeIncludedTransactions([tx.transactionId]);

      const rejectedTx = await TransactionModel.create({
        transactionId: tx.transactionId,
        beneficiaryId,
        beneficiaryName: finalCitizenName,
        shopId,
        commodity,
        quantity,
        timestamp: tx.timestamp,
        status: 'Rejected',
        fbaValidators: consensusResult.participatingValidators,
        fbaConsensus: false,
        remarks: 'Failed FBA validator quorum agreement'
      });

      return {
        success: false,
        message: 'Transaction rejected by validator quorum consensus.',
        transaction: rejectedTx,
        consensus: consensusResult
      };
    }

    // 8. Consensus Achieved: Atomically Commit to Blockchain & Execute State Transitions
    return await sequelize.transaction(async (t) => {
      // Attach consensus details to transaction payload
      tx.payload.consensusRound = consensusResult.roundId;
      tx.payload.validators = consensusResult.participatingValidators;

      // Execute State Transitions deterministically via ExecutionEngine
      const executionResult = await executionEngine.executeTransaction(tx, {
        dbTransaction: t,
        consensusRound: consensusResult.roundId
      });

      // Extract resulting consensus state snapshot and calculate deterministic State Root
      const resultingState = await stateManager.getConsensusStateSnapshot({ dbTransaction: t });
      stateManager.assertStateConsistency(resultingState);
      const stateRoot = calculateStateRoot(resultingState);

      // Add to Blockchain ledger with computed State Root, Proposer, and Consensus Certificate
      const newBlock = await blockchainService.addBlock(
        [tx.toBlockPayload()],
        consensusResult.validatorSignatures,
        t,
        stateRoot,
        {
          version: 1,
          proposerId,
          proposerAddress,
          proposerSignature,
          proposalId,
          round,
          consensusCertificate: consensusResult.certificate,
          consensusStatus: 'FINALIZED'
        }
      );

      // Compute Cryptographic Transaction Hash anchored to block
      const txHash = '0x' + crypto.createHash('sha256')
        .update(JSON.stringify(tx.toBlockPayload()) + newBlock.blockHash)
        .digest('hex')
        .substring(0, 16);

      // Remove mined transaction from active mempool
      mempool.removeIncludedTransactions([tx.transactionId], newBlock.blockNumber);

      // Persist Verified Transaction Record within database
      const verifiedTx = await TransactionModel.create({
        transactionId: tx.transactionId,
        beneficiaryId,
        beneficiaryName: finalCitizenName,
        shopId,
        commodity,
        quantity,
        timestamp: tx.timestamp,
        status: 'Verified',
        blockNumber: newBlock.blockNumber,
        blockHash: newBlock.blockHash,
        hash: txHash,
        fbaValidators: consensusResult.participatingValidators,
        fbaConsensus: true,
        remarks: 'Verified via 12-Validator FBA Quorum Consensus'
      }, { transaction: t });

      logger.info(`Transaction ${tx.transactionId} FINALIZED & SEALED on Block #${newBlock.blockNumber} with Certificate: ${consensusResult.certificate ? consensusResult.certificate.certificateHash : 'N/A'}`);

      return {
        success: true,
        message: 'Transaction successfully verified through FBA consensus, certificate finalized, and anchored to blockchain ledger.',
        transaction: {
          ...verifiedTx.toJSON(),
          id: verifiedTx.transactionId,
          block: `#${newBlock.blockNumber}`,
          qty: `${quantity} KG`,
          time: verifiedTx.timestamp
        },
        block: newBlock,
        consensus: {
          status: consensusResult.status,
          roundId: consensusResult.roundId,
          round: consensusResult.round,
          proposalId: consensusResult.proposalId,
          participatingValidators: consensusResult.participatingValidators,
          quorumAchieved: consensusResult.quorumAchieved,
          quorumSize: consensusResult.quorumSize,
          threshold: consensusResult.threshold,
          certificate: consensusResult.certificate,
          latencyMs: consensusResult.latencyMs
        },
        receipt: executionResult.receipt
      };
    });
  }

  /**
   * Process a CONTRACT_CALL Transaction invoking a Solidity smart contract:
   * 1. Pre-validation & Cryptographic Digital Signing (Ed25519)
   * 2. Mempool Staging
   * 3. Candidate Block Proposal with EVM simulation & predicted stateRoot
   * 4. 12-Validator Federated Byzantine Agreement (FBA) Consensus with independent EVM execution verification
   * 5. Consensus Certificate Generation
   * 6. Atomic Ledger Commitment & EVM State Mutation
   * 7. Execution Receipt Generation
   */
  async processContractCall(payload, user = null) {
    if (!payload || !payload.contractAddress) {
      throw new ValidationError('contractAddress is required for CONTRACT_CALL.');
    }
    if (!payload.method && !payload.calldata) {
      throw new ValidationError('method or calldata is required for CONTRACT_CALL.');
    }

    await evmRuntime.initialize();

    const timestamp = payload.timestamp || new Date().toISOString();

    // 1. Resolve Identity and Sign
    let tx;
    if (payload.signature && payload.transactionId) {
      tx = Transaction.fromJSON({ ...payload, type: 'CONTRACT_CALL' });
    } else {
      const senderRole = (user && user.role) || payload.senderRole || (payload.sender && payload.sender.toUpperCase() === 'ADMIN' ? 'ADMIN' : 'SHOP');
      const senderEntityId = (user && user.entityId) || (user && user.username) || payload.senderId || payload.sender || senderRole;
      const senderParticipant = getOrCreateDevParticipant(senderEntityId, senderRole);
      const expectedNonce = stateManager.getExpectedNonce(senderParticipant.address);

      tx = new Transaction({
        type: 'CONTRACT_CALL',
        sender: senderParticipant.address,
        senderPublicKey: senderParticipant.publicKey,
        receiver: payload.contractAddress,
        payload: {
          contractAddress: payload.contractAddress,
          method: payload.method,
          args: payload.args || [],
          calldata: payload.calldata || null,
          gasLimit: payload.gasLimit || 500000,
          senderId: senderEntityId,
          senderRole: senderRole,
          senderPublicKey: senderParticipant.publicKey
        },
        timestamp,
        nonce: expectedNonce
      });

      tx.sign(senderParticipant.privateKey, senderParticipant.publicKey);
    }

    // 2. Pre-validate via ExecutionEngine
    await executionEngine.validateTransaction(tx);

    // 3. Stage in Mempool
    try {
      mempool.addTransaction(tx);
    } catch (mempoolErr) {
      if (mempoolErr instanceof MempoolError) {
        if (mempoolErr.code === 'DUPLICATE_TRANSACTION' || mempoolErr.code === 'CONFLICTING_NONCE') {
          throw new ConflictError(mempoolErr.message);
        }
        throw new ValidationError(`Mempool admission rejected: ${mempoolErr.message}`);
      }
      throw mempoolErr;
    }

    // 4. Candidate Block Simulation
    const latestBlock = blockchainService.blockchain.getLatestBlock();
    const nextBlockNumber = latestBlock ? (latestBlock.blockNumber + 1) : 1;
    const previousHash = latestBlock ? latestBlock.blockHash : '0000000000000000000000000000000000000000000000000000000000000000';
    const txPayload = tx.toBlockPayload();
    const merkleRoot = calculateMerkleRoot([txPayload]);

    // Isolated EVM Simulation to predict state root and generate receipt
    await evmRuntime.stateAdapter.checkpoint();
    let simReceipt;
    let predictedEvmRoot;
    try {
      simReceipt = await evmRuntime.executeContractCall({
        transactionId: tx.transactionId,
        caller: resolveEVMCaller(tx),
        contractAddress: tx.payload.contractAddress,
        method: tx.payload.method,
        args: tx.payload.args || [],
        calldata: tx.payload.calldata,
        gasLimit: tx.payload.gasLimit || 500000,
        blockNumber: nextBlockNumber,
        timestamp
      });
      predictedEvmRoot = await evmRuntime.getStateRoot();
    } finally {
      await evmRuntime.stateAdapter.revert();
    }

    const currentConsensusState = await stateManager.getConsensusStateSnapshot();
    const predictedState = JSON.parse(JSON.stringify(currentConsensusState));
    predictedState.evmStateRoot = predictedEvmRoot;
    const predictedStateRoot = calculateStateRoot(predictedState);

    const receiptsRoot = calculateMerkleRoot([{ receiptHash: simReceipt.receiptHash }]);

    // Proposer Identity & Signature
    const proposerId = 'VAL-01';
    const proposerParticipant = getOrCreateDevParticipant(proposerId, 'VALIDATOR');
    const proposerAddress = proposerParticipant.address;
    const round = 0;

    const proposalHeader = {
      version: 1,
      blockNumber: nextBlockNumber,
      previousHash,
      timestamp,
      merkleRoot,
      stateRoot: predictedStateRoot,
      receiptsRoot,
      proposerId,
      proposerAddress,
      round
    };

    const proposalId = hashProposal(proposalHeader);
    const proposerPrivKey = getParticipantPrivateKey(proposerId);
    const proposerSignature = proposerPrivKey ? signBlockProposal(proposalHeader, proposerPrivKey) : null;

    const candidateProposal = {
      ...proposalHeader,
      proposalId,
      proposerSignature,
      proposerPublicKey: proposerParticipant.publicKey,
      transactions: [txPayload],
      transactionId: tx.transactionId,
      nonce: tx.nonce,
      signature: tx.signature,
      senderPublicKey: tx.senderPublicKey,
      sender: tx.sender,
      receiver: tx.receiver,
      payload: tx.payload
    };

    logger.info(`Initiating FBA Block Consensus for Block #${nextBlockNumber} with EVM CONTRACT_CALL (Tx: ${tx.transactionId})...`);

    // 5. Run FBA Consensus Round (with EVM independent verification)
    const consensusResult = await consensusService.runBlockConsensus(candidateProposal, {
      round,
      expectedStateRoot: predictedStateRoot,
      expectedReceipts: [simReceipt.toJSON()],
      threshold: 9
    });

    if (consensusResult.status !== 'ACHIEVED') {
      mempool.removeIncludedTransactions([tx.transactionId]);
      const rejectedTx = await TransactionModel.create({
        transactionId: tx.transactionId,
        beneficiaryId: payload.contractAddress,
        shopId: tx.sender,
        commodity: payload.method || 'CONTRACT_CALL',
        quantity: 0,
        timestamp: tx.timestamp,
        status: 'Rejected',
        fbaValidators: consensusResult.participatingValidators,
        fbaConsensus: false,
        remarks: 'Failed FBA validator quorum agreement for contract call'
      });
      return {
        success: false,
        message: 'Contract call transaction rejected by validator quorum consensus.',
        transaction: rejectedTx,
        consensus: consensusResult
      };
    }

    // 6. Consensus Achieved: Atomically Commit Block & Execute in EVM
    return await sequelize.transaction(async (t) => {
      tx.payload.consensusRound = consensusResult.roundId;
      tx.payload.validators = consensusResult.participatingValidators;

      const executionResult = await executionEngine.executeTransaction(tx, {
        dbTransaction: t,
        consensusRound: consensusResult.roundId,
        blockNumber: nextBlockNumber,
        blockHash: ''
      });

      const finalEvmRoot = await evmRuntime.getStateRoot();
      const resultingState = await stateManager.getConsensusStateSnapshot({ dbTransaction: t });
      resultingState.evmStateRoot = finalEvmRoot;
      stateManager.assertStateConsistency(resultingState);
      const stateRoot = calculateStateRoot(resultingState);

      const newBlock = await blockchainService.addBlock(
        [tx.toBlockPayload()],
        consensusResult.validatorSignatures,
        t,
        stateRoot,
        {
          version: 1,
          proposerId,
          proposerAddress,
          proposerSignature,
          proposalId,
          round,
          receiptsRoot,
          executionReceipts: [executionResult.evmReceipt ? (executionResult.evmReceipt.toJSON ? executionResult.evmReceipt.toJSON() : executionResult.evmReceipt) : (executionResult.receipt || simReceipt.toJSON())],
          consensusCertificate: consensusResult.certificate,
          consensusStatus: 'FINALIZED'
        }
      );

      const txHash = '0x' + crypto.createHash('sha256')
        .update(JSON.stringify(tx.toBlockPayload()) + newBlock.blockHash)
        .digest('hex')
        .substring(0, 16);

      mempool.removeIncludedTransactions([tx.transactionId], newBlock.blockNumber);

      const verifiedTx = await TransactionModel.create({
        transactionId: tx.transactionId,
        beneficiaryId: payload.contractAddress,
        beneficiaryName: payload.method || 'CONTRACT_CALL',
        shopId: tx.sender,
        commodity: payload.method || 'CONTRACT_CALL',
        quantity: 0,
        timestamp: tx.timestamp,
        status: 'Verified',
        blockNumber: newBlock.blockNumber,
        blockHash: newBlock.blockHash,
        hash: txHash,
        fbaValidators: consensusResult.participatingValidators,
        fbaConsensus: true,
        remarks: 'Verified via 12-Validator FBA Quorum Consensus and EVM Execution'
      }, { transaction: t });

      return {
        success: true,
        message: 'Contract call successfully executed on EVM, verified through FBA consensus, and anchored to ledger.',
        transaction: verifiedTx,
        block: newBlock,
        receipt: executionResult.evmReceipt ? (executionResult.evmReceipt.toJSON ? executionResult.evmReceipt.toJSON() : executionResult.evmReceipt) : (executionResult.receipt || simReceipt.toJSON()),
        consensus: consensusResult
      };
    });
  }

  /**
   * Mempool Query Methods
   */
  getMempoolTransactions(status = null) {
    return mempool.getAllPending(status).map(e => e.toPublicSummary());
  }

  getMempoolStats() {
    return mempool.getStats();
  }

  getMempoolTransactionById(transactionId) {
    const entry = mempool.getTransaction(transactionId);
    if (!entry) {
      throw new NotFoundError(`Transaction '${transactionId}' not found in mempool.`);
    }
    return entry.toPublicSummary();
  }
}

module.exports = new TransactionService();
