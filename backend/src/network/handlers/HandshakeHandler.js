const crypto = require('crypto');
const { MessageEnvelope, MessageType } = require('../MessageEnvelope');
const { NetworkErrorCode, NetworkError } = require('../NetworkErrors');
const logger = require('../../utils/logger');

class HandshakeHandler {
  /**
   * @param {NetworkConfig} config
   * @param {PeerAuthenticator} authenticator
   * @param {object} [options]
   * @param {CertificateManager} [options.certificateManager]
   * @param {PeerAuthorizationRegistry} [options.peerAuthorizationRegistry]
   */
  constructor(config, authenticator, options = {}) {
    this.config = config;
    this.authenticator = authenticator;
    this.certificateManager = options.certificateManager || null;
    this.peerAuthorizationRegistry = options.peerAuthorizationRegistry || null;

    // Track active outgoing handshakes: peerConnection -> issued challenge
    this.pendingInitiatorChallenges = new Map();
    // Track active responder challenges: peerConnection -> issued challenge
    this.pendingResponderChallenges = new Map();
  }

  /**
   * Validate transport identity binding against Ed25519 claimed senderId
   * and enforce PeerAuthorizationRegistry policies
   * @param {MessageEnvelope} envelope 
   * @param {PeerConnection} peerConnection 
   */
  _validateTransportBinding(envelope, peerConnection) {
    const senderId = envelope.senderId;

    // 1. Peer authorization registry check (if configured)
    if (this.peerAuthorizationRegistry) {
      this.peerAuthorizationRegistry.assertAuthorized(senderId, peerConnection.peerCertificateFingerprint);
    }

    // 2. TLS / mTLS binding check
    const socket = peerConnection.socket;
    if (socket && (socket.encrypted || typeof socket.getPeerCertificate === 'function')) {
      let rawPeerCert = null;
      try {
        if (typeof socket.getPeerCertificate === 'function') {
          rawPeerCert = socket.getPeerCertificate(true);
        }
      } catch (e) {}

      if (rawPeerCert && Object.keys(rawPeerCert).length > 0) {
        // If CertificateManager is provided and cert has raw DER, verify certificate
        if (this.certificateManager) {
          try {
            if (rawPeerCert.raw) {
              const x509Cert = new crypto.X509Certificate(rawPeerCert.raw);
              this.certificateManager.verifyPeerCertificate(x509Cert, senderId);
            }
          } catch (err) {
            if (err instanceof NetworkError) throw err;
            throw new NetworkError(NetworkErrorCode.INVALID_CERTIFICATE, `Peer certificate verification failed: ${err.message}`);
          }
        }

        // Strict identity binding: verify Common Name or SAN against claimed validator ID
        const cn = rawPeerCert.subject && rawPeerCert.subject.CN;
        const san = rawPeerCert.subjectaltname || '';
        if (cn && senderId) {
          // If dev generic certificate is used without dedicated CertificateManager, permit dev fallback
          const isDevStaticCert = cn.toLowerCase().includes('pdschain-validator');
          if (isDevStaticCert && !this.certificateManager) {
            return;
          }

          const normalizedSender = String(senderId).toUpperCase().trim();
          const normalizedCN = String(cn).toUpperCase().trim();
          const normSenderSimple = normalizedSender.replace(/[^A-Z0-9]/g, '');
          const normCNSimple = normalizedCN.replace(/[^A-Z0-9]/g, '');

          const match = normalizedSender === normalizedCN ||
                        normSenderSimple === normCNSimple ||
                        san.toUpperCase().includes(normalizedSender) ||
                        san.toUpperCase().includes(normSenderSimple);

          if (!match) {
            throw new NetworkError(
              NetworkErrorCode.VALIDATOR_IDENTITY_MISMATCH,
              `Transport certificate CN '${cn}' does not match claimed Ed25519 identity '${senderId}'`
            );
          }
        }
      }
    }
  }

  /**
   * Initiator begins handshake immediately upon socket connection
   * @param {PeerConnection} peerConnection 
   */
  initiateHandshake(peerConnection) {
    const challenge = this.authenticator.createChallenge();
    this.pendingInitiatorChallenges.set(peerConnection, challenge);

    const envelope = new MessageEnvelope({
      version: this.config.protocolVersion,
      networkId: this.config.networkId,
      chainId: this.config.chainId,
      type: MessageType.HANDSHAKE,
      senderId: this.config.validatorId,
      payload: {
        protocolVersion: this.config.protocolVersion,
        networkId: this.config.networkId,
        chainId: this.config.chainId,
        challenge
      }
    });

    peerConnection.send(envelope);
  }

