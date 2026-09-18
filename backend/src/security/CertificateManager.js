/**
 * PDSChain CertificateManager (Phase 12)
 * 
 * Manages transport TLS/mTLS X.509 certificate lifecycle:
 * - Parsing and cryptographic metadata extraction (Subject, SAN, Issuer, Fingerprint).
 * - Multi-tier expiration monitoring (30d, 14d, 7d, 24h, expired).
 * - CA trust chain verification via native Node.js crypto.X509Certificate.
 * - SAN/CN matching against claimed validator ID.
 * - Dynamic/hot certificate reload without process restart.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const EventEmitter = require('events');
const logger = require('../utils/logger');
const { NetworkErrorCode, NetworkError } = require('../network/NetworkErrors');

const ExpiryTier = {
  OK: 'OK',
  WARNING_30D: 'WARNING_30D',
  WARNING_14D: 'WARNING_14D',
  CRITICAL_7D: 'CRITICAL_7D',
  EMERGENCY_24H: 'EMERGENCY_24H',
  EXPIRED: 'EXPIRED'
};

class CertificateManager extends EventEmitter {
  /**
   * @param {object} [options]
   * @param {string} [options.certPem] - Active certificate PEM
   * @param {string} [options.keyPem] - Active private key PEM
   * @param {string} [options.caPem] - Consortium CA Certificate PEM
   * @param {string} [options.certPath] - File path to certificate
   * @param {string} [options.keyPath] - File path to key
   * @param {string} [options.caPath] - File path to CA
   */
  constructor(options = {}) {
    super();
    this.certPath = options.certPath ? path.resolve(options.certPath) : null;
    this.keyPath = options.keyPath ? path.resolve(options.keyPath) : null;
    this.caPath = options.caPath ? path.resolve(options.caPath) : null;

    this.certPem = options.certPem || (this.certPath && fs.existsSync(this.certPath) ? fs.readFileSync(this.certPath, 'utf8') : null);
    this.keyPem = options.keyPem || (this.keyPath && fs.existsSync(this.keyPath) ? fs.readFileSync(this.keyPath, 'utf8') : null);
    this.caPem = options.caPem || (this.caPath && fs.existsSync(this.caPath) ? fs.readFileSync(this.caPath, 'utf8') : null);

    this.currentCert = null;
    this.caCert = null;

    if (this.certPem) {
      this._parseCurrentCert();
    }
    if (this.caPem) {
      this._parseCACert();
    }
  }

  _parseCurrentCert() {
    try {
      this.currentCert = new crypto.X509Certificate(this.certPem);
    } catch (err) {
      throw new NetworkError(NetworkErrorCode.INVALID_CERTIFICATE, `Failed to parse transport X.509 certificate: ${err.message}`);
    }
  }

  _parseCACert() {
    try {
      this.caCert = new crypto.X509Certificate(this.caPem);
    } catch (err) {
      throw new NetworkError(NetworkErrorCode.UNKNOWN_ISSUER, `Failed to parse CA certificate: ${err.message}`);
    }
  }

  /**
   * Parse an arbitrary PEM certificate string into X509Certificate
   * @param {string} certPem 
   * @returns {crypto.X509Certificate}
   */
  static parse(certPem) {
    if (!certPem) {
      throw new NetworkError(NetworkErrorCode.INVALID_CERTIFICATE, 'Certificate PEM string is required');
    }
    try {
      return new crypto.X509Certificate(certPem);
    } catch (err) {
      throw new NetworkError(NetworkErrorCode.INVALID_CERTIFICATE, `Invalid X.509 certificate: ${err.message}`);
    }
  }

  /**
   * Check expiration status of the active certificate or a given X509Certificate
   * @param {crypto.X509Certificate} [x509Cert]
   * @returns {{ status: string, daysRemaining: number, hoursRemaining: number, validFrom: string, validTo: string, isExpired: boolean }}
   */
  checkExpiry(x509Cert = null) {
    const cert = x509Cert || this.currentCert;
    if (!cert) {
      return {
        status: ExpiryTier.EXPIRED,
        daysRemaining: 0,
        hoursRemaining: 0,
        validFrom: null,
        validTo: null,
        isExpired: true
      };
    }

    const now = Date.now();
    const validToMs = new Date(cert.validTo).getTime();
    const validFromMs = new Date(cert.validFrom).getTime();

    if (now < validFromMs) {
      return {
        status: 'NOT_YET_VALID',
        daysRemaining: 0,
        hoursRemaining: 0,
        validFrom: cert.validFrom,
        validTo: cert.validTo,
        isExpired: false,
        notYetValid: true
      };
    }

    const msRemaining = validToMs - now;
    const hoursRemaining = Math.floor(msRemaining / (1000 * 60 * 60));
    const daysRemaining = Math.floor(msRemaining / (1000 * 60 * 60 * 24));

    let status = ExpiryTier.OK;
    let isExpired = false;

    if (msRemaining <= 0) {
      status = ExpiryTier.EXPIRED;
      isExpired = true;
    } else if (hoursRemaining <= 24) {
      status = ExpiryTier.EMERGENCY_24H;
    } else if (daysRemaining <= 7) {
      status = ExpiryTier.CRITICAL_7D;
    } else if (daysRemaining <= 14) {
      status = ExpiryTier.WARNING_14D;
    } else if (daysRemaining <= 30) {
      status = ExpiryTier.WARNING_30D;
    }

    return {
      status,
      daysRemaining: Math.max(0, daysRemaining),
      hoursRemaining: Math.max(0, hoursRemaining),
      validFrom: cert.validFrom,
      validTo: cert.validTo,
      isExpired
    };
  }

  /**
   * Validate a peer certificate against Consortium CA and expected identity
   * @param {crypto.X509Certificate|string} peerCert
   * @param {string} [expectedValidatorId]
   * @returns {{ valid: boolean, subject: string, san: string[], serialNumber: string, fingerprint: string }}
   */
  verifyPeerCertificate(peerCert, expectedValidatorId = null) {
    const cert = typeof peerCert === 'string' ? CertificateManager.parse(peerCert) : peerCert;

    // Check validity window
    const now = Date.now();
    const validToMs = new Date(cert.validTo).getTime();
    const validFromMs = new Date(cert.validFrom).getTime();

    if (now < validFromMs) {
      throw new NetworkError(NetworkErrorCode.NOT_YET_VALID_CERTIFICATE, `Certificate is not yet valid (validFrom: ${cert.validFrom})`);
    }
    if (now > validToMs) {
      throw new NetworkError(NetworkErrorCode.EXPIRED_CERTIFICATE, `Certificate has expired (validTo: ${cert.validTo})`);
    }

    // Check CA signature if CA is configured
    if (this.caCert) {
      const verified = cert.verify(this.caCert.publicKey);
      if (!verified) {
        throw new NetworkError(NetworkErrorCode.UNKNOWN_ISSUER, 'Certificate was not signed by Consortium CA');
      }
    }

    // Extract SAN and Common Name
    const sanList = this.extractSAN(cert);
    const cn = this.extractCN(cert);

    // Cryptographic Identity Binding: check CN / SAN against expected validator ID
    if (expectedValidatorId) {
      const normalizedExpected = String(expectedValidatorId).toUpperCase().trim();
      const matchCN = cn && cn.toUpperCase().trim() === normalizedExpected;
      const matchSAN = sanList.some(s => s.toUpperCase().trim() === normalizedExpected || s.toUpperCase().trim() === `DNS:${normalizedExpected}`);

      // Also check loose prefix or DNS format: e.g. "pdschain-val-01" or "val-01"
      const normalizedExpectedAlt = normalizedExpected.toLowerCase().replace(/[^a-z0-9]/g, '');
      const matchLoose = (cn && cn.toLowerCase().replace(/[^a-z0-9]/g, '') === normalizedExpectedAlt) ||
        sanList.some(s => s.toLowerCase().replace(/[^a-z0-9]/g, '').includes(normalizedExpectedAlt));

      if (!matchCN && !matchSAN && !matchLoose) {
        throw new NetworkError(
          NetworkErrorCode.VALIDATOR_IDENTITY_MISMATCH,
          `Certificate subject '${cn}' (SAN: [${sanList.join(', ')}]) does not match expected validatorId '${expectedValidatorId}'`
        );
      }
    }

    return {
      valid: true,
      subject: cert.subject,
      cn,
      san: sanList,
      serialNumber: cert.serialNumber,
      fingerprint: cert.fingerprint256
    };
  }

  /**
   * Extract Common Name (CN) from X509 certificate subject
   * @param {crypto.X509Certificate} cert 
   * @returns {string|null}
   */
  extractCN(cert) {
    if (!cert || !cert.subject) return null;
    const match = cert.subject.match(/CN\s*=\s*([^,\n]+)/i);
    return match ? match[1].trim() : null;
  }

  /**
   * Extract SAN list from X509 certificate
   * @param {crypto.X509Certificate} cert 
   * @returns {string[]}
   */
  extractSAN(cert) {
    if (!cert || !cert.subjectAltName) return [];
    return cert.subjectAltName
      .split(',')
      .map(entry => entry.trim())
      .map(entry => entry.replace(/^(DNS|IP Address):/i, '').trim())
      .filter(Boolean);
  }

  /**
   * Reload certificate and private key from disk dynamically
   * @param {string} [newCertPath]
   * @param {string} [newKeyPath]
   * @returns {{ reloaded: boolean, fingerprint: string, expiry: object }}
   */
  reload(newCertPath = null, newKeyPath = null) {
    const targetCertPath = newCertPath ? path.resolve(newCertPath) : this.certPath;
    const targetKeyPath = newKeyPath ? path.resolve(newKeyPath) : this.keyPath;

    if (!targetCertPath || !fs.existsSync(targetCertPath)) {
      throw new NetworkError(NetworkErrorCode.INVALID_CERTIFICATE, `Certificate file not found: ${targetCertPath}`);
    }
    if (!targetKeyPath || !fs.existsSync(targetKeyPath)) {
      throw new NetworkError(NetworkErrorCode.INVALID_PRIVATE_KEY, `Private key file not found: ${targetKeyPath}`);
    }

    const certPem = fs.readFileSync(targetCertPath, 'utf8');
    const keyPem = fs.readFileSync(targetKeyPath, 'utf8');

    // Parse and validate before swapping active pointers
    const newCert = new crypto.X509Certificate(certPem);
    crypto.createPrivateKey(keyPem); // throws if key is invalid

    // Check CA verification if CA is active
    if (this.caCert) {
      if (!newCert.verify(this.caCert.publicKey)) {
        throw new NetworkError(NetworkErrorCode.UNKNOWN_ISSUER, 'New certificate was not signed by active Consortium CA');
      }
    }

    // Atomic swap
    this.certPath = targetCertPath;
    this.keyPath = targetKeyPath;
    this.certPem = certPem;
    this.keyPem = keyPem;
    this.currentCert = newCert;

    const expiry = this.checkExpiry();

    logger.info(`[CertificateManager] Transport certificate reloaded successfully. Fingerprint: ${newCert.fingerprint256}`);
    this.emit('reloaded', {
      fingerprint: newCert.fingerprint256,
      expiry
    });

    return {
      reloaded: true,
      fingerprint: newCert.fingerprint256,
      expiry
    };
  }

  /**
   * Health and diagnostic summary safe for Prometheus and /health/tls API
   */
  getHealthStatus() {
    if (!this.currentCert) {
      return {
        configured: false,
        status: 'UNCONFIGURED'
      };
    }

    const expiry = this.checkExpiry();
    const cn = this.extractCN(this.currentCert);
    const san = this.extractSAN(this.currentCert);

    return {
      configured: true,
      status: expiry.status,
      cn,
      san,
      fingerprint256: this.currentCert.fingerprint256,
      issuer: this.currentCert.issuer,
      validFrom: this.currentCert.validFrom,
      validTo: this.currentCert.validTo,
      daysRemaining: expiry.daysRemaining,
      hoursRemaining: expiry.hoursRemaining,
      isExpired: expiry.isExpired,
      caConfigured: Boolean(this.caCert)
    };
  }
}

module.exports = {
  CertificateManager,
  ExpiryTier
};

