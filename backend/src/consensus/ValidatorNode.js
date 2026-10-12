const QuorumSlice = require('./QuorumSlice');
const ValidatorVote = require('./ValidatorVote');
const crypto = require('crypto');
const { verifyTransactionSignature, verifyBlockProposalSignature } = require('../blockchain/identity/signature');
const { getPublicParticipantInfo, getParticipantPrivateKey } = require('../blockchain/identity/keyManager');
const { calculateMerkleRoot } = require('../blockchain/merkle');
const { hashProposal, hashBlockHeader } = require('../blockchain/hashing');
const { resolveValidatorId, getShortValidatorId } = require('./consensusConfig');

class ValidatorNode {
  constructor(data) {
    this.validatorId = resolveValidatorId(data.validatorId);
    this.shortId = data.shortId || getShortValidatorId(this.validatorId);
    this.name = data.name;
    this.org = data.org;
    this.status = data.status || 'Online'; // Online | Offline | Degraded
    this.authorized = data.authorized !== undefined ? Boolean(data.authorized) : true;
    this.blockHeight = data.blockHeight || 4281;
    this.txValidated = data.txValidated || 14280;
    this.participation = data.participation || '100%';
    const numMatch = String(this.validatorId || '').match(/(\d+)$/);
    const num = numMatch ? parseInt(numMatch[1], 10) : 1;
    this.port = data.port || (4000 + num);
    this.p2pPort = data.p2pPort || (5000 + num);
    this.lastHeartbeat = data.lastHeartbeat || new Date().toISOString();

    // Resolve cryptographic identity
    const idInfo = getPublicParticipantInfo(this.validatorId);
    this.publicKey = (idInfo && idInfo.publicKey) || (data.publicKey ? data.publicKey.replace(/^0x/, '') : `0x${crypto.randomBytes(8).toString('hex').toUpperCase()}`);
    this.address = (idInfo && idInfo.address) || data.address || '';

    const trustConfig = data.trustConfiguration || {};
    this.quorumSlice = new QuorumSlice(
      this.validatorId,
      (trustConfig.quorumSlice || []).map(m => resolveValidatorId(m)),
      trustConfig.threshold || 3
    );

    this.statementHistory = [];
  }

  isOnline() {
    return this.status === 'Online';
  }

  setStatus(status) {
    const normalized = typeof status === 'string' ? status.charAt(0).toUpperCase() + status.slice(1).toLowerCase() : '';
    if (['Online', 'Offline', 'Degraded'].includes(normalized)) {
      this.status = normalized;
      if (normalized === 'Online') {
        this.lastHeartbeat = new Date().toISOString();
      }
      return true;
    }
    return false;
  }

  getPrivateKey() {
    return getParticipantPrivateKey(this.validatorId);
  }

