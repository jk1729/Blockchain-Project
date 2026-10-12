/**
 * Isolated OS Child Process Worker for a Single PDSChain FBA Validator Node (V1..V12 / VAL-01..VAL-12)
 */

const { DEFAULT_12_VALIDATORS, resolveValidatorId } = require('../consensus/consensusConfig');
const { createValidatorApp } = require('./validatorServer');

const rawId = process.env.VALIDATOR_ID || process.argv[2] || 'VAL-01';
const validatorId = resolveValidatorId(rawId);
const vConfig = DEFAULT_12_VALIDATORS.find(v => v.validatorId === validatorId) || {
  validatorId,
  shortId: validatorId.replace('VAL-0', 'V').replace('VAL-', 'V'),
  name: `Validator ${validatorId}`,
  org: 'PDSChain Federation',
  port: parseInt(process.env.API_PORT || process.env.PORT || '4001', 10),
  p2pPort: parseInt(process.env.P2P_PORT || '5001', 10),
  trustConfiguration: { threshold: 3, quorumSlice: [validatorId] }
};

const port = parseInt(process.env.API_PORT || process.env.PORT || vConfig.port, 10);
const { app, node, persistState } = createValidatorApp({ ...vConfig, port });

const server = app.listen(port, '127.0.0.1', () => {
  if (process.send) {
    process.send({
      type: 'VALIDATOR_READY',
      validatorId: node.validatorId,
      shortId: node.shortId,
      pid: process.pid,
      port,
      publicKey: node.publicKey,
      address: node.address
    });
  }
});

server.on('error', (err) => {
  if (process.send) {
    process.send({
      type: 'VALIDATOR_ERROR',
      validatorId: node.validatorId,
      error: err.message,
      code: err.code
    });
  }
  process.exit(1);
});

process.on('message', (msg) => {
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'STOP') {
    persistState();
    server.close(() => process.exit(0));
  } else if (msg.type === 'SET_STATUS' && msg.status) {
    node.setStatus(msg.status);
    persistState();
    if (process.send) {
      process.send({
        type: 'STATUS_UPDATED',
        validatorId: node.validatorId,
        status: node.status,
        pid: process.pid
      });
    }
  }
});

function shutdown() {
  try {
    persistState();
    server.close(() => process.exit(0));
  } catch (e) {
    process.exit(0);
  }
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
