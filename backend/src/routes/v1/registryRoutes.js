/**
 * PDSChain v1 Registry & Subsystem Routes (Phase 14)
 */

const express = require('express');
const router = express.Router();
const Beneficiary = require('../../models/Beneficiary');
const Shop = require('../../models/Shop');
const Warehouse = require('../../models/Warehouse');
const Validator = require('../../models/Validator');
const { sendSuccess, sendError } = require('../../api/ResponseEnvelope');
const { paginateArray } = require('../../api/CursorPagination');

// GET /api/v1/beneficiaries
router.get('/beneficiaries', async (req, res, next) => {
  try {
    const raw = await Beneficiary.findAll({ order: [['id', 'ASC']] });
    const paginated = paginateArray(raw.map(b => b.toJSON()), {
      cursor: req.query.cursor,
      limit: req.query.limit || 20
    });
    return sendSuccess(res, paginated.items, { pagination: paginated.pageInfo });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/beneficiaries/:id
router.get('/beneficiaries/:id', async (req, res, next) => {
  try {
    const b = await Beneficiary.findOne({ where: { beneficiaryId: req.params.id } });
    if (!b) {
      return sendError(res, 'BENEFICIARY_NOT_FOUND', `Beneficiary '${req.params.id}' not found.`, null, 404);
    }
    return sendSuccess(res, b.toJSON());
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/shops
router.get('/shops', async (req, res, next) => {
  try {
    const raw = await Shop.findAll({ order: [['id', 'ASC']] });
    return sendSuccess(res, raw.map(s => s.toJSON()));
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/shops/:id
router.get('/shops/:id', async (req, res, next) => {
  try {
    const s = await Shop.findOne({ where: { shopId: req.params.id } });
    if (!s) {
      return sendError(res, 'SHOP_NOT_FOUND', `Shop '${req.params.id}' not found.`, null, 404);
    }
    return sendSuccess(res, s.toJSON());
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/warehouses
router.get('/warehouses', async (req, res, next) => {
  try {
    const raw = await Warehouse.findAll({ order: [['id', 'ASC']] });
    return sendSuccess(res, raw.map(w => w.toJSON()));
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/warehouses/:id
router.get('/warehouses/:id', async (req, res, next) => {
  try {
    const w = await Warehouse.findOne({ where: { warehouseId: req.params.id } });
    if (!w) {
      return sendError(res, 'WAREHOUSE_NOT_FOUND', `Warehouse '${req.params.id}' not found.`, null, 404);
    }
    return sendSuccess(res, w.toJSON());
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/validators
router.get('/validators', async (req, res, next) => {
  try {
    const raw = await Validator.findAll({ order: [['id', 'ASC']] });
    return sendSuccess(res, raw.map(v => v.toJSON()), { finality: 'FINALIZED' });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/validators/:id
router.get('/validators/:id', async (req, res, next) => {
  try {
    const id = req.params.id.toUpperCase().trim();
    const v = await Validator.findOne({ where: { validatorId: id } });
    if (!v) {
      return sendError(res, 'VALIDATOR_NOT_FOUND', `Validator '${id}' not found.`, null, 404);
    }
    return sendSuccess(res, v.toJSON(), { finality: 'FINALIZED' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

