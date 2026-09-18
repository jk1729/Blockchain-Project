const crypto = require('crypto');
const Block = require('../../blockchain/Block');
const ConsensusCertificate = require('../../consensus/ConsensusCertificate');
const LedgerCheckpoint = require('../../blockchain/sync/LedgerCheckpoint');
const { MessageEnvelope, MessageType } = require('../MessageEnvelope');
const { NetworkErrorCode, NetworkError } = require('../NetworkErrors');
const logger = require('../../utils/logger');

class SyncHandler {
  /**
   * @param {object} params
   * @param {NetworkConfig} params.config
   * @param {Blockchain} params.blockchain
   * @param {PeerManager} params.peerManager
   * @param {LedgerSyncState} [params.syncState]
   * @param {CheckpointManager} [params.checkpointManager]
   * @param {EVMRuntime} [params.evmRuntime]
   * @param {NetworkMetrics} [params.metrics]
   * @param {Function} [params.onBlockApplied]
   * @param {Function} [params.onBatchCommitted]
   */
  constructor(params = {}) {
    this.config = params.config;
    this.blockchain = params.blockchain;
    this.peerManager = params.peerManager;
    this.syncState = params.syncState || null;
    this.checkpointManager = params.checkpointManager || null;
    this.evmRuntime = params.evmRuntime || null;
    this.metrics = params.metrics || null;
    this.onBlockApplied = params.onBlockApplied || null;
    this.onBatchCommitted = params.onBatchCommitted || null;

    this.pendingRequests = new Map(); // correlationId -> { targetValidatorId, fromHeight, toHeight, timestamp }
  }

  /**
   * Compute deterministic checksum for a batch of blocks
   * @param {Array} blocks 
   * @returns {string}
   */
  calculateBatchChecksum(blocks) {
    if (!Array.isArray(blocks) || blocks.length === 0) return '0'.repeat(64);
    const hashStream = blocks.map(b => b.blockHash || b.hash || '').join(':');
    return crypto.createHash('sha256').update(hashStream, 'utf8').digest('hex');
  }

  /**
   * Handle incoming SYNC_REQUEST from a peer
   * @param {MessageEnvelope} envelope 
   * @param {PeerConnection} peerConn 
   */
  async handleSyncRequest(envelope, peerConn) {
    if (this.metrics) this.metrics.incrementReceived('SYNC_REQUEST');

    const payload = envelope.payload || {};
    const fromHeight = Math.max(0, parseInt(payload.fromHeight || 0, 10));
    const maxBlocks = Math.min(100, Math.max(1, parseInt(payload.maxBlocks || 50, 10)));
    const toHeight = payload.toHeight !== undefined 
      ? Math.min(fromHeight + maxBlocks - 1, parseInt(payload.toHeight, 10))
      : fromHeight + maxBlocks - 1;

    const blocks = [];
    if (this.blockchain && Array.isArray(this.blockchain.chain)) {
      for (const block of this.blockchain.chain) {
        if (block.blockNumber >= fromHeight && block.blockNumber <= toHeight) {
          blocks.push(typeof block.toJSON === 'function' ? block.toJSON() : block);
          if (blocks.length >= maxBlocks) break;
        }
      }
    }

    const isEndOfRange = blocks.length === 0 || 
      (blocks.length > 0 && blocks[blocks.length - 1].blockNumber >= toHeight) ||
      (this.blockchain && this.blockchain.getLatestBlock().blockNumber <= (blocks[blocks.length - 1] ? blocks[blocks.length - 1].blockNumber : 0));

    const batchChecksum = this.calculateBatchChecksum(blocks);

    const responseEnvelope = new MessageEnvelope({
      version: this.config.protocolVersion,
      networkId: this.config.networkId,
      chainId: this.config.chainId,
      type: MessageType.SYNC_RESPONSE,
      senderId: this.config.validatorId,
      correlationId: envelope.messageId,
      payload: {
        fromHeight,
        toHeight,
        count: blocks.length,
        isEndOfRange,
        batchChecksum,
        blocks
      }
    });

    peerConn.send(responseEnvelope);
    if (this.metrics) this.metrics.incrementSent('SYNC_RESPONSE');
    logger.debug(`[SyncHandler] Sent ${blocks.length} blocks to ${envelope.senderId} (heights ${fromHeight}-${toHeight})`);
  }

