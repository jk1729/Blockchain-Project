/**
 * PDSChain Warehouse Transfer Rule
 * 
 * Deterministically validates and executes atomic logistics transfers from warehouses
 * to Fair Price Shops or other distribution facilities.
 */

const BaseRule = require('./BaseRule');
const AuthorizationRule = require('./AuthorizationRule');
const Inventory = require('../../models/Inventory');
const Warehouse = require('../../models/Warehouse');
const Shop = require('../../models/Shop');
const { ExecutionErrorCodes, ExecutionError } = require('../errors/ExecutionErrors');

class WarehouseTransferRule extends BaseRule {
  /**
   * Validate warehouse transfer preconditions without mutating state.
   */
  async validate(context, stateManager, options = {}) {
    AuthorizationRule.validateAuthorization(context);

    const { warehouseId, shopId, receiver, commodity, quantity, unit } = context;
    const srcWarehouseId = warehouseId || (context.sender && context.sender.startsWith('WH-') ? context.sender : 'WH-001');
    const destShopId = shopId || (receiver && receiver.startsWith('FPS-') ? receiver : null);

    if (!srcWarehouseId || srcWarehouseId === 'SYSTEM') {
      throw new ExecutionError(
        ExecutionErrorCodes.WAREHOUSE_NOT_FOUND,
        'Source warehouse ID is required for transfer validation.'
      );
    }

    if (!destShopId || destShopId === 'SYSTEM') {
      throw new ExecutionError(
        ExecutionErrorCodes.SHOP_NOT_FOUND,
        'Destination shop ID is required for transfer validation.'
      );
    }

    if (!commodity) {
      throw new ExecutionError(
        ExecutionErrorCodes.COMMODITY_NOT_FOUND,
        'Commodity name is required for transfer validation.'
      );
    }

    const qty = typeof quantity === 'number' ? quantity : parseFloat(quantity);
    if (isNaN(qty) || qty <= 0) {
      throw new ExecutionError(
        ExecutionErrorCodes.INVALID_QUANTITY,
        `Transfer quantity must be greater than zero. Provided: ${quantity}`
      );
    }

    // 1. Verify Source Warehouse and Destination Shop Exist
    const whExists = await Warehouse.findOne({ where: { warehouseId: srcWarehouseId }, transaction: options.dbTransaction });
    if (!whExists) {
      throw new ExecutionError(
        ExecutionErrorCodes.WAREHOUSE_NOT_FOUND,
        `Source warehouse '${srcWarehouseId}' not found.`
      );
    }

    const shopExists = await Shop.findOne({ where: { shopId: destShopId }, transaction: options.dbTransaction });
    if (!shopExists) {
      throw new ExecutionError(
        ExecutionErrorCodes.SHOP_NOT_FOUND,
        `Destination shop '${destShopId}' not found.`
      );
    }

    // 2. Verify Source Warehouse Inventory
    let whInv = await stateManager.getWarehouseInventoryState(srcWarehouseId, commodity, options.dbTransaction);
    if (!whInv || whInv.quantity < qty) {
      const available = whInv ? whInv.quantity : 0;
      throw new ExecutionError(
        ExecutionErrorCodes.INSUFFICIENT_STOCK,
        `Insufficient warehouse inventory in '${srcWarehouseId}' for '${commodity}'. Available: ${available} ${unit}, Requested: ${qty} ${unit}.`,
        { warehouseId: srcWarehouseId, commodity, available, requested: qty }
      );
    }

    // 2. Predict Destination Inventory State
    let destShopInv = await Inventory.findOne({
      where: { ownerType: 'SHOP', ownerId: destShopId, commodityName: commodity },
      transaction: options.dbTransaction
    });

    const destBefore = destShopInv ? destShopInv.quantity : 0;
    const destAfter = Math.round((destBefore + qty) * 100) / 100;
    const srcBefore = whInv.quantity;
    const srcAfter = Math.round((srcBefore - qty) * 100) / 100;

    return {
      valid: true,
      warehouseInventory: whInv,
      destinationInventory: destShopInv,
      predictedChanges: [
        {
          entity: 'warehouse',
          id: String(srcWarehouseId).toUpperCase().trim(),
          field: `stock.${commodity}`,
          before: srcBefore,
          after: srcAfter,
          delta: -qty,
          unit: unit || 'KG'
        },
        {
          entity: 'shop',
          id: String(destShopId).toUpperCase().trim(),
          field: `stock.${commodity}`,
          before: destBefore,
          after: destAfter,
          delta: qty,
          unit: unit || 'KG'
        }
      ]
    };
  }

  /**
   * Atomically apply warehouse to shop stock transfer.
   */
  async execute(context, stateManager, options = {}) {
    const validation = await this.validate(context, stateManager, options);
    const { warehouseId, shopId, receiver, commodity, quantity } = context;

    const srcWarehouseId = warehouseId || (context.sender && context.sender.startsWith('WH-') ? context.sender : 'WH-001');
    const destShopId = shopId || (receiver && receiver.startsWith('FPS-') ? receiver : 'FPS-001');

    const result = await stateManager.applyWarehouseTransfer(
      srcWarehouseId,
      destShopId,
      commodity,
      quantity,
      options.dbTransaction
    );

    return {
      success: true,
      result,
      stateChanges: validation.predictedChanges
    };
  }
}

module.exports = WarehouseTransferRule;
