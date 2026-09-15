const { sequelize } = require('../config/database');
const User = require('../models/User');
const Beneficiary = require('../models/Beneficiary');
const Shop = require('../models/Shop');
const Warehouse = require('../models/Warehouse');
const Commodity = require('../models/Commodity');
const Inventory = require('../models/Inventory');
const Transaction = require('../models/Transaction');
const BlockModel = require('../models/Block');
const Validator = require('../models/Validator');
const Block = require('../blockchain/Block');
const ConsensusCertificate = require('../consensus/ConsensusCertificate');
const { getOrCreateDevParticipant, getParticipantPrivateKey } = require('../blockchain/identity/keyManager');
const { signValidatorVote } = require('../blockchain/identity/signature');
const stateManager = require('../execution/StateManager');
const { generateSeedData } = require('./seedData');
const { validateChain } = require('../blockchain/validation');
const logger = require('../utils/logger');

function createSeededCertificate(blockNumber, blockHash, stateRoot, validatorIds, proposalId = '', round = 0) {
  const approvals = validatorIds.map(vId => {
    const vPart = getOrCreateDevParticipant(vId, 'VALIDATOR');
    const vPrivKey = getParticipantPrivateKey(vId);

    const votePayload = {
      validatorId: vId,
      validatorAddress: vPart.address,
      validatorPublicKey: vPart.publicKey,
      proposalId: proposalId || blockHash,
      blockNumber,
      blockHash,
      stateRoot,
      round,
      vote: 'ACCEPT',
      reason: ''
    };

    const signature = vPrivKey ? signValidatorVote(votePayload, vPrivKey) : `0x${Buffer.from(`VOTE:${vId}`).toString('hex')}`;

    return {
      validatorId: vId,
      validatorAddress: vPart.address,
      validatorPublicKey: vPart.publicKey,
      signature,
      timestamp: '2026-08-30T09:42:00.000Z',
      vote: 'ACCEPT'
    };
  });

  return new ConsensusCertificate({
    version: 1,
    proposalId: proposalId || blockHash,
    blockNumber,
    blockHash,
    stateRoot,
    round,
    threshold: 9,
    totalValidators: 12,
    achieved: approvals.length >= 9,
    validatorApprovals: approvals
  });
}