  /**
   * Responder handles incoming HANDSHAKE from initiator
   * @param {MessageEnvelope} envelope 
   * @param {PeerConnection} peerConnection 
   */
  handleHandshake(envelope, peerConnection) {
    envelope.validate({
      protocolVersion: this.config.protocolVersion,
      networkId: this.config.networkId,
      chainId: this.config.chainId
    });

    // Enforce transport binding and authorization
    this._validateTransportBinding(envelope, peerConnection);

    const payload = envelope.payload || {};
    const remoteChallenge = payload.challenge;
    if (!remoteChallenge) {
      throw new NetworkError(NetworkErrorCode.CHALLENGE_FAILED, 'Remote peer did not supply a challenge nonce in HANDSHAKE');
    }

    // Sign initiator's challenge
    const responseSignature = this.authenticator.signChallenge(remoteChallenge);

    // Create challenge for initiator
    const responderChallenge = this.authenticator.createChallenge();
    this.pendingResponderChallenges.set(peerConnection, {
      challenge: responderChallenge,
      claimedValidatorId: envelope.senderId
    });

    const ackEnvelope = new MessageEnvelope({
      version: this.config.protocolVersion,
      networkId: this.config.networkId,
      chainId: this.config.chainId,
      type: MessageType.HANDSHAKE_ACK,
      senderId: this.config.validatorId,
      correlationId: envelope.messageId,
      payload: {
        responseSignature,
        challenge: responderChallenge
      }
    });

    peerConnection.send(ackEnvelope);
  }

  /**
   * Initiator handles incoming HANDSHAKE_ACK from responder
   * @param {MessageEnvelope} envelope 
   * @param {PeerConnection} peerConnection 
   */
  handleHandshakeAck(envelope, peerConnection) {
    envelope.validate({
      protocolVersion: this.config.protocolVersion,
      networkId: this.config.networkId,
      chainId: this.config.chainId
    });

    // Enforce transport binding and authorization
    this._validateTransportBinding(envelope, peerConnection);

    const originalChallenge = this.pendingInitiatorChallenges.get(peerConnection);
    if (!originalChallenge) {
      throw new NetworkError(NetworkErrorCode.HANDSHAKE_TIMEOUT, 'No active initiator challenge found for connection');
    }
    this.pendingInitiatorChallenges.delete(peerConnection);

    const payload = envelope.payload || {};
    const responderSignature = payload.responseSignature;
    const responderChallenge = payload.challenge;

    // Verify responder's signature on original challenge
    const verified = this.authenticator.verifyChallenge(envelope.senderId, originalChallenge, responderSignature);

    // Sign responder's challenge
    const responseSignature = this.authenticator.signChallenge(responderChallenge);

    // Mark peer authenticated on initiator side
    peerConnection.markAuthenticated(verified.validatorId, verified.address, verified.publicKey);

    // Send HANDSHAKE_COMPLETE
    const completeEnvelope = new MessageEnvelope({
      version: this.config.protocolVersion,
      networkId: this.config.networkId,
      chainId: this.config.chainId,
      type: MessageType.HANDSHAKE_COMPLETE,
      senderId: this.config.validatorId,
      correlationId: envelope.messageId,
      payload: {
        responseSignature
      }
    });

    peerConnection.send(completeEnvelope);
  }

  /**
   * Responder handles incoming HANDSHAKE_COMPLETE from initiator
   * @param {MessageEnvelope} envelope 
   * @param {PeerConnection} peerConnection 
   */
  handleHandshakeComplete(envelope, peerConnection) {
    envelope.validate({
      protocolVersion: this.config.protocolVersion,
      networkId: this.config.networkId,
      chainId: this.config.chainId
    });

    // Enforce transport binding and authorization
    this._validateTransportBinding(envelope, peerConnection);

    const pending = this.pendingResponderChallenges.get(peerConnection);
    if (!pending) {
      throw new NetworkError(NetworkErrorCode.HANDSHAKE_TIMEOUT, 'No active responder challenge found for connection');
    }
    this.pendingResponderChallenges.delete(peerConnection);

    if (pending.claimedValidatorId !== envelope.senderId) {
      throw new NetworkError(NetworkErrorCode.IDENTITY_MISMATCH, 'Sender ID changed during handshake progression');
    }

    const payload = envelope.payload || {};
    const initiatorSignature = payload.responseSignature;

    // Verify initiator's signature on responder's challenge
    const verified = this.authenticator.verifyChallenge(envelope.senderId, pending.challenge, initiatorSignature);

    // Mark peer authenticated on responder side
    peerConnection.markAuthenticated(verified.validatorId, verified.address, verified.publicKey);
  }
}

module.exports = HandshakeHandler;
