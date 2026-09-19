const Beneficiary = require('../models/Beneficiary');
const Inventory = require('../models/Inventory');
const Warehouse = require('../models/Warehouse');
const Shop = require('../models/Shop');
const StockTransfer = require('../models/StockTransfer');
const { NotFoundError, ValidationError } = require('../utils/errors');
const { calculateStateRoot, canonicalizeState, verifyStateRoot, verifyStateConsistency, assertStateConsistency } = require('../blockchain/state');
const crypto = require('crypto');

/**
 * PDSChain StateManager
 * 
 * Manages access, snapshots, nonces, and state transitions for PDS world state
 * (Beneficiary entitlements, Shop inventory, Warehouse stock, Sender nonces).
 */
class StateManager {
  constructor() {
    // In-memory sender-specific nonce tracking
    this.senderNonces = new Map();
    // Cache of processed transaction IDs to guard against immediate replays
    this.seenTransactionIds = new Set();
  }

  /**
   * Reset in-memory nonces and transaction caches (e.g. during test setup or DB re-seed)
   */
  resetNonces() {
    this.senderNonces.clear();
    this.seenTransactionIds.clear();
  }

  /**
   * Get expected next nonce for a sender address or entity ID
   * @param {string} sender 
   * @returns {number} Expected nonce (0 for first transaction)
   */
  getExpectedNonce(sender) {
    if (!sender) return 0;
    const key = String(sender).toLowerCase().trim();
    if (!this.senderNonces.has(key)) {
      return 0;
    }
    return this.senderNonces.get(key) + 1;
  }

  /**
   * Validate sender nonce for replay protection
   * @param {string} sender 
   * @param {number} nonce 
   * @returns {{ valid: boolean, reason?: string, expectedNonce: number }}
   */
  validateNonce(sender, nonce) {
    const expected = this.getExpectedNonce(sender);
    const n = parseInt(nonce, 10) || 0;

    if (n < expected) {
      return {
        valid: false,
        reason: `REPLAYED_NONCE: Provided nonce ${n} has already been consumed. Expected nonce: ${expected}`,
        expectedNonce: expected
      };
    }

    if (n > expected) {
      return {
        valid: false,
        reason: `NONCE_GAP: Provided nonce ${n} is greater than expected nonce ${expected}`,
        expectedNonce: expected
      };
    }

    return {
      valid: true,
      expectedNonce: expected
    };
  }

  /**
   * Atomically consume nonce after transaction block commit
   * @param {string} sender 
   * @param {number} nonce 
   */
  consumeNonce(sender, nonce) {
    if (!sender) return;
    const key = String(sender).toLowerCase().trim();
    const n = parseInt(nonce, 10) || 0;
    this.senderNonces.set(key, n);
  }

  /**
   * Record transaction ID to prevent duplicate replays
   * @param {string} transactionId 
   */
  recordTransactionId(transactionId) {
    if (transactionId) {
      this.seenTransactionIds.add(transactionId);
    }
  }

  /**
   * Check if transaction ID has been executed
   * @param {string} transactionId 
   */
  isTransactionIdSeen(transactionId) {
    return this.seenTransactionIds.has(transactionId);
  }

  /**
   * Retrieve current state for a beneficiary
   */
  async getBeneficiaryState(beneficiaryId, transaction = null) {
    const id = String(beneficiaryId).toUpperCase().trim();
    const ben = await Beneficiary.findOne({
      where: { beneficiaryId: id },
      transaction
    });
    if (!ben) {
      throw new NotFoundError(`Beneficiary '${id}' not found in state.`);
    }
    return ben;
  }

  /**
   * Retrieve inventory record for a shop and commodity
   */
  async getShopInventoryState(shopId, commodity, transaction = null) {
    const sId = String(shopId).toUpperCase().trim();
    let inv = await Inventory.findOne({
      where: {
        ownerType: 'SHOP',
        ownerId: sId,
        commodityName: commodity
      },
      transaction
    });

    if (!inv) {
      inv = await Inventory.create({
        ownerType: 'SHOP',
        ownerId: sId,
        commodityName: commodity,
        quantity: 1500,
        reserved: 0,
        unit: 'KG',
        minThreshold: 200
      }, { transaction });
    }

    return inv;
  }

