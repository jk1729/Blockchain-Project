/**
 * PDSChain Mempool Module Entry Point
 */

const Mempool = require('./Mempool');
const { MempoolEntry, MempoolStatus } = require('./MempoolEntry');
const MempoolPolicy = require('./MempoolPolicy');
const { MempoolErrorCodes, MempoolError } = require('./MempoolErrors');

// Default global singleton instance
const mempool = new Mempool();

module.exports = {
  Mempool,
  MempoolEntry,
  MempoolStatus,
  MempoolPolicy,
  MempoolError,
  MempoolErrorCodes,
  mempool
};