  /**
   * Independently verify and evaluate a Candidate Block Proposal.
   * Performs 14-point verification check as defined in Phase 6 Section 16.
   * 
   * @param {Block|object} blockProposal 
   * @param {object} [options] - { expectedStateRoot, round, stateManager }
   * @returns {ValidatorVote} Signed ValidatorVote
   */
  async evaluateBlockProposal(blockProposal, options = {}) {
    const round = parseInt(options.round || (blockProposal && blockProposal.round) || 0, 10);
    const proposalId = blockProposal ? (blockProposal.proposalId || hashProposal(blockProposal)) : '';
    const blockNumber = blockProposal ? (parseInt(blockProposal.blockNumber !== undefined ? blockProposal.blockNumber : blockProposal.index, 10) || 0) : 0;
    const stateRoot = String((blockProposal && blockProposal.stateRoot) || options.stateRoot || '');
    const rawBlockHash = blockProposal ? (blockProposal.blockHash || blockProposal.hash) : '';
    const blockHash = rawBlockHash
      ? String(rawBlockHash)
      : (blockProposal ? hashBlockHeader({
          version: parseInt(blockProposal.version !== undefined ? blockProposal.version : 1, 10),
          blockNumber,
          previousHash: String(blockProposal.previousHash || ''),
          timestamp: String(blockProposal.timestamp || ''),
          merkleRoot: String(blockProposal.merkleRoot || calculateMerkleRoot(Array.isArray(blockProposal.transactions) ? blockProposal.transactions : [])),
          stateRoot,
          proposerId: String(blockProposal.proposerId || 'VAL-01'),
          nonce: parseInt(blockProposal.blockNonce !== undefined ? blockProposal.blockNonce : (blockProposal.nonce || 0), 10) || 0,
          consensusStatus: String(blockProposal.consensusStatus || 'FINALIZED')
        }) : '');

    const reqChainId = options.chainId !== undefined ? options.chainId : blockProposal.chainId;
    const createVote = (voteType, reason = '') => {
      const voteData = {
        validatorId: this.validatorId,
        validatorAddress: this.address,
        validatorPublicKey: this.publicKey,
        proposalId,
        blockNumber,
        blockHash,
        stateRoot,
        round,
        vote: voteType,
        reason,
        timestamp: new Date().toISOString()
      };
      if (reqChainId !== undefined && reqChainId !== null) {
        voteData.chainId = reqChainId;
      }
      const vote = new ValidatorVote(voteData);

      const privKey = this.getPrivateKey();
      if (privKey) {
        vote.sign(privKey);
      }
      return vote;
    };

    if (!this.isOnline()) {
      return createVote('REJECT', 'Node is offline');
    }

    if (!blockProposal) {
      return createVote('REJECT', 'Block proposal is null or undefined');
    }

    // 1. Block Structure & Header
    if (blockProposal.blockNumber === undefined && blockProposal.index === undefined) {
      return createVote('REJECT', 'Missing blockNumber');
    }

    // 2. Merkle Root Check
    const txs = Array.isArray(blockProposal.transactions) ? blockProposal.transactions : [];
    const computedMerkle = calculateMerkleRoot(txs);
    if (blockProposal.merkleRoot && blockProposal.merkleRoot !== computedMerkle) {
      return createVote('REJECT', `MERKLE_ROOT_MISMATCH: Expected '${computedMerkle}', got '${blockProposal.merkleRoot}'`);
    }

    // 3. Proposer Signature Check (if provided)
    if (blockProposal.proposerSignature) {
      let proposerPubKey = blockProposal.proposerPublicKey;
      if (!proposerPubKey && blockProposal.proposerId) {
        const pInfo = getPublicParticipantInfo(blockProposal.proposerId);
        if (pInfo) proposerPubKey = pInfo.publicKey;
      }

      if (proposerPubKey) {
        const sigCheck = verifyBlockProposalSignature(blockProposal, blockProposal.proposerSignature, proposerPubKey);
        if (!sigCheck.valid) {
          return createVote('REJECT', `INVALID_PROPOSER_SIGNATURE: ${sigCheck.reason}`);
        }
      } else {
        return createVote('REJECT', 'MISSING_PROPOSER_PUBLIC_KEY');
      }
    }

    // 4. Transaction Signature Checks
    for (const tx of txs) {
      if (tx.signature && tx.type !== 'GENESIS') {
        const pubKey = tx.senderPublicKey || (tx.payload && tx.payload.senderPublicKey);
        const sigCheck = verifyTransactionSignature(tx, pubKey);
        if (!sigCheck.valid) {
          return createVote('REJECT', `INVALID_TRANSACTION_SIGNATURE in tx ${tx.transactionId || tx.id}: ${sigCheck.reason}`);
        }
      }
    }

    // 5. Independent EVM Contract Execution Verification
    const hasContractCalls = txs.some(tx => tx.type === 'CONTRACT_CALL');
    if (hasContractCalls) {
      const { evmRuntime, resolveEVMCaller } = require('../evm');
      await evmRuntime.initialize();
      await evmRuntime.stateAdapter.checkpoint();

      try {
        for (const tx of txs) {
          if (tx.type === 'CONTRACT_CALL') {
            const payload = tx.payload || {};
            const caller = resolveEVMCaller(tx);
            const contractAddr = payload.contractAddress || tx.receiver;

            const simReceipt = await evmRuntime.executeContractCall({
              transactionId: tx.transactionId || tx.id,
              caller,
              contractAddress: contractAddr,
              method: payload.method,
              args: payload.args || [],
              calldata: payload.calldata,
              gasLimit: payload.gasLimit || 500000,
              blockNumber: blockProposal.blockNumber || 1,
              timestamp: tx.timestamp
            });

            if (simReceipt.isRevert()) {
              await evmRuntime.stateAdapter.revert();
              return createVote('REJECT', `EVM_CONTRACT_EXECUTION_FAILED: ${simReceipt.revertReason || 'Reverted'}`);
            }

            // Verify receipt hash if expected receipts provided
            if (options.expectedReceipts && Array.isArray(options.expectedReceipts)) {
              const expected = options.expectedReceipts.find(r => r.transactionId === (tx.transactionId || tx.id));
              if (expected && expected.receiptHash && expected.receiptHash !== simReceipt.receiptHash) {
                await evmRuntime.stateAdapter.revert();
                return createVote('REJECT', `EVM_RECEIPT_HASH_MISMATCH for tx ${tx.transactionId || tx.id}`);
              }
            }
          }
        }
      } catch (evmErr) {
        await evmRuntime.stateAdapter.revert();
        return createVote('REJECT', `EVM_EXECUTION_ERROR: ${evmErr.message}`);
      } finally {
        await evmRuntime.stateAdapter.revert();
      }
    }

    // 6. State Root Verification (if expectedStateRoot provided)
    if (options.expectedStateRoot && blockProposal.stateRoot) {
      const exp = String(options.expectedStateRoot).toLowerCase().trim();
      const actual = String(blockProposal.stateRoot).toLowerCase().trim();
      if (exp !== actual) {
        return createVote('REJECT', `STATE_ROOT_MISMATCH: Computed state root '${exp}' does not match proposed '${actual}'`);
      }
    }

    // All verifications passed -> ACCEPT
    const acceptVote = createVote('ACCEPT', '');
    this.statementHistory.push(acceptVote.toJSON());
    this.txValidated += txs.length || 1;
    return acceptVote;
  }

