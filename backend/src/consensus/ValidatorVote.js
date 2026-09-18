const { signValidatorVote, verifyValidatorVoteSignature, extractUnsignedVotePayload } = require('../blockchain/identity/signature');
const { getPublicParticipantInfo } = require('../blockchain/identity/keyManager');

class ValidatorVote {
  constructor(data = {}) {
    this.validatorId = String(data.validatorId || '');
    this.validatorAddress = String(data.validatorAddress || '');
    this.validatorPublicKey = String(data.validatorPublicKey || '').replace(/^0x/, '');
    this.proposalId = String(data.proposalId || '');
    this.blockNumber = parseInt(data.blockNumber !== undefined ? data.blockNumber : data.blockIndex, 10) || 0;
    this.blockHash = String(data.blockHash || '');
    this.stateRoot = String(data.stateRoot || '');
    this.round = parseInt(data.round, 10) || 0;
    this.vote = String(data.vote || 'ACCEPT').toUpperCase();
    this.reason = data.reason ? String(data.reason) : '';
    this.timestamp = data.timestamp || new Date().toISOString();
    this.signature = data.signature ? String(data.signature) : null;
    this.chainId = data.chainId !== undefined && data.chainId !== null && data.chainId !== '' ? parseInt(data.chainId, 10) : undefined;

    // Auto-populate public key and address from identity keystore if missing
    if (this.validatorId && (!this.validatorAddress || !this.validatorPublicKey)) {
      const info = getPublicParticipantInfo(this.validatorId);
      if (info) {
        if (!this.validatorAddress) this.validatorAddress = info.address;
        if (!this.validatorPublicKey) this.validatorPublicKey = info.publicKey;
      }
    }
  }

  toUnsignedPayload() {
    return extractUnsignedVotePayload({
      chainId: this.chainId,
      validatorId: this.validatorId,
      validatorAddress: this.validatorAddress,
      validatorPublicKey: this.validatorPublicKey,
      proposalId: this.proposalId,
      blockNumber: this.blockNumber,
      blockHash: this.blockHash,
      stateRoot: this.stateRoot,
      round: this.round,
      vote: this.vote,
      reason: this.reason
    });
  }

  sign(privateKey) {
    if (!privateKey) throw new Error('Validator private key is required to sign vote');
    this.signature = signValidatorVote(this.toUnsignedPayload(), privateKey);
    return this.signature;
  }

  verifySignature() {
    if (!this.signature) {
      return { valid: false, reason: 'MISSING_VOTE_SIGNATURE' };
    }
    if (!this.validatorPublicKey) {
      return { valid: false, reason: 'MISSING_VALIDATOR_PUBLIC_KEY' };
    }
    return verifyValidatorVoteSignature(this.toUnsignedPayload(), this.signature, this.validatorPublicKey);
  }

  isAccept() {
    return this.vote === 'ACCEPT';
  }

  isReject() {
    return this.vote === 'REJECT';
  }

  toJSON() {
    const data = {
      validatorId: this.validatorId,
      validatorAddress: this.validatorAddress,
      validatorPublicKey: this.validatorPublicKey,
      proposalId: this.proposalId,
      blockNumber: this.blockNumber,
      blockHash: this.blockHash,
      stateRoot: this.stateRoot,
      round: this.round,
      vote: this.vote,
      reason: this.reason,
      timestamp: this.timestamp,
      signature: this.signature
    };
    if (this.chainId !== undefined) data.chainId = this.chainId;
    return data;
  }

  static fromJSON(data) {
    return new ValidatorVote(data);
  }
}

module.exports = ValidatorVote;

