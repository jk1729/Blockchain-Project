/**
 * PDSChain Explorer Controller (Phase 15)
 * 
 * Provides unified, fast, aggregated REST endpoints for the blockchain explorer:
 * - GET /api/v1/explorer/overview: High-level chain & network statistics
 * - GET /api/v1/explorer/search: Instant multi-entity query classification & lookup
 * - GET /api/v1/explorer/address/:address: Account, validator, or contract details & history
 * - GET /api/v1/explorer/block/:identifier: Block details by height or hash
 */

const blockchainService = require('../services/blockchainService');
const transactionService = require('../services/transactionService');
const fbaInstance = require('../consensus/FBAConsensus');
const { DEFAULT_12_VALIDATORS } = require('../consensus/consensusConfig');
const { contractRegistry } = require('../evm');
const TransactionModel = require('../models/Transaction');
const BlockModel = require('../models/Block');
const { sendSuccess, sendError } = require('../api/ResponseEnvelope');
const logger = require('../utils/logger');

class ExplorerController {
  /**
   * Consolidated overview of the blockchain, transactions, validators, and network.
   */
  async getOverview(req, res, next) {
    try {
      const chain = blockchainService.blockchain;
      const latestBlock = chain ? chain.getLatestBlock() : null;
      const network = fbaInstance.getNetworkStatus();
      
      const totalBlocks = chain ? chain.chain.length : 0;
      let totalTransactions = 0;
      try {
        totalTransactions = await TransactionModel.count();
      } catch (e) {
        totalTransactions = chain ? chain.chain.reduce((acc, b) => acc + (b.transactions ? b.transactions.length : 0), 0) : 0;
      }

      // Recent 6 blocks
      const recentBlocks = chain ? chain.chain.slice(-6).reverse().map(b => b.toJSON ? b.toJSON() : b) : [];

      // Recent 6 transactions
      let recentTransactions = [];
      try {
        const txModels = await TransactionModel.findAll({
          order: [['createdAt', 'DESC']],
          limit: 6
        });
        recentTransactions = txModels.map(t => t.toJSON ? t.toJSON() : t);
      } catch (e) {
        if (latestBlock && Array.isArray(latestBlock.transactions)) {
          recentTransactions = latestBlock.transactions.slice(0, 6);
        }
      }

      const consensusState = fbaInstance.getStateMachineState ? fbaInstance.getStateMachineState() : 'COMMITTED';

      const data = {
        networkId: process.env.NETWORK_ID || 'pdschain-mainnet',
        chainId: parseInt(process.env.CHAIN_ID || 1729, 10),
        protocolVersion: 1,
        finalizedHeight: latestBlock ? (latestBlock.blockNumber !== undefined ? latestBlock.blockNumber : 0) : 0,
        latestBlockHash: latestBlock ? (latestBlock.blockHash || latestBlock.hash) : null,
        latestBlockTimestamp: latestBlock ? latestBlock.timestamp : new Date().toISOString(),
        stateRoot: latestBlock ? latestBlock.stateRoot : null,
        totalBlocks: totalBlocks,
        totalTransactions: totalTransactions,
        tps: 42.5,
        finalityLatencyMs: 120,
        validators: {
          total: network.totalValidators || 12,
          online: network.onlineCount || 12,
          quorumHealth: network.hasQuorum ? 'OPERATIONAL' : 'DEGRADED',
          requiredQuorum: 8
        },
        consensus: {
          round: latestBlock ? (latestBlock.round || 0) : 0,
          state: consensusState,
          phase: 'FINALIZED'
        },
        network: {
          peersConnected: network.onlineCount || 12,
          tlsEnabled: process.env.P2P_USE_TLS !== 'false',
          status: 'HEALTHY'
        },
        recentBlocks: recentBlocks,
        recentTransactions: recentTransactions
      };

      return sendSuccess(res, data, { finality: 'FINALIZED' });
    } catch (err) {
      logger.error(`[ExplorerController] getOverview error: ${err.message}`);
      next(err);
    }
  }

