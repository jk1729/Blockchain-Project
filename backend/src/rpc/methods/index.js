/**
 * PDSChain JSON-RPC 2.0 Method Registry Aggregator (Phases 14 & 17)
 */

const blockchainMethods = require('./blockchainMethods');
const transactionMethods = require('./transactionMethods');
const contractMethods = require('./contractMethods');
const consensusMethods = require('./consensusMethods');
const networkMethods = require('./networkMethods');
const syncMethods = require('./syncMethods');
const eventMethods = require('./eventMethods');
const nodeMethods = require('./nodeMethods');
const proofMethods = require('./proofMethods');
const securityMethods = require('./securityMethods');

const allMethods = {
  ...blockchainMethods,
  ...transactionMethods,
  ...contractMethods,
  ...consensusMethods,
  ...networkMethods,
  ...syncMethods,
  ...eventMethods,
  ...nodeMethods,
  ...proofMethods,
  ...securityMethods
};

module.exports = allMethods;