async function seedDatabase(force = true) {
  try {
    logger.info(`Starting PDSChain database seeding (force: ${force})...`);

    // Reset in-memory nonces
    stateManager.resetNonces();

    // 1. Sync database schema
    await sequelize.sync({ force });
    logger.info('Database schema created/reset successfully.');

    // 2. Generate Synthetic Datasets
    const data = await generateSeedData();

    // 3. Bulk Insert
    await User.bulkCreate(data.users);
    logger.info(`Seeded ${data.users.length} user accounts with bcrypt hashed passwords.`);

    await Commodity.bulkCreate(data.commodities);
    logger.info(`Seeded ${data.commodities.length} commodities.`);

    await Beneficiary.bulkCreate(data.beneficiaries);
    logger.info(`Seeded ${data.beneficiaries.length} citizen beneficiaries.`);

    await Shop.bulkCreate(data.shops);
    logger.info(`Seeded ${data.shops.length} Fair Price Shops.`);

    await Warehouse.bulkCreate(data.warehouses);
    logger.info(`Seeded ${data.warehouses.length} Warehouses and Silos.`);

    await Inventory.bulkCreate(data.inventories);
    logger.info(`Seeded ${data.inventories.length} inventory stock allocations.`);

    await Validator.bulkCreate(data.validators);
    logger.info(`Seeded ${data.validators.length} FBA Validator Nodes.`);

    await Transaction.bulkCreate(data.transactions);
    logger.info(`Seeded ${data.transactions.length} verified transactions.`);

    // 4. Seed Verified Blockchain with Valid Cryptographic Hashes & State Roots & Certificates
    const { calculateStateRoot } = require('../blockchain/state');
    const allValidators = data.validators.map(v => v.validatorId);

    const genesisStateRoot = calculateStateRoot({
      beneficiaries: [],
      shops: [],
      shopInventory: [],
      warehouses: [],
      warehouseInventory: []
    });

    // Extract current seeded state snapshot
    const consensusSnapshot = await stateManager.getConsensusStateSnapshot();
    const seededStateRoot = calculateStateRoot(consensusSnapshot);

    // Block 0: Genesis
    const genesis = new Block(
      0,
      '2026-01-01T00:00:00.000Z',
      [{ transactionId: 'GENESIS_TX', type: 'GENESIS', details: 'PDSChain Genesis Ledger Initialized' }],
      '0000000000000000000000000000000000000000000000000000000000000000',
      0,
      'FINALIZED',
      allValidators,
      genesisStateRoot,
      {
        proposerId: 'GENESIS',
        proposerAddress: 'PDS10000000000000000000000000000000000000000',
        round: 0
      }
    );
    genesis.mineBlock(2);
    const genesisCert = createSeededCertificate(0, genesis.blockHash, genesisStateRoot, allValidators, genesis.proposalId, 0);
    genesis.consensusCertificate = genesisCert.toJSON();

    // Block 1: Initial Procurement Block
    const block1 = new Block(
      1,
      '2026-08-28T09:00:00.000Z',
      [
        { transactionId: 'TRF-001', type: 'PROCUREMENT', item: 'Rice', qty: '10000 MT', to: 'WH-003' },
        { transactionId: 'TRF-002', type: 'PROCUREMENT', item: 'Wheat', qty: '6500 MT', to: 'WH-001' }
      ],
      genesis.blockHash,
      0,
      'FINALIZED',
      allValidators,
      seededStateRoot,
      {
        proposerId: 'VAL-01',
        round: 0
      }
    );
    const val1PrivKey = getParticipantPrivateKey('VAL-01');
    if (val1PrivKey) block1.signProposal(val1PrivKey);
    block1.mineBlock(2);
    const cert1 = createSeededCertificate(1, block1.blockHash, seededStateRoot, allValidators, block1.proposalId, 0);
    block1.consensusCertificate = cert1.toJSON();

    // Block 2: Dispatches & Early Distributions
    const block2 = new Block(
      2,
      '2026-08-29T11:45:00.000Z',
      [
        data.transactions[4],
        { transactionId: 'TXF-102', from: 'WH-003', to: 'FPS-102', item: 'Rice', qty: '500 KG' }
      ],
      block1.blockHash,
      0,
      'FINALIZED',
      allValidators,
      seededStateRoot,
      {
        proposerId: 'VAL-02',
        round: 0
      }
    );
    const val2PrivKey = getParticipantPrivateKey('VAL-02');
    if (val2PrivKey) block2.signProposal(val2PrivKey);
    block2.mineBlock(2);
    const cert2 = createSeededCertificate(2, block2.blockHash, seededStateRoot, allValidators, block2.proposalId, 0);
    block2.consensusCertificate = cert2.toJSON();

    // Block 3: Recent Distributions Block
    const block3 = new Block(
      3,
      '2026-08-30T08:35:00.000Z',
      [data.transactions[2], data.transactions[3]],
      block2.blockHash,
      0,
      'FINALIZED',
      allValidators.slice(0, 11), // 11 of 12 agreed
      seededStateRoot,
      {
        proposerId: 'VAL-03',
        round: 0
      }
    );
    const val3PrivKey = getParticipantPrivateKey('VAL-03');
    if (val3PrivKey) block3.signProposal(val3PrivKey);
    block3.mineBlock(2);
    const cert3 = createSeededCertificate(3, block3.blockHash, seededStateRoot, allValidators.slice(0, 11), block3.proposalId, 0);
    block3.consensusCertificate = cert3.toJSON();

    // Block 4: Latest Verified Block
    const block4 = new Block(
      4,
      '2026-08-30T09:42:00.000Z',
      [data.transactions[0], data.transactions[1]],
      block3.blockHash,
      0,
      'FINALIZED',
      allValidators,
      seededStateRoot,
      {
        proposerId: 'VAL-04',
        round: 0
      }
    );
    const val4PrivKey = getParticipantPrivateKey('VAL-04');
    if (val4PrivKey) block4.signProposal(val4PrivKey);
    block4.mineBlock(2);
    const cert4 = createSeededCertificate(4, block4.blockHash, seededStateRoot, allValidators, block4.proposalId, 0);
    block4.consensusCertificate = cert4.toJSON();

    const blocksToInsert = [genesis, block1, block2, block3, block4].map(b => b.toJSON());
    await BlockModel.bulkCreate(blocksToInsert);
    logger.info(`Seeded ${blocksToInsert.length} cryptographically verified blockchain blocks with Consensus Certificates.`);

    // 5. Run Immediate Validation Check
    const chainValidation = validateChain([genesis, block1, block2, block3, block4]);
    if (!chainValidation.isValid) {
      throw new Error(`Seeded blockchain validation failed: ${chainValidation.reason}`);
    }
    logger.info(`Blockchain verification check passed 100%! Chain height: ${blocksToInsert.length}.`);

    // Synchronize blockchainService singleton
    const blockchainService = require('../services/blockchainService');
    await blockchainService.init();

    logger.info('==========================================================');
    logger.info(' PDSChain Database & Blockchain Seeding Completed Successfully!');
    logger.info('==========================================================');
    return true;
  } catch (err) {
    logger.error('Error during database seeding:', err);
    throw err;
  }
}

async function autoSeedIfEmpty() {
  try {
    const userCount = await User.count();
    if (userCount === 0) {
      logger.info('Database empty, performing initial seed...');
      await seedDatabase(false);
    }
  } catch (err) {
    logger.error('Error during auto-seeding:', err.message);
  }
}

module.exports = {
  seedDatabase,
  autoSeedIfEmpty
};

if (require.main === module) {
  seedDatabase(true)
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