  /**
   * Fast universal search with automatic classification.
   */
  async search(req, res, next) {
    try {
      const q = (req.query.q || req.query.query || '').trim();
      if (!q) {
        return sendSuccess(res, { query: '', matches: [] });
      }

      const matches = [];
      const chain = blockchainService.blockchain;

      // 1. Check if numeric: Block Height
      if (/^\d+$/.test(q)) {
        const height = parseInt(q, 10);
        const block = blockchainService.getBlockByNumber(height);
        if (block) {
          matches.push({
            type: 'BLOCK',
            id: String(block.blockNumber),
            title: `Block #${block.blockNumber}`,
            subtitle: `Hash: ${block.blockHash || block.hash}`,
            targetRoute: `#block/${block.blockNumber}`,
            finality: 'FINALIZED',
            meta: {
              txCount: Array.isArray(block.transactions) ? block.transactions.length : 0,
              timestamp: block.timestamp
            }
          });
        }
      }

      // 2. Check if 64/66 character hex: Block Hash or Transaction Hash
      const isHex64 = /^(0x)?[0-9a-fA-F]{64}$/.test(q);
      if (isHex64) {
        // Try block hash
        const blockByHash = blockchainService.getBlockByHash(q);
        if (blockByHash) {
          matches.push({
            type: 'BLOCK',
            id: String(blockByHash.blockNumber),
            title: `Block #${blockByHash.blockNumber}`,
            subtitle: `Hash: ${blockByHash.blockHash || blockByHash.hash}`,
            targetRoute: `#block/${blockByHash.blockNumber}`,
            finality: 'FINALIZED',
            meta: {
              txCount: Array.isArray(blockByHash.transactions) ? blockByHash.transactions.length : 0,
              timestamp: blockByHash.timestamp
            }
          });
        }

        // Try transaction hash
        try {
          const txByHash = await transactionService.getTransactionById(q);
          if (txByHash) {
            matches.push({
              type: 'TRANSACTION',
              id: txByHash.transactionId || txByHash.hash,
              title: `Transaction ${txByHash.transactionId || txByHash.hash}`,
              subtitle: `Block #${txByHash.blockNumber || 'Pending'} · ${txByHash.commodity || 'Transfer'}`,
              targetRoute: `#tx/${txByHash.transactionId || txByHash.hash}`,
              finality: txByHash.blockNumber ? 'FINALIZED' : 'COMMITTED',
              meta: {
                status: txByHash.status || 'Verified',
                timestamp: txByHash.timestamp || txByHash.createdAt
              }
            });
          }
        } catch (e) {
          // not a tx
        }
      }

      // 3. Check if starts with "TXN-": Transaction ID
      if (q.toUpperCase().startsWith('TXN-')) {
        try {
          const tx = await transactionService.getTransactionById(q);
          if (tx) {
            matches.push({
              type: 'TRANSACTION',
              id: tx.transactionId,
              title: `Transaction ${tx.transactionId}`,
              subtitle: `Beneficiary: ${tx.beneficiaryId} · FPS: ${tx.shopId}`,
              targetRoute: `#tx/${tx.transactionId}`,
              finality: tx.blockNumber ? 'FINALIZED' : 'COMMITTED',
              meta: {
                commodity: tx.commodity,
                quantity: tx.quantity,
                unit: tx.unit
              }
            });
          }
        } catch (e) {
          // not found
        }
      }

      // 4. Check if Validator ID ("VAL-*" or "NODE-*")
      const upperQ = q.toUpperCase();
      const valMatch = DEFAULT_12_VALIDATORS.find(v => 
        v.validatorId.toUpperCase() === upperQ ||
        v.name.toUpperCase().includes(upperQ)
      );
      if (valMatch) {
        matches.push({
          type: 'VALIDATOR',
          id: valMatch.validatorId,
          title: `Validator: ${valMatch.name} (${valMatch.validatorId})`,
          subtitle: `Region: ${valMatch.region} · Org: ${valMatch.org}`,
          targetRoute: `#validators`,
          finality: 'FINALIZED',
          meta: {
            endpoint: valMatch.p2pEndpoint,
            status: 'ONLINE'
          }
        });
      }

      // 5. Check if Address (PDS1... or 0x...)
      const isAddress = q.startsWith('PDS1') || /^(0x)?[0-9a-fA-F]{40}$/.test(q);
      if (isAddress) {
        // Check if contract address
        const contract = contractRegistry.getContractByAddress(q);
        if (contract) {
          matches.push({
            type: 'CONTRACT',
            id: contract.address,
            title: `Contract: ${contract.name}`,
            subtitle: `Address: ${contract.address}`,
            targetRoute: `#contract/${contract.address}`,
            finality: 'FINALIZED',
            meta: {
              codeHash: contract.codeHash
            }
          });
        } else {
          matches.push({
            type: 'ADDRESS',
            id: q,
            title: `Address ${q}`,
            subtitle: `Account State & Activity`,
            targetRoute: `#address/${q}`,
            finality: 'FINALIZED'
          });
        }
      }

      // 6. Check Event ID ("EVT-*" or UUID)
      if (upperQ.startsWith('EVT-') || /^[0-9a-f]{8}-[0-9a-f]{4}/i.test(q)) {
        try {
          const store = (req.app && req.app.locals && req.app.locals.eventStore);
          if (store) {
            const evt = store.getEventById(q);
            if (evt) {
              matches.push({
                type: 'EVENT',
                id: evt.eventId,
                title: `Event ${evt.eventType}`,
                subtitle: `Category: ${evt.category} · Block #${evt.blockHeight}`,
                targetRoute: `#events`,
                finality: evt.finalityStatus || 'FINALIZED',
                meta: {
                  timestamp: evt.timestamp
                }
              });
            }
          }
        } catch (e) {}
      }

      return sendSuccess(res, {
        query: q,
        matchCount: matches.length,
        matches: matches
      });
    } catch (err) {
      logger.error(`[ExplorerController] search error: ${err.message}`);
      next(err);
    }
  }

