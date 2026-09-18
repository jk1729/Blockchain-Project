const Block = require('./Block');
const Transaction = require('./Transaction');
const { validateChain } = require('./validation');
const { calculateStateRoot } = require('./state');
const { getOrCreateDevParticipant, getParticipantPrivateKey } = require('./identity/keyManager');
const ConsensusCertificate = require('../consensus/ConsensusCertificate');
const config = require('../config/env');
const logger = require('../utils/logger');

class Blockchain {
  constructor(difficulty = config.BLOCKCHAIN_DIFFICULTY, options = {}) {
    this.chain = [];
    this.difficulty = difficulty;
    this.eventBus = options.eventBus || null;
  }

  setEventBus(eventBus) {
    this.eventBus = eventBus;
  }

  createGenesisBlock() {
    const genesisTx = new Transaction({
      transactionId: 'GENESIS_TX',
      type: 'GENESIS',
      sender: 'GENESIS',
      receiver: 'NETWORK',
      timestamp: '2026-01-01T00:00:00.000Z',
      payload: { details: 'PDSChain Genesis Block Initialized' }
    });

    const genesisStateRoot = calculateStateRoot({
      beneficiaries: [],
      shops: [],
      shopInventory: [],
      warehouses: [],
      warehouseInventory: []
    });

    const allValidators = ['VAL-01', 'VAL-02', 'VAL-03', 'VAL-04', 'VAL-05', 'VAL-06', 'VAL-07', 'VAL-08', 'VAL-09', 'VAL-10', 'VAL-11', 'VAL-12'];

    // Generate signed validator approvals for genesis certificate
    const genesisApprovals = allValidators.map(vId => {
      const vPart = getOrCreateDevParticipant(vId, 'VALIDATOR');
      return {
        validatorId: vId,
        validatorAddress: vPart.address,
        validatorPublicKey: vPart.publicKey,
        signature: '0x' + Buffer.from(`GENESIS_VOTE:${vId}`).toString('hex'),
        timestamp: '2026-01-01T00:00:00.000Z',
        vote: 'ACCEPT'
      };
    });

    const genesisCert = new ConsensusCertificate({
      version: 1,
      proposalId: '0000000000000000000000000000000000000000000000000000000000000000',
      blockNumber: 0,
      blockHash: '0000000000000000000000000000000000000000000000000000000000000000',
      stateRoot: genesisStateRoot,
      round: 0,
      threshold: 9,
      totalValidators: 12,
      achieved: true,
      validatorApprovals: genesisApprovals
    });

    const genesis = new Block(
      0,
      '2026-01-01T00:00:00.000Z',
      [genesisTx],
      '0000000000000000000000000000000000000000000000000000000000000000',
      0,
      'FINALIZED',
      allValidators,
      genesisStateRoot,
      {
        proposerId: 'GENESIS',
        proposerAddress: 'PDS10000000000000000000000000000000000000000',
        round: 0,
        consensusCertificate: genesisCert
      }
    );

    // Mine genesis to satisfy difficulty
    genesis.mineBlock(this.difficulty);
    return genesis;
  }

  getLatestBlock() {
    if (this.chain.length === 0) {
      const genesis = this.createGenesisBlock();
      this.chain.push(genesis);
      return genesis;
    }
    return this.chain[this.chain.length - 1];
  }