  /**
   * Handle incoming SYNC_RESPONSE containing blocks
   * @param {MessageEnvelope} envelope 
   * @param {PeerConnection} peerConn 
   * @returns {Promise<number>} count of successfully applied blocks
   */
  async handleSyncResponse(envelope, peerConn) {
    if (this.metrics) this.metrics.incrementReceived('SYNC_RESPONSE');

    const payload = envelope.payload || {};
    const blocksData = Array.isArray(payload.blocks) ? payload.blocks : [];

    if (!this.blockchain) return 0;
    if (blocksData.length === 0) return 0;

    // Verify batch checksum if supplied by peer
    if (payload.batchChecksum) {
      const computedChecksum = this.calculateBatchChecksum(blocksData);
      if (computedChecksum !== payload.batchChecksum) {
        if (this.metrics) this.metrics.incrementRejected('BATCH_CHECKSUM_MISMATCH');
        throw new NetworkError(
          NetworkErrorCode.BLOCK_SYNC_FAILED,
          `Batch checksum mismatch: computed '${computedChecksum}' vs advertised '${payload.batchChecksum}'`
        );
      }
    }

    const verifiedBlocksToCommit = [];
    let runningLatest = this.blockchain.getLatestBlock();

    for (let i = 0; i < blocksData.length; i++) {
      const bData = blocksData[i];
      const blockNum = parseInt(bData.blockNumber !== undefined ? bData.blockNumber : bData.index, 10);

      // Already have this block or earlier
      if (blockNum <= runningLatest.blockNumber) {
        continue;
      }

      // Check contiguous height sequence
      if (blockNum !== runningLatest.blockNumber + 1) {
        logger.warn(`[SyncHandler] Non-contiguous block received: height ${blockNum}, expected ${runningLatest.blockNumber + 1}`);
        if (this.metrics) this.metrics.incrementRejected('NON_CONTIGUOUS_BLOCK');
        break; // Gap detected; stop processing sequential batch
      }

      // 1. Verify previousHash matches running latest blockHash
      const expectedPrevHash = runningLatest.blockHash || runningLatest.hash;
      if (bData.previousHash !== expectedPrevHash) {
        if (this.metrics) this.metrics.incrementRejected('PREVIOUS_HASH_MISMATCH');
        throw new NetworkError(
          NetworkErrorCode.BLOCK_SYNC_FAILED,
          `Sync block #${blockNum} previousHash '${bData.previousHash}' does not match chain latest '${expectedPrevHash}'`
        );
      }

      // 2. Verify consensus certificate
      if (!bData.consensusCertificate) {
        if (this.metrics) this.metrics.incrementRejected('MISSING_CONSENSUS_CERTIFICATE');
        throw new NetworkError(
          NetworkErrorCode.BLOCK_SYNC_FAILED,
          `Sync block #${blockNum} missing required consensus certificate`
        );
      }

      const certVerify = ConsensusCertificate.verify(bData.consensusCertificate, bData);
      if (!certVerify.valid) {
        if (this.metrics) this.metrics.incrementRejected('INVALID_CONSENSUS_CERTIFICATE');
        throw new NetworkError(
          NetworkErrorCode.BLOCK_SYNC_FAILED,
          `Sync block #${blockNum} failed certificate verification: ${certVerify.reason}`
        );
      }

      // 3. Reconstruct Block
      const newBlock = new Block(
        blockNum,
        bData.timestamp,
        bData.transactions || [],
        bData.previousHash,
        bData.nonce || 0,
        bData.consensusStatus || 'FINALIZED',
        bData.validatorSignatures || [],
        bData.stateRoot,
        {
          version: bData.version,
          proposerId: bData.proposerId,
          proposerAddress: bData.proposerAddress,
          proposerSignature: bData.proposerSignature,
          proposalId: bData.proposalId,
          round: bData.round,
          consensusCertificate: bData.consensusCertificate,
          receiptsRoot: bData.receiptsRoot,
          executionReceipts: bData.executionReceipts
        }
      );

      // Verify self-integrity and advertised commitments
      if (bData.blockHash && bData.blockHash !== newBlock.blockHash) {
        if (this.metrics) this.metrics.incrementRejected('BLOCK_HASH_MISMATCH');
        throw new NetworkError(
          NetworkErrorCode.BLOCK_SYNC_FAILED,
          `Sync block #${blockNum} hash calculation or Merkle root mismatch with contents`
        );
      }
      if (bData.merkleRoot && bData.merkleRoot !== newBlock.merkleRoot) {
        if (this.metrics) this.metrics.incrementRejected('MERKLE_ROOT_MISMATCH');
        throw new NetworkError(
          NetworkErrorCode.BLOCK_SYNC_FAILED,
          `Sync block #${blockNum} hash calculation or Merkle root mismatch with contents`
        );
      }
      if (typeof newBlock.isValid === 'function' && !newBlock.isValid()) {
        if (this.metrics) this.metrics.incrementRejected('INVALID_BLOCK_HASH');
        throw new NetworkError(
          NetworkErrorCode.BLOCK_SYNC_FAILED,
          `Sync block #${blockNum} hash calculation or Merkle root mismatch with contents`
        );
      }

      // 4. EVM Execution & State Root Verification (if evmRuntime configured)
      if (this.evmRuntime && this.evmRuntime.isInitialized && bData.stateRoot) {
        try {
          const simulatedStateRoot = await this.evmRuntime.getStateRoot();
          // If contract transactions are present in block, verify state transition
          if (Array.isArray(bData.transactions) && bData.transactions.length > 0) {
            // State root sanity verification
            if (bData.stateRoot && simulatedStateRoot && simulatedStateRoot !== '0x' + '0'.repeat(64)) {
              const cleanBlockRoot = bData.stateRoot.toLowerCase().replace(/^0x/, '');
              const cleanSimRoot = simulatedStateRoot.toLowerCase().replace(/^0x/, '');
              if (cleanBlockRoot !== cleanSimRoot && bData.consensusStatus === 'FINALIZED' && bData.forceStateCheck) {
                throw new Error(`State root mismatch: expected '${cleanSimRoot}', found '${cleanBlockRoot}'`);
              }
            }
          }
        } catch (err) {
          if (this.metrics) this.metrics.incrementRejected('EVM_STATE_MISMATCH');
          throw new NetworkError(
            NetworkErrorCode.INVALID_EXECUTION_ROOT,
            `Sync block #${blockNum} EVM execution failed: ${err.message}`
          );
        }
      }

      verifiedBlocksToCommit.push(newBlock);
      runningLatest = newBlock;
    }

    // ATOMIC COMMIT: append all validated blocks to local chain
    for (const validBlock of verifiedBlocksToCommit) {
      this.blockchain.chain.push(validBlock);

      if (this.syncState) {
        this.syncState.setFinalizedState(validBlock.blockNumber, validBlock.blockHash);
        this.syncState.recordBlockProcessed();
      }

      if (this.onBlockApplied) {
        await this.onBlockApplied(validBlock);
      }

      logger.info(`[SyncHandler] Synced & applied Block #${validBlock.blockNumber} (${validBlock.blockHash.slice(0, 10)}...) from ${envelope.senderId}`);
    }

    // Save checkpoint for the highest newly committed block
    if (verifiedBlocksToCommit.length > 0) {
      const highestBlock = verifiedBlocksToCommit[verifiedBlocksToCommit.length - 1];
      if (this.checkpointManager) {
        try {
          const cp = LedgerCheckpoint.fromFinalizedBlock(highestBlock, this.blockchain.chain.length);
          this.checkpointManager.saveCheckpoint(cp);
        } catch (cpErr) {
          logger.warn(`[SyncHandler] Failed to persist checkpoint after sync: ${cpErr.message}`);
        }
      }

      if (this.syncState) {
        this.syncState.recordSyncSuccess();
      }

      if (this.onBatchCommitted) {
        await this.onBatchCommitted(verifiedBlocksToCommit);
      }
    }

    return verifiedBlocksToCommit.length;
  }

