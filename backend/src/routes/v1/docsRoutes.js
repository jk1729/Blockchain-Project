/**
 * PDSChain OpenAPI Documentation Route (Phase 14)
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');

const openApiFilePath = path.join(__dirname, '../../docs/openapi.json');
let cachedSpec = null;

function getSpec() {
  if (!cachedSpec && fs.existsSync(openApiFilePath)) {
    try {
      cachedSpec = JSON.parse(fs.readFileSync(openApiFilePath, 'utf8'));
    } catch (e) {
      cachedSpec = { openapi: '3.0.3', info: { title: 'PDSChain API', version: '1.0.0' } };
    }
  }
  return cachedSpec;
}

router.get('/', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.json(getSpec());
});

router.get('/openapi.json', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.json(getSpec());
});

module.exports = router;