  addBlock(transactionsOrBlock, validatorSignatures = [], stateRoot = null, options = {}) {
    let newBlock;
    if (transactionsOrBlock instanceof Block || (transactionsOrBlock && (transactionsOrBlock.blockHash || transactionsOrBlock.hash) && Array.isArray(transactionsOrBlock.transactions))) {
      newBlock = transactionsOrBlock;
      this.chain.push(newBlock);
      logger.info(`New Block #${newBlock.blockNumber || newBlock.index} added to chain. Hash: ${newBlock.blockHash || newBlock.hash}`);
    } else {
      const transactions = transactionsOrBlock;
      const latest = this.getLatestBlock();
      const newNumber = latest.blockNumber + 1;
      const timestamp = options.timestamp || new Date().toISOString();

      const proposerId = options.proposerId || 'VAL-01';
      const proposerParticipant = getOrCreateDevParticipant(proposerId, 'VALIDATOR');
      const proposerAddress = options.proposerAddress || proposerParticipant.address;
      const round = parseInt(options.round !== undefined ? options.round : 0, 10);

      newBlock = new Block(
        newNumber,
        timestamp,
        transactions,
        latest.blockHash,
        0,
        options.consensusStatus || 'FINALIZED',
        validatorSignatures,
        stateRoot,
        {
          proposerId,
          proposerAddress,
          round,
          proposerSignature: options.proposerSignature,
          proposalId: options.proposalId,
          consensusCertificate: options.consensusCertificate,
          receiptsRoot: options.receiptsRoot,
          executionReceipts: options.executionReceipts
        }
      );

      // Auto-sign proposal if signature not provided and private key exists
      if (!newBlock.proposerSignature) {
        const privKey = getParticipantPrivateKey(proposerId);
        if (privKey) {
          newBlock.signProposal(privKey);
        }
      }

      newBlock.mineBlock(this.difficulty);
      this.chain.push(newBlock);
      logger.info(`New Block #${newBlock.blockNumber} added to chain. Hash: ${newBlock.blockHash}, Proposer: ${newBlock.proposerId}, StateRoot: ${newBlock.stateRoot}`);
    }

    if (this.eventBus) {
      try {
        const { BlockchainEvent, EventCategory, EventSeverity, FinalityStatus, EventType } = require('../events');
        const bNum = newBlock.blockNumber !== undefined ? newBlock.blockNumber : newBlock.index;
        const bHash = newBlock.blockHash || newBlock.hash;

        this.eventBus.publish(new BlockchainEvent({
          eventType: EventType.BLOCK_FINALIZED,
          category: EventCategory.BLOCKCHAIN || 'BLOCKCHAIN',
          severity: EventSeverity.INFO,
          finalityStatus: FinalityStatus.FINALIZED,
          blockHeight: bNum,
          blockHash: bHash,
          timestamp: newBlock.timestamp,
          round: newBlock.round,
          payload: {
            proposerId: newBlock.proposerId,
            stateRoot: newBlock.stateRoot,
            receiptsRoot: newBlock.receiptsRoot,
            txCount: Array.isArray(newBlock.transactions) ? newBlock.transactions.length : 0,
            transactionCount: Array.isArray(newBlock.transactions) ? newBlock.transactions.length : 0
          }
        }));

        if (Array.isArray(newBlock.transactions)) {
          newBlock.transactions.forEach((tx, idx) => {
            const txHash = tx.hash || tx.transactionId || tx.id || `TX-${bNum}-${idx}`;
            this.eventBus.publish(new BlockchainEvent({
              eventType: EventType.TRANSACTION_EXECUTED,
              category: EventCategory.TRANSACTION,
              severity: EventSeverity.INFO,
              finalityStatus: FinalityStatus.FINALIZED,
              blockHeight: bNum,
              blockHash: bHash,
              transactionHash: txHash,
              transactionIndex: idx,
              timestamp: newBlock.timestamp,
              payload: {
                type: tx.type || 'TRANSFER',
                sender: tx.sender || null,
                receiver: tx.receiver || null
              }
            }));
          });
        }
      } catch (e) {
        logger.warn(`[Blockchain] Failed to emit block events: ${e.message}`);
      }
    }

    return newBlock;
  }

  isChainValid(options = {}) {
    return validateChain(this.chain, options).isValid;
  }

  getBlockByNumber(blockNumber) {
    const num = parseInt(blockNumber, 10);
    return this.chain.find(b => b.blockNumber === num) || null;
  }

  getBlockByHash(hash) {
    return this.chain.find(b => b.blockHash === hash) || null;
  }

  getTransactionById(transactionId) {
    for (const block of this.chain) {
      if (Array.isArray(block.transactions)) {
        const found = block.transactions.find(tx => (
          tx.transactionId === transactionId ||
          tx.id === transactionId ||
          (tx.payload && tx.payload.transactionId === transactionId)
        ));
        if (found) {
          return {
            transaction: found,
            blockNumber: block.blockNumber,
            blockHash: block.blockHash,
            timestamp: block.timestamp,
            consensusStatus: block.consensusStatus
          };
        }
      }
    }
    return null;
  }

  async loadFromDatabase(BlockModel) {
    try {
      if (!BlockModel) return;
      const records = await BlockModel.findAll({ order: [['blockNumber', 'ASC']] });
      if (records && records.length > 0) {
        this.chain = records.map(r => new Block(
          r.blockNumber,
          r.timestamp,
          r.transactions,
          r.previousHash,
          r.nonce,
          r.consensusStatus,
          r.validatorSignatures,
          r.stateRoot,
          {
            version: r.version,
            proposerId: r.proposerId,
            proposerAddress: r.proposerAddress,
            proposerSignature: r.proposerSignature,
            proposalId: r.proposalId,
            round: r.round,
            consensusCertificate: r.consensusCertificate
          }
        ));
        logger.info(`Loaded ${this.chain.length} blocks from database into memory chain.`);
      } else {
        // Create and persist genesis block
        const genesis = this.createGenesisBlock();
        this.chain = [genesis];
        await BlockModel.create(genesis.toJSON());
        logger.info('Initialized Genesis Block in database.');
      }
    } catch (err) {
      logger.error('Error loading blockchain from DB:', err.message);
      if (this.chain.length === 0) {
        this.chain = [this.createGenesisBlock()];
      }
    }
  }

  toJSON() {
    return {
      chain: this.chain.map(b => b.toJSON()),
      difficulty: this.difficulty,
      length: this.chain.length,
      isValid: this.isChainValid()
    };
  }
}

module.exports = Blockchain;
