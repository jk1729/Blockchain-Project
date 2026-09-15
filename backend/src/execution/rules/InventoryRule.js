/**
 * PDSChain Inventory Rule
 * 
 * Deterministically validates Fair Price Shop stock availability and executes stock deductions.
 * Prevents negative inventory balances.
 */

const BaseRule = require('./BaseRule');
const AuthorizationRule = require('./AuthorizationRule');
const { ExecutionErrorCodes, ExecutionError } = require('../errors/ExecutionErrors');

class InventoryRule extends BaseRule {
  /**
   * Validate inventory availability without mutating state.
   */
  async validate(context, stateManager, options = {}) {
    AuthorizationRule.validateAuthorization(context);

    const { shopId, commodity, quantity, unit } = context;

    if (!shopId || shopId === 'SYSTEM') {
      throw new ExecutionError(
        ExecutionErrorCodes.SHOP_NOT_FOUND,
        'Valid shop ID is required for inventory validation.'
      );
    }

    if (!commodity) {
      throw new ExecutionError(
        ExecutionErrorCodes.COMMODITY_NOT_FOUND,
        'Commodity name is required for inventory validation.'
      );
    }

    const qty = typeof quantity === 'number' ? quantity : parseFloat(quantity);
    if (isNaN(qty) || qty <= 0) {
      throw new ExecutionError(
        ExecutionErrorCodes.INVALID_QUANTITY,
        `Quantity must be greater than zero. Provided: ${quantity}`
      );
    }

    // 1. Fetch Shop Inventory State
    let shopInv;
    try {
      shopInv = await stateManager.getShopInventoryState(shopId, commodity, options.dbTransaction);
    } catch (err) {
      throw new ExecutionError(
        ExecutionErrorCodes.SHOP_NOT_FOUND,
        `Failed to retrieve inventory for shop '${shopId}': ${err.message}`
      );
    }

    // 2. Check Available Stock
    const availableStock = Math.round((shopInv.quantity - (shopInv.reserved || 0)) * 100) / 100;
    if (qty > availableStock) {
      throw new ExecutionError(
        ExecutionErrorCodes.INSUFFICIENT_STOCK,
        `Insufficient shop inventory for '${commodity}' at '${shopId}'. Available: ${availableStock} ${unit}, Requested: ${qty} ${unit}.`,
        { shopId, commodity, availableStock, requested: qty }
      );
    }

    const newStock = Math.round((shopInv.quantity - qty) * 100) / 100;

    return {
      valid: true,
      shopInventory: shopInv,
      availableStock,
      predictedChanges: [
        {
          entity: 'shop',
          id: String(shopId).toUpperCase().trim(),
          field: `stock.${commodity}`,
          before: shopInv.quantity,
          after: newStock,
          delta: -qty,
          unit: unit || 'KG'
        }
      ]
    };
  }

  /**
   * Atomically apply inventory stock deduction.
   */
  async execute(context, stateManager, options = {}) {
    const validation = await this.validate(context, stateManager, options);
    const { shopId, commodity, quantity } = context;

    const result = await stateManager.applyShopStockDeduction(
      shopId,
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

module.exports = InventoryRule;
