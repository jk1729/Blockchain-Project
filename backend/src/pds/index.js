/**
 * PDSChain Application Layer (PDS Domain Services)
 * 
 * Houses Public Distribution System business logic, entitlement rules,
 * inventory management, and shop/warehouse logistics.
 */

const entitlementService = require('../services/entitlementService');
const inventoryService = require('../services/inventoryService');

module.exports = {
  entitlementService,
  inventoryService
};