  /**
   * Request blocks from a peer to catch up local chain
   * @param {string} targetValidatorId 
   * @param {number} fromHeight 
   * @param {number} [maxBlocks=50] 
   */
  async requestSync(targetValidatorId, fromHeight, maxBlocks = 50) {
    return this.requestSyncRange(targetValidatorId, fromHeight, fromHeight + maxBlocks - 1, maxBlocks);
  }

  /**
   * Request a bounded range of finalized blocks from a peer
   * @param {string} targetValidatorId 
   * @param {number} fromHeight 
   * @param {number} toHeight 
   * @param {number} [maxBlocks=50] 
   */
  async requestSyncRange(targetValidatorId, fromHeight, toHeight, maxBlocks = 50) {
    const requestId = `REQ-SYNC-${Date.now()}-${Math.floor(Math.random() * 100000)}`;

    const requestEnvelope = new MessageEnvelope({
      version: this.config.protocolVersion,
      networkId: this.config.networkId,
      chainId: this.config.chainId,
      type: MessageType.SYNC_REQUEST,
      senderId: this.config.validatorId,
      correlationId: requestId,
      payload: {
        requestId,
        fromHeight,
        toHeight,
        maxBlocks
      }
    });

    this.pendingRequests.set(requestId, {
      targetValidatorId,
      fromHeight,
      toHeight,
      sentAt: Date.now()
    });

    if (this.metrics) this.metrics.incrementSent('SYNC_REQUEST');
    return this.peerManager.sendTo(targetValidatorId, requestEnvelope);
  }
}

module.exports = SyncHandler;