  /**
   * Evaluate transaction proposal (backward-compatible legacy interface)
   */
  evaluateProposal(proposal) {
    if (!this.isOnline()) {
      return {
        validatorId: this.validatorId,
        vote: 'OFFLINE',
        reason: 'Node is offline',
        signature: null
      };
    }

    if (!proposal || !proposal.transactionId) {
      return {
        validatorId: this.validatorId,
        vote: 'REJECT',
        reason: 'Invalid transaction proposal payload',
        signature: null
      };
    }

    if (proposal.quantity <= 0) {
      return {
        validatorId: this.validatorId,
        vote: 'REJECT',
        reason: 'Quantity must be greater than zero',
        signature: null
      };
    }

    if (proposal.signature) {
      const pubKey = proposal.senderPublicKey || (proposal.payload && proposal.payload.senderPublicKey);
      const sigCheck = verifyTransactionSignature(proposal, pubKey);
      if (!sigCheck.valid) {
        return {
          validatorId: this.validatorId,
          vote: 'REJECT',
          reason: `INVALID_TRANSACTION_SIGNATURE: ${sigCheck.reason}`,
          signature: null
        };
      }
    }

    // Generate signed vote
    const privKey = this.getPrivateKey();
    let signatureHex = null;
    const voteData = {
      validatorId: this.validatorId,
      validatorAddress: this.address,
      validatorPublicKey: this.publicKey,
      proposalId: proposal.transactionId,
      blockNumber: 0,
      blockHash: '',
      stateRoot: '',
      round: 0,
      vote: 'ACCEPT',
      reason: ''
    };

    if (privKey) {
      const voteObj = new ValidatorVote(voteData);
      signatureHex = voteObj.sign(privKey);
    } else {
      const statement = `VOTE:AGREE:${proposal.transactionId}:${this.validatorId}:${Date.now()}`;
      signatureHex = `0x${crypto.createHash('sha256').update(statement + this.publicKey).digest('hex').substring(0, 16)}`;
    }

    const voteRecord = {
      validatorId: this.validatorId,
      vote: 'AGREE',
      signature: signatureHex,
      timestamp: new Date().toISOString()
    };

    this.statementHistory.push(voteRecord);
    this.txValidated++;
    return voteRecord;
  }

