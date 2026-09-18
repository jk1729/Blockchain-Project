const ConsensusCertificate = require('../../consensus/ConsensusCertificate');
const { NetworkErrorCode, NetworkError } = require('../NetworkErrors');
const logger = require('../../utils/logger');

class CertificateHandler {
  /**
   * @param {object} params
   * @param {NetworkConfig} params.config
   * @param {FinalityEngine} [params.finalityEngine]
   * @param {Function} [params.onCertificate] - async (certificate, peerConn) => void
   */
  constructor(params = {}) {
    this.config = params.config;
    this.finalityEngine = params.finalityEngine || null;
    this.onCertificate = params.onCertificate || null;
  }

  /**
   * Handle incoming finalized consensus certificate
   * @param {MessageEnvelope} envelope 
   * @param {PeerConnection} peerConn 
   */
  async handle(envelope, peerConn) {
    const payload = envelope.payload;
    if (!payload || typeof payload !== 'object') {
      throw new NetworkError(NetworkErrorCode.INVALID_PAYLOAD, 'Missing certificate payload');
    }

    const certData = payload.certificate || payload;
    const cert = certData instanceof ConsensusCertificate ? certData : new ConsensusCertificate(certData);

    // 1. Verify self-consistency of certificate hash
    const expectedHash = cert.calculateHash();
    if (cert.certificateHash !== expectedHash) {
      throw new NetworkError(
        NetworkErrorCode.MESSAGE_TAMPERED,
        `Certificate hash mismatch: expected ${expectedHash}, got ${cert.certificateHash}`
      );
    }

    // 2. Verify threshold satisfied
    if (!cert.achieved || cert.validatorApprovals.length < cert.threshold) {
      throw new NetworkError(
        NetworkErrorCode.MESSAGE_TAMPERED,
        `Certificate lacks required threshold: ${cert.validatorApprovals.length} < ${cert.threshold}`
      );
    }

    logger.info(`[CertificateHandler] Valid certificate received for block ${cert.blockNumber} (${cert.blockHash.slice(0, 10)}...) from ${envelope.senderId}`);

    if (this.onCertificate) {
      await this.onCertificate(cert, peerConn);
    }

    return cert;
  }
}

module.exports = CertificateHandler;