  /**
   * Retrieve inventory record for a warehouse and commodity
   */
  async getWarehouseInventoryState(warehouseId, commodity, transaction = null) {
    const wId = String(warehouseId).toUpperCase().trim();
    return await Inventory.findOne({
      where: {
        ownerType: 'WAREHOUSE',
        ownerId: wId,
        commodityName: commodity
      },
      transaction
    });
  }

  /**
   * Atomically deduct monthly entitlement quota for a beneficiary
   */
  async applyEntitlementDeduction(beneficiaryId, commodity, quantity, transaction = null) {
    const ben = await this.getBeneficiaryState(beneficiaryId, transaction);
    const claimed = { ...(ben.currentMonthClaimed || {}) };
    const current = parseFloat(claimed[commodity] || 0);
    claimed[commodity] = current + parseFloat(quantity);

    ben.currentMonthClaimed = claimed;
    ben.lastDist = new Date().toISOString().split('T')[0];
    await ben.save({ transaction });

    return {
      beneficiaryId: ben.beneficiaryId,
      commodity,
      deducted: parseFloat(quantity),
      newClaimed: claimed[commodity],
      lastDist: ben.lastDist
    };
  }

  /**
   * Atomically deduct stock from a shop's inventory
   */
  async applyShopStockDeduction(shopId, commodity, quantity, transaction = null) {
    const inv = await this.getShopInventoryState(shopId, commodity, transaction);
    const qty = parseFloat(quantity);

    if (inv.quantity < qty) {
      throw new ValidationError(`Cannot deduct ${qty} KG from available ${inv.quantity} KG in shop ${shopId}.`);
    }

    inv.quantity = Math.max(0, inv.quantity - qty);
    await inv.save({ transaction });

    return {
      ownerType: 'SHOP',
      ownerId: shopId,
      commodity,
      deducted: qty,
      remainingStock: inv.quantity
    };
  }

