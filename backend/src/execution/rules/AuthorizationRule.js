/**
 * PDSChain Authorization Rule
 * 
 * Deterministically verifies actor permissions for requested transaction operations.
 */

const { ExecutionErrorCodes, ExecutionError } = require('../errors/ExecutionErrors');

class AuthorizationRule {
  /**
   * Validate that the transaction sender is authorized for the given transaction type.
   * @param {ExecutionContext} context 
   */
  static validateAuthorization(context) {
    const { transactionType, sender, shopId, warehouseId, payload = {} } = context;
    const type = (transactionType || '').toUpperCase();
    const s = String(sender || '').trim();
    const role = String(payload.senderRole || payload.role || '').toUpperCase();

    // System and validator institutional nodes are authorized
    if (s === 'SYSTEM' || s.startsWith('VAL-')) {
      return true;
    }

    switch (type) {
      case 'DISTRIBUTION':
        // Shop officer, FPS entity, or citizen beneficiary
        if (s.startsWith('FPS-') || s.startsWith('SHOP-') || s === shopId || s.startsWith('BEN-') || 
            role === 'SHOP' || role === 'OFFICER' || role === 'CITIZEN' || role === 'BENEFICIARY' ||
            (s.startsWith('PDS1') && role !== 'UNAUTHORIZED')) {
          return true;
        }
        throw new ExecutionError(
          ExecutionErrorCodes.UNAUTHORIZED_SENDER,
          `Sender '${sender}' is not authorized to execute DISTRIBUTION transactions`
        );

      case 'ENTITLEMENT':
      case 'DEDUCT_QUOTA':
        // Admin or Civil Supplies Authority
        if (s.startsWith('ADM-') || s.startsWith('ADMIN') || s.startsWith('MIN-') || s.startsWith('DEPT-') || 
            role === 'ADMIN' || role === 'GOVERNMENT' ||
            (s.startsWith('PDS1') && (role === 'ADMIN' || role === 'GOVERNMENT' || !role))) {
          return true;
        }
        throw new ExecutionError(
          ExecutionErrorCodes.UNAUTHORIZED_SENDER,
          `Sender '${sender}' is not authorized to execute ENTITLEMENT quota operations`
        );

      case 'INVENTORY':
      case 'SHOP_STOCK_DEDUCTION':
        if (s.startsWith('FPS-') || s.startsWith('SHOP-') || s === shopId || 
            role === 'SHOP' || role === 'OFFICER' || role === 'ADMIN' ||
            (s.startsWith('PDS1') && role !== 'CITIZEN' && role !== 'UNAUTHORIZED')) {
          return true;
        }
        throw new ExecutionError(
          ExecutionErrorCodes.UNAUTHORIZED_SENDER,
          `Sender '${sender}' is not authorized to execute INVENTORY modifications`
        );

      case 'WAREHOUSE_TRANSFER':
      case 'TRANSFER':
        // Warehouse manager or logistics admin
        if (s.startsWith('WH-') || s.startsWith('WAREHOUSE') || s === warehouseId || s.startsWith('ADM-') || 
            role === 'WAREHOUSE' || role === 'ADMIN' || role === 'LOGISTICS' ||
            (s.startsWith('PDS1') && (role === 'WAREHOUSE' || role === 'ADMIN' || role === 'LOGISTICS' || !role))) {
          return true;
        }
        throw new ExecutionError(
          ExecutionErrorCodes.UNAUTHORIZED_SENDER,
          `Sender '${sender}' is not authorized to execute WAREHOUSE_TRANSFER operations`
        );

      default:
        throw new ExecutionError(
          ExecutionErrorCodes.INVALID_TRANSACTION_TYPE,
          `Unsupported transaction type: '${type}'`
        );
    }
  }
}

module.exports = AuthorizationRule;
