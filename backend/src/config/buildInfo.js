/**
 * PDSChain Build & Packaging Reproducibility Metadata (Phase 11)
 * 
 * Provides verifiable runtime and build metadata for diagnostics,
 * version negotiation, and deployment health checks without leaking secrets.
 */

const fs = require('fs');
const path = require('path');

let pkg = { version: '1.0.0' };
try {
  const pkgPath = path.resolve(__dirname, '../../package.json');
  if (fs.existsSync(pkgPath)) {
    pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  }
} catch (e) {}

const BUILD_METADATA = {
  application: 'PDSChain Validator Runtime',
  version: pkg.version || '1.0.0',
  commitHash: process.env.BUILD_COMMIT || process.env.GIT_COMMIT || 'c8f7d1e0-phase-11',
  buildTimestamp: process.env.BUILD_TIMESTAMP || '2026-09-17T15:00:00.000Z',
  protocolVersion: parseInt(process.env.PROTOCOL_VERSION || 1, 10),
  defaultChainId: 1729,
  defaultNetworkId: 'pdschain-mainnet',
  runtime: {
    node: process.version,
    platform: process.platform,
    arch: process.arch
  }
};

function getBuildInfo(overrides = {}) {
  return {
    ...BUILD_METADATA,
    protocolVersion: overrides.protocolVersion || BUILD_METADATA.protocolVersion,
    chainId: overrides.chainId || BUILD_METADATA.defaultChainId,
    networkId: overrides.networkId || BUILD_METADATA.defaultNetworkId,
    timestamp: Date.now()
  };
}

if (require.main === module) {
  console.log(JSON.stringify(getBuildInfo(), null, 2));
}

module.exports = {
  BUILD_METADATA,
  getBuildInfo
};