  /**
   * Atomically transfer stock from warehouse to shop
   */
  async applyWarehouseTransfer(warehouseId, shopId, commodity, quantity, transaction = null, transferId = null, idempotencyKey = null) {
    const qty = parseFloat(quantity);
    if (isNaN(qty) || qty <= 0) {
      throw new ValidationError('Transfer quantity must be a positive number.');
    }

    const whInv = await this.getWarehouseInventoryState(warehouseId, commodity, transaction);
    if (transaction && transaction.LOCK) {
      await whInv?.reload({ transaction, lock: transaction.LOCK.UPDATE });
    }
    if (!whInv || whInv.quantity < qty) {
      throw new ValidationError(`Insufficient warehouse inventory in '${warehouseId}' for '${commodity}'. Available: ${whInv ? whInv.quantity : 0} KG.`);
    }

    whInv.quantity -= qty;
    await whInv.save({ transaction });

    let shopInv = await Inventory.findOne({
      where: { ownerType: 'SHOP', ownerId: shopId, commodityName: commodity },
      transaction,
      ...(transaction && transaction.LOCK ? { lock: transaction.LOCK.UPDATE } : {})
    });

    if (shopInv) {
      shopInv.quantity += qty;
      await shopInv.save({ transaction });
    } else {
      shopInv = await Inventory.create({
        ownerType: 'SHOP',
        ownerId: shopId,
        commodityName: commodity,
        quantity: qty,
        reserved: 0,
        unit: 'KG',
        minThreshold: 100
      }, { transaction });
    }

    const persistedTransferId = transferId || `TRF-${Date.now().toString().slice(-6)}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
    const transferRecord = await StockTransfer.create({
      transferId: persistedTransferId,
      warehouseId,
      shopId,
      commodity,
      quantity: qty,
      unit: 'KG',
      status: 'Completed',
      idempotencyKey,
      timestamp: new Date().toISOString()
    }, { transaction });

    return {
      transferId: persistedTransferId,
      transferRecord,
      warehouseStock: whInv.quantity,
      shopStock: shopInv.quantity
    };
  }

  /**
   * Generic state transition dispatcher
   */
  async applyStateTransition(transitionType, params, transaction = null) {
    switch (transitionType.toUpperCase()) {
      case 'DEDUCT_QUOTA':
        return await this.applyEntitlementDeduction(params.beneficiaryId, params.commodity, params.quantity, transaction);
      case 'DEDUCT_SHOP_STOCK':
        return await this.applyShopStockDeduction(params.shopId, params.commodity, params.quantity, transaction);
      case 'WAREHOUSE_TRANSFER':
        return await this.applyWarehouseTransfer(params.warehouseId, params.shopId, params.commodity, params.quantity, transaction);
      default:
        throw new ValidationError(`Unsupported state transition type: ${transitionType}`);
    }
  }

  /**
   * Get an aggregated state snapshot for verification
   */
  async getStateSnapshot({ beneficiaryId, shopId, warehouseId } = {}) {
    const snapshot = {};
    if (beneficiaryId) {
      snapshot.beneficiary = await this.getBeneficiaryState(beneficiaryId);
    }
    if (shopId) {
      snapshot.shopInventory = await Inventory.findAll({ where: { ownerType: 'SHOP', ownerId: shopId } });
    }
    if (warehouseId) {
      snapshot.warehouseInventory = await Inventory.findAll({ where: { ownerType: 'WAREHOUSE', ownerId: warehouseId } });
    }
    return snapshot;
  }

  /**
   * Extract complete consensus-relevant state snapshot from database
   * Safe for deterministic hashing (excludes passwords, secrets, timestamps, internal row IDs).
   * @param {object} [options] - Options (dbTransaction, transaction)
   * @returns {Promise<object>} Canonical consensus state snapshot
   */
  async getConsensusStateSnapshot(options = {}) {
    const tx = options.dbTransaction || options.transaction || null;

    const [beneficiaries, shops, warehouses, inventories] = await Promise.all([
      Beneficiary.findAll({ transaction: tx }),
      Shop.findAll({ transaction: tx }),
      Warehouse.findAll({ transaction: tx }),
      Inventory.findAll({ transaction: tx })
    ]);

    const shopInventory = inventories.filter(inv => inv.ownerType === 'SHOP');
    const warehouseInventory = inventories.filter(inv => inv.ownerType === 'WAREHOUSE');

    const rawSnapshot = {
      beneficiaries: beneficiaries.map(b => (b.toJSON ? b.toJSON() : b)),
      shops: shops.map(s => (s.toJSON ? s.toJSON() : s)),
      shopInventory: shopInventory.map(i => (i.toJSON ? i.toJSON() : i)),
      warehouses: warehouses.map(w => (w.toJSON ? w.toJSON() : w)),
      warehouseInventory: warehouseInventory.map(i => (i.toJSON ? i.toJSON() : i))
    };

    return canonicalizeState(rawSnapshot);
  }

  /**
   * Calculate current SHA-256 state root from live world state
   * @param {object} [options]
   * @returns {Promise<string>}
   */
  async calculateCurrentStateRoot(options = {}) {
    const snapshot = await this.getConsensusStateSnapshot(options);
    return calculateStateRoot(snapshot);
  }

  /**
   * Validate logical invariants on given state or current database state
   * @param {object} [stateSnapshot]
   * @returns {Promise<{ valid: boolean, errors: Array<string> }>}
   */
  async verifyStateConsistency(stateSnapshot = null) {
    const snapshot = stateSnapshot || (await this.getConsensusStateSnapshot());
    return verifyStateConsistency(snapshot);
  }

  /**
   * Assert state consistency
   * @param {object} [stateSnapshot]
   */
  async assertStateConsistency(stateSnapshot = null) {
    const snapshot = stateSnapshot || (await this.getConsensusStateSnapshot());
    return assertStateConsistency(snapshot);
  }
}

module.exports = new StateManager();
