/**
 * PDSChain Security Subsystem (Phases 12 & 17)
 */

const { KeyStore, KeyStoreError } = require('./KeyStore');
const { CertificateManager, ExpiryTier } = require('./CertificateManager');
const { KeyRotationManager, KeyRotationError } = require('./KeyRotationManager');
const { PeerAuthorizationRegistry, PeerStatus } = require('./PeerAuthorizationRegistry');
const permissions = require('./permissions');

module.exports = {
  KeyStore,
  KeyStoreError,
  CertificateManager,
  ExpiryTier,
  KeyRotationManager,
  KeyRotationError,
  PeerAuthorizationRegistry,
  PeerStatus,
  ...permissions
};
