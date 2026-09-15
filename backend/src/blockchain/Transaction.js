const { serializeUnsignedTransaction, hashCanonical, generateDeterministicTxId } = require('./serialization');
const { signTransaction, verifyTransactionSignature } = require('./identity/signature');

/**
 * PDSChain Blockchain Transaction Representation
 * 
 * Canonical Structure:
 * {
 *   transactionId: string,   // Deterministic TXN-<HASH16>
 *   version: string,         // e.g. '1.0'
 *   type: string,            // 'DISTRIBUTION' | 'TRANSFER' | 'PROCUREMENT' | 'GENESIS'
 *   sender: string,          // PDS1... address or participant ID
 *   senderPublicKey: string, // Ed25519 public key hex
 *   receiver: string,        // PDS1... address or participant ID
 *   payload: object,         // PDS specific state transition parameters
 *   timestamp: string,       // ISO-8601 UTC creation timestamp
 *   nonce: number,           // Sender-specific sequence counter
 *   signature: string|null   // Ed25519 signature over canonical unsigned payload
 * }
 */
class Transaction {
  constructor({
    transactionId,
    id,
    version = '1.0',
    type = 'DISTRIBUTION',
    sender,
    senderPublicKey = null,
    beneficiaryId,
    from,
    receiver,
    shopId,
    to,
    payload = {},
    commodity,
    quantity,
    qty,
    unit = 'KG',
    name,
    beneficiaryName,
    timestamp,
    time,
    nonce = 0,
    signature = null,
    consensusRound = null,
    validators = null,
    status = 'Pending'
  } = {}) {
    this.version = String(version || '1.0');
    this.type = (type || 'DISTRIBUTION').toUpperCase();

    // Preserve beneficiary and shop identifiers
    const pdsBenId = beneficiaryId || (payload && (payload.beneficiaryId || payload.beneficiary)) || (sender && !sender.startsWith('PDS1') ? sender : null);
    const pdsShopId = shopId || (payload && (payload.shopId || payload.shop)) || (receiver && !receiver.startsWith('PDS1') ? receiver : null);

    // Sender identity (address or entity ID)
    this.sender = sender || beneficiaryId || from || (payload && payload.beneficiaryId) || (payload && payload.from) || 'SYSTEM';
    this.senderPublicKey = senderPublicKey || (payload && payload.senderPublicKey) || null;

    // Receiver identity (address or entity ID)
    this.receiver = receiver || shopId || to || (payload && payload.shopId) || (payload && payload.to) || 'SYSTEM';

    // Normalize PDS payload
    const pdsCommodity = commodity || (payload && (payload.commodity || payload.item)) || null;
    const pdsQty = quantity !== undefined ? quantity : (qty !== undefined ? qty : (payload && (payload.quantity !== undefined ? payload.quantity : payload.qty)));
    const pdsName = name || beneficiaryName || (payload && (payload.name || payload.beneficiaryName)) || '';

    this.payload = {
      ...payload,
      ...(pdsBenId ? { beneficiaryId: pdsBenId } : {}),
      ...(pdsShopId ? { shopId: pdsShopId } : {}),
      ...(pdsCommodity ? { commodity: pdsCommodity } : {}),
      ...(pdsQty !== undefined ? { quantity: typeof pdsQty === 'string' && pdsQty.includes(' ') ? parseFloat(pdsQty) : pdsQty } : {}),
      unit: unit || (payload && payload.unit) || 'KG',
      name: pdsName,
      consensusRound: consensusRound || (payload && payload.consensusRound) || null,
      validators: validators || (payload && payload.validators) || null
    };

    this.timestamp = timestamp || time || new Date().toISOString();
    this.nonce = parseInt(nonce, 10) || 0;
    this.signature = signature || null;
    this.status = status;

    // Assign or derive transactionId
    if (transactionId || id) {
      this.transactionId = transactionId || id;
    } else {
      // Derive deterministic ID from canonical unsigned fields
      const canonicalHash = hashCanonical(serializeUnsignedTransaction(this));
      this.transactionId = generateDeterministicTxId(canonicalHash);
    }
  }

  // Backward compatibility getters for PDS application & test access
  get id() {
    return this.transactionId;
  }

  set id(val) {
    this.transactionId = val;
  }

  get beneficiaryId() {
    return (this.payload && (this.payload.beneficiaryId || this.payload.beneficiary)) ||
           (this.sender && !this.sender.startsWith('PDS1') ? this.sender : null) ||
           this.sender;
  }