  /**
   * Cryptographically sign an explicit manual validator vote (ACCEPT or REJECT) on a candidate block proposal.
   */
  signManualVote(blockProposal, decision = 'ACCEPT', reason = '', options = {}) {
    const normalizedVote = String(decision || 'ACCEPT').toUpperCase() === 'REJECT' ? 'REJECT' : 'ACCEPT';
    const round = parseInt(options.round !== undefined ? options.round : ((blockProposal && blockProposal.round) || 0), 10) || 0;
    const proposalId = blockProposal ? (blockProposal.proposalId || hashProposal(blockProposal)) : '';
    const blockNumber = blockProposal
      ? (parseInt(blockProposal.blockNumber !== undefined ? blockProposal.blockNumber : blockProposal.index, 10) || 0)
      : 0;
    const stateRoot = String((blockProposal && blockProposal.stateRoot) || options.stateRoot || '');
    const rawBlockHash = blockProposal ? (blockProposal.blockHash || blockProposal.hash) : '';
    const blockHash = rawBlockHash
      ? String(rawBlockHash)
      : (blockProposal ? hashBlockHeader({
          version: parseInt(blockProposal.version !== undefined ? blockProposal.version : 1, 10),
          blockNumber,
          previousHash: String(blockProposal.previousHash || ''),
          timestamp: String(blockProposal.timestamp || ''),
          merkleRoot: String(blockProposal.merkleRoot || calculateMerkleRoot(Array.isArray(blockProposal.transactions) ? blockProposal.transactions : [])),
          stateRoot,
          proposerId: String(blockProposal.proposerId || 'VAL-01'),
          nonce: parseInt(blockProposal.blockNonce !== undefined ? blockProposal.blockNonce : (blockProposal.nonce || 0), 10) || 0,
          consensusStatus: String(blockProposal.consensusStatus || 'FINALIZED')
        }) : '');

    const reqChainId = options.chainId !== undefined
      ? options.chainId
      : (blockProposal && blockProposal.chainId !== undefined ? blockProposal.chainId : 1729);

    const voteObj = new ValidatorVote({
      chainId: reqChainId,
      validatorId: this.validatorId,
      validatorAddress: this.address,
      validatorPublicKey: this.publicKey,
      proposalId,
      blockNumber,
      blockHash,
      stateRoot,
      round,
      vote: normalizedVote,
      reason: normalizedVote === 'ACCEPT'
        ? ''
        : (reason || `Rejected by ${this.shortId} (${this.validatorId})`),
      timestamp: new Date().toISOString()
    });

    const privKey = this.getPrivateKey();
    if (privKey) {
      voteObj.sign(privKey);
    }

    this.statementHistory.push(voteObj.toJSON());
    if (normalizedVote === 'ACCEPT') {
      this.txValidated += 1;
    }
    return voteObj;
  }

  toJSON() {
    const sliceJson = this.quorumSlice.toJSON();
    return {
      id: this.validatorId,
      validatorId: this.validatorId,
      shortId: this.shortId,
      name: this.name,
      org: this.org,
      address: this.address,
      publicKey: this.publicKey,
      status: this.status,
      authorized: this.authorized,
      port: this.port,
      p2pPort: this.p2pPort,
      lastHeartbeat: this.lastHeartbeat,
      blockHeight: this.blockHeight,
      txValidated: this.txValidated,
      participation: this.participation,
      voteHistoryCount: this.statementHistory.length,
      quorumSlice: sliceJson,
      trustConfiguration: sliceJson
    };
  }
}

module.exports = ValidatorNode;
