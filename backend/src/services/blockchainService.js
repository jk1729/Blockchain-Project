const Blockchain = require('../blockchain/Blockchain');
const BlockModel = require('../models/Block');
const config = require('../config/env');
const logger = require('../utils/logger');
const { ProofIndexer, ProofMetrics } = require('../blockchain/merkle');

const defaultProofMetrics = new ProofMetrics();

class BlockchainService {
  constructor() {
    this.blockchain = new Blockchain(config.BLOCKCHAIN_DIFFICULTY);
    this.proofMetrics = defaultProofMetrics;
    this.proofIndexer = new ProofIndexer({ metrics: this.proofMetrics });
  }

  async init() {
    await this.blockchain.loadFromDatabase(BlockModel);
    this.proofIndexer.rebuild(this.blockchain.chain);
  }

  getChain() {
    return this.blockchain.toJSON();
  }

  getBlocks() {
    return this.blockchain.chain.map(b => b.toJSON());
  }

  getBlockByNumber(number) {
    const block = this.blockchain.getBlockByNumber(number);
    return block ? block.toJSON() : null;
  }

  getBlockByHash(hash) {
    if (!hash) return null;
    const cleanHash = hash.toLowerCase();
    const block = this.blockchain.chain.find(b =>
      (b.blockHash && b.blockHash.toLowerCase() === cleanHash) ||
      (b.hash && b.hash.toLowerCase() === cleanHash)
    );
    return block ? block.toJSON() : null;
  }

  getTransactionById(transactionId) {
    return this.blockchain.getTransactionById(transactionId);
  }

  validateChain(options = {}) {
    const check = require('../blockchain/validation').validateChain(this.blockchain.chain, options);
    return {
      isValid: check.isValid,
      reason: check.reason || null,
      brokenBlockIndex: check.brokenBlockIndex ?? null,
      blockCount: this.blockchain.chain.length,
      latestBlock: this.blockchain.getLatestBlock() ? this.blockchain.getLatestBlock().toJSON() : null
    };
  }

  async addBlock(transactions, validatorSignatures = [], transaction = null, stateRoot = null, options = {}) {
    // If chain is uninitialized or DB has newer blocks, sync first
    const dbCount = await BlockModel.count({ transaction });
    if (dbCount > this.blockchain.chain.length) {
      await this.init();
    }

    const newBlock = this.blockchain.addBlock(transactions, validatorSignatures, stateRoot, options);

    // Index block for sub-millisecond proof generation
    this.proofIndexer.indexBlock(newBlock);

    // Persist to database within transaction
    await BlockModel.create(newBlock.toJSON(), { transaction });
    logger.info(`Block #${newBlock.blockNumber} persisted to database. Proposer: ${newBlock.proposerId}, StateRoot: ${newBlock.stateRoot}`);

    return newBlock.toJSON();
  }

  async getCurrentStateRoot(transaction = null) {
    const stateManager = require('../execution/StateManager');
    return await stateManager.calculateCurrentStateRoot({ dbTransaction: transaction });
  }

  async getConsensusStateSnapshot(transaction = null) {
    const stateManager = require('../execution/StateManager');
    return await stateManager.getConsensusStateSnapshot({ dbTransaction: transaction });
  }

  getTransactionProof(txIdentifier) {
    const t0 = Date.now();
    try {
      const proof = this.proofIndexer.generateTransactionProof(txIdentifier, this.blockchain);
      this.proofMetrics.incrementGenerated(Date.now() - t0);
      return proof;
    } catch (err) {
      throw err;
    }
  }

  getReceiptProof(identifier) {
    const t0 = Date.now();
    try {
      const proof = this.proofIndexer.generateReceiptProof(identifier, this.blockchain);
      this.proofMetrics.incrementGenerated(Date.now() - t0);
      return proof;
    } catch (err) {
      throw err;
    }
  }

  getEventProof(eventId) {
    const t0 = Date.now();
    try {
      const proof = this.proofIndexer.generateEventProof(eventId, this.blockchain);
      this.proofMetrics.incrementGenerated(Date.now() - t0);
      return proof;
    } catch (err) {
      throw err;
    }
  }

  getBlockTree(identifier) {
    let block = null;
    if (typeof identifier === 'number' || /^\d+$/.test(String(identifier))) {
      block = this.blockchain.getBlockByNumber(Number(identifier));
    } else {
      block = this.blockchain.chain.find(b =>
        (b.blockHash && b.blockHash.toLowerCase() === String(identifier).toLowerCase()) ||
        (b.hash && b.hash.toLowerCase() === String(identifier).toLowerCase())
      );
    }

    if (!block) return null;

    const { MerkleTree } = require('../blockchain/merkle');
    const tree = new MerkleTree(block.transactions || [], {
      version: block.version || 1,
      commitmentType: 'TRANSACTION'
    });

    return {
      blockNumber: block.blockNumber !== undefined ? block.blockNumber : block.index,
      blockHash: block.blockHash || block.hash,
      merkleRoot: block.merkleRoot,
      receiptsRoot: block.receiptsRoot || null,
      version: block.version || 1,
      totalTransactions: block.transactions ? block.transactions.length : 0,
      depth: tree.getDepth(),
      layers: tree.layers
    };
  }

  getProofStatus() {
    return {
      indexer: this.proofIndexer.getStatus(),
      metrics: this.proofMetrics.getSnapshot()
    };
  }
}

const blockchainService = new BlockchainService();

module.exports = blockchainService;