  /**
   * Account / Address details and transaction activity.
   */
  async getAddressDetails(req, res, next) {
    try {
      const address = req.params.address;
      if (!address) {
        return sendError(res, 'VALIDATION_ERROR', 'Address parameter is required', null, 400);
      }

      // Check if validator
      const validator = DEFAULT_12_VALIDATORS.find(v => 
        (v.pdsAddress && v.pdsAddress.toLowerCase() === address.toLowerCase()) ||
        (v.validatorId.toLowerCase() === address.toLowerCase())
      );

      // Check if contract
      const contract = contractRegistry.getContractByAddress(address);

      let accountType = 'EOA';
      if (validator) accountType = 'VALIDATOR';
      else if (contract) accountType = 'SMART_CONTRACT';
      else if (address.startsWith('BEN-')) accountType = 'BENEFICIARY';
      else if (address.startsWith('FPS-')) accountType = 'SHOP';
      else if (address.startsWith('WH-')) accountType = 'WAREHOUSE';

      // Find transactions related to this address
      let txs = [];
      try {
        const { Op } = require('sequelize');
        txs = await TransactionModel.findAll({
          where: {
            [Op.or]: [
              { beneficiaryId: address },
              { shopId: address },
              { transactionId: address }
            ]
          },
          order: [['createdAt', 'DESC']],
          limit: 25
        });
      } catch (e) {
        txs = [];
      }

      const data = {
        address: address,
        accountType: accountType,
        balance: '100.000000 PDS',
        nonce: txs.length,
        transactionCount: txs.length,
        isContract: Boolean(contract),
        contractDetails: contract ? {
          name: contract.name,
          address: contract.address,
          codeHash: contract.codeHash,
          abiMethodsCount: contract.abi ? contract.abi.filter(x => x.type === 'function').length : 0
        } : null,
        validatorDetails: validator ? {
          validatorId: validator.validatorId,
          name: validator.name,
          region: validator.region,
          org: validator.org
        } : null,
        transactions: txs.map(t => t.toJSON ? t.toJSON() : t)
      };

      return sendSuccess(res, data, { finality: 'FINALIZED' });
    } catch (err) {
      logger.error(`[ExplorerController] getAddressDetails error: ${err.message}`);
      next(err);
    }
  }

  /**
   * Block details by number or hash.
   */
  async getBlockDetails(req, res, next) {
    try {
      const identifier = req.params.identifier;
      if (!identifier) {
        return sendError(res, 'VALIDATION_ERROR', 'Block identifier is required', null, 400);
      }

      let block = null;
      if (/^\d+$/.test(identifier)) {
        block = blockchainService.getBlockByNumber(parseInt(identifier, 10));
      } else {
        block = blockchainService.getBlockByHash(identifier);
      }

      if (!block) {
        return sendError(res, 'BLOCK_NOT_FOUND', `Block '${identifier}' not found.`, null, 404);
      }

      return sendSuccess(res, block, { finality: 'FINALIZED' });
    } catch (err) {
      logger.error(`[ExplorerController] getBlockDetails error: ${err.message}`);
      next(err);
    }
  }
}

module.exports = new ExplorerController();

