/**
 * PDSChain Canonical State Serializer & State Root Calculation
 * 
 * Defines the consensus-relevant state schema, deterministic sorting rules,
 * canonical JSON serialization (key-order independent), and SHA-256 state root calculation.
 */

const crypto = require('crypto');

const STATE_ROOT_VERSION = 1;

/**
 * Deterministically stringify a value with sorted keys recursively
 * @param {*} val 
 * @returns {string} Canonical JSON string
 */
function canonicalStringify(val) {
  if (val === null || val === undefined) {
    return 'null';
  }
  if (typeof val === 'number') {
    return isFinite(val) ? String(val) : 'null';
  }
  if (typeof val === 'boolean') {
    return val ? 'true' : 'false';
  }
  if (typeof val === 'string') {
    return JSON.stringify(val);
  }
  if (Array.isArray(val)) {
    return '[' + val.map(item => canonicalStringify(item)).join(',') + ']';
  }
  if (typeof val === 'object') {
    const keys = Object.keys(val).sort();
    const entries = keys.map(k => `${JSON.stringify(k)}:${canonicalStringify(val[k])}`);
    return '{' + entries.join(',') + '}';
  }
  return JSON.stringify(val);
}

/**
 * Standardize numeric values to prevent floating-point representation drift
 * @param {number|string} val 
 * @returns {number}
 */
function normalizeQuantity(val) {
  const n = typeof val === 'number' ? val : parseFloat(val);
  if (isNaN(n) || !isFinite(n)) return 0;
  return Math.round(n * 1000) / 1000;
}

/**
 * Sort entitlement and claimed maps deterministically by commodity name
 * @param {object} map 
 * @returns {object}
 */
function normalizeCommodityMap(map = {}) {
  if (!map || typeof map !== 'object') return {};
  const normalized = {};
  const keys = Object.keys(map).sort((a, b) => String(a).localeCompare(String(b)));
  for (const k of keys) {
    normalized[String(k)] = normalizeQuantity(map[k]);
  }
  return normalized;
}

/**
 * Clean, filter, and deterministically sort raw state snapshot into canonical consensus state
 * @param {object} rawState 
 * @param {number} [version=1]
 * @returns {object} Canonical state representation
 */
function canonicalizeState(rawState = {}, version = STATE_ROOT_VERSION) {
  const state = rawState || {};

  // 1. Canonical Beneficiaries
  const rawBeneficiaries = Array.isArray(state.beneficiaries) ? state.beneficiaries : [];
  const beneficiaries = rawBeneficiaries.map(b => ({
    id: String(b.beneficiaryId || b.id || '').toUpperCase().trim(),
    status: String(b.status || 'Active').trim(),
    eligibilityStatus: Boolean(b.eligibilityStatus !== false && b.status !== 'Suspended'),
    monthlyEntitlement: normalizeCommodityMap(b.monthlyEntitlement),
    currentMonthClaimed: normalizeCommodityMap(b.currentMonthClaimed)
  })).sort((a, b) => a.id.localeCompare(b.id));

  // 2. Canonical Shops
  const rawShops = Array.isArray(state.shops) ? state.shops : [];
  const shops = rawShops.map(s => ({
    id: String(s.shopId || s.id || '').toUpperCase().trim(),
    status: String(s.status || 'Active').trim()
  })).sort((a, b) => a.id.localeCompare(b.id));

  // 3. Canonical Shop Inventory
  const rawShopInventory = Array.isArray(state.shopInventory) ? state.shopInventory : [];
  const shopInventory = rawShopInventory.map(inv => ({
    shopId: String(inv.ownerId || inv.shopId || '').toUpperCase().trim(),
    commodity: String(inv.commodityName || inv.commodity || '').trim(),
    quantity: normalizeQuantity(inv.quantity),
    unit: String(inv.unit || 'KG').toUpperCase().trim()
  })).sort((a, b) => {
    const sComp = a.shopId.localeCompare(b.shopId);
    if (sComp !== 0) return sComp;
    return a.commodity.localeCompare(b.commodity);
  });

  // 4. Canonical Warehouses
  const rawWarehouses = Array.isArray(state.warehouses) ? state.warehouses : [];
  const warehouses = rawWarehouses.map(w => ({
    id: String(w.warehouseId || w.id || '').toUpperCase().trim(),
    status: String(w.status || 'Operational').trim()
  })).sort((a, b) => a.id.localeCompare(b.id));

  // 5. Canonical Warehouse Inventory
  const rawWarehouseInventory = Array.isArray(state.warehouseInventory) ? state.warehouseInventory : [];
  const warehouseInventory = rawWarehouseInventory.map(inv => ({
    warehouseId: String(inv.ownerId || inv.warehouseId || '').toUpperCase().trim(),
    commodity: String(inv.commodityName || inv.commodity || '').trim(),
    quantity: normalizeQuantity(inv.quantity),
    unit: String(inv.unit || 'KG').toUpperCase().trim()
  })).sort((a, b) => {
    const wComp = a.warehouseId.localeCompare(b.warehouseId);
    if (wComp !== 0) return wComp;
    return a.commodity.localeCompare(b.commodity);
  });

  const canonical = {
    version: parseInt(version, 10) || STATE_ROOT_VERSION,
    beneficiaries,
    shops,
    shopInventory,
    warehouses,
    warehouseInventory
  };

  if (state.evmStateRoot) {
    canonical.evmStateRoot = String(state.evmStateRoot).toLowerCase().trim();
  }

  return canonical;
}

/**
 * Calculate deterministic SHA-256 State Root from state snapshot
 * @param {object} stateSnapshot 
 * @param {number} [version=1]
 * @returns {string} SHA-256 hex string prefixed with 0x
 */
function calculateStateRoot(stateSnapshot = {}, version = STATE_ROOT_VERSION) {
  const canonical = canonicalizeState(stateSnapshot, version);
  const serialized = canonicalStringify(canonical);
  const hash = crypto.createHash('sha256').update(serialized, 'utf8').digest('hex');
  return `0x${hash}`;
}

/**
 * Verify if state snapshot matches an expected state root
 * @param {object} stateSnapshot 
 * @param {string} expectedStateRoot 
 * @param {number} [version=1]
 * @returns {{ valid: boolean, calculatedRoot: string, expectedRoot: string }}
 */
function verifyStateRoot(stateSnapshot, expectedStateRoot, version = STATE_ROOT_VERSION) {
  const calculatedRoot = calculateStateRoot(stateSnapshot, version);
  const normExpected = String(expectedStateRoot || '').toLowerCase().trim();
  const normCalculated = calculatedRoot.toLowerCase();

  return {
    valid: normExpected === normCalculated || normExpected === normCalculated.replace(/^0x/, ''),
    calculatedRoot,
    expectedRoot: expectedStateRoot
  };
}

module.exports = {
  STATE_ROOT_VERSION,
  canonicalStringify,
  canonicalizeState,
  calculateStateRoot,
  verifyStateRoot
};