  get shopId() {
    return (this.payload && (this.payload.shopId || this.payload.shop)) ||
           (this.receiver && !this.receiver.startsWith('PDS1') ? this.receiver : null) ||
           this.receiver;
  }

  get commodity() {
    return (this.payload && (this.payload.commodity || this.payload.item)) || '';
  }

  get quantity() {
    return (this.payload && (this.payload.quantity !== undefined ? this.payload.quantity : this.payload.qty)) || 0;
  }

  get qty() {
    return `${this.quantity} ${(this.payload && this.payload.unit) || 'KG'}`;
  }

  get unit() {
    return (this.payload && this.payload.unit) || 'KG';
  }

  get name() {
    return (this.payload && this.payload.name) || '';
  }

  get beneficiaryName() {
    return (this.payload && this.payload.name) || '';
  }

  /**
   * Calculate deterministic SHA-256 hash of canonical unsigned transaction
   */
  calculateHash() {
    const canonicalStr = serializeUnsignedTransaction(this);
    return hashCanonical(canonicalStr);
  }

  /**
   * Set cryptographic signature and update deterministic transaction ID
   */
  setSignature(signatureHex, deterministicTxId = null, publicKeyHex = null) {
    this.signature = signatureHex;
    if (deterministicTxId) {
      this.transactionId = deterministicTxId;
    } else {
      const canonicalHash = this.calculateHash();
      this.transactionId = generateDeterministicTxId(canonicalHash);
    }
    if (publicKeyHex) {
      this.senderPublicKey = publicKeyHex;
    }
  }

  /**
   * Digitally sign this transaction using an Ed25519 private key
   * @param {string|crypto.KeyObject} privateKey 
   * @param {string} [publicKeyHex] 
   * @returns {Transaction} this signed transaction
   */
  sign(privateKey, publicKeyHex = null) {
    return signTransaction(this, privateKey, publicKeyHex);
  }

  /**
   * Verify digital signature of this transaction
   * @param {string|crypto.KeyObject} [publicKey] 
   * @returns {{ valid: boolean, reason?: string }}
   */
  verify(publicKey = null) {
    return verifyTransactionSignature(this, publicKey || this.senderPublicKey);
  }

  /**
   * Produce standard serialization format
   */
  toJSON() {
    return {
      transactionId: this.transactionId,
      version: this.version,
      type: this.type,
      sender: this.sender,
      senderPublicKey: this.senderPublicKey,
      receiver: this.receiver,
      payload: this.payload,
      timestamp: this.timestamp,
      nonce: this.nonce,
      signature: this.signature,
      // Compatibility aliases
      id: this.transactionId,
      beneficiaryId: this.beneficiaryId,
      shopId: this.shopId,
      commodity: this.commodity,
      quantity: this.quantity,
      unit: this.unit,
      name: this.name,
      status: this.status
    };
  }

  /**
   * Format for block inclusion
   */
  toBlockPayload() {
    return {
      transactionId: this.transactionId,
      version: this.version,
      type: this.type,
      sender: this.sender,
      senderPublicKey: this.senderPublicKey,
      receiver: this.receiver,
      beneficiaryId: this.beneficiaryId,
      shopId: this.shopId,
      name: this.name,
      commodity: this.commodity,
      quantity: typeof this.quantity === 'number' ? `${this.quantity} ${this.unit}` : this.quantity,
      timestamp: this.timestamp,
      nonce: this.nonce,
      signature: this.signature,
      consensusRound: (this.payload && this.payload.consensusRound) || null,
      validators: (this.payload && this.payload.validators) || null,
      payload: this.payload
    };
  }

  /**
   * Factory method: instantiate from plain JSON or database object
   */
  static fromJSON(data) {
    if (data instanceof Transaction) return data;
    return new Transaction(data);
  }

  /**
   * Factory method: instantiate from PDS grain distribution data
   */
  static fromPDS({
    transactionId,
    beneficiaryId,
    shopId,
    commodity,
    quantity,
    name,
    timestamp,
    nonce = 0,
    signature = null,
    senderPublicKey = null,
    consensusRound,
    validators
  }) {
    return new Transaction({
      transactionId,
      type: 'DISTRIBUTION',
      sender: beneficiaryId,
      senderPublicKey,
      beneficiaryId,
      receiver: shopId,
      shopId,
      payload: {
        beneficiaryId,
        shopId,
        commodity,
        quantity: parseFloat(quantity),
        unit: 'KG',
        name: name || '',
        consensusRound,
        validators
      },
      timestamp: timestamp || new Date().toISOString(),
      nonce,
      signature
    });
  }
}

module.exports = Transaction;
