/**
 * PDSChain Merkle Module
 * Re-exports the core Merkle implementation with 100% backward compatibility.
 */

const merkle = require('./merkle/index');

module.exports = {
  ...merkle
};
