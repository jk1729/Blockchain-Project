/**
 * PDSChain Proof Indexer (Phase 16 - Stage H)
 * 
 * Read-optimized in-memory index for sub-millisecond Merkle proof generation.
 * Derived from authoritative blockchain state; 100% rebuildable.
 */

const { MerkleTree } = require('./MerkleTree');
const { MERKLE_ERROR_CODES, MerkleError } = require('./MerkleErrors');

class ProofIndexer {
  constructor(options = {}) {
    this.status = 'READY'; // 'READY' | 'SYNCING' | 'REBUILDING' | 'DEGRADED'
    this.txMap = new Map(); // txHash/txId -> { blockNumber, blockHash, txIndex, txId, merkleRoot, version, finality }
    this.receiptMap = new Map(); // txHash -> { blockNumber, blockHash, txIndex, receiptIndex, receiptHash, receiptsRoot, finality }
    this.eventMap = new Map(); // eventId -> { blockNumber, blockHash, txHash, txIndex, logIndex, receiptsRoot, finality }
    this.blockMap = new Map(); // blockNumber -> block
    this.lastRebuildTime = null;
    this.metrics = options.metrics || null;
  }

  setStatus(status) {
    this.status = status;
  }

  isReady() {
    return this.status === 'READY';
  }

  /**
   * Idempotently index a finalized or committed block.
   * @param {object} block 
   */
  indexBlock(block) {
    if (!block) return;
    const bNum = block.blockNumber !== undefined ? block.blockNumber : block.index;
    const bHash = block.blockHash || block.hash;
    const finality = block.consensusStatus || 'FINALIZED';
    const version = block.version || 1;
    const merkleRoot = block.merkleRoot;
    const receiptsRoot = block.receiptsRoot || null;

    this.blockMap.set(bNum, block);

    // Index transactions
    const txs = block.transactions || [];
    for (let i = 0; i < txs.length; i++) {
      const tx = txs[i];
      const txId = tx.transactionId || tx.id || tx.txId || tx.hash;
      const txHash = tx.hash || txId;

      const record = {
        blockNumber: bNum,
        blockHash: bHash,
        txIndex: i,
        txId,
        txHash,
        merkleRoot,
        version,
        finality
      };

      if (txId) this.txMap.set(txId, record);
      if (txHash && txHash !== txId) this.txMap.set(txHash, record);
    }

    // Index execution receipts
    const receipts = block.executionReceipts || [];
    for (let r = 0; r < receipts.length; r++) {
      const rec = receipts[r];
      const rTxId = rec.transactionId || (txs[r] && (txs[r].transactionId || txs[r].id || txs[r].hash));
      const rHash = rec.receiptHash || null;

      const recRecord = {
        blockNumber: bNum,
        blockHash: bHash,
        txIndex: r,
        receiptIndex: r,
        transactionId: rTxId,
        receiptHash: rHash,
        receiptsRoot,
        version,
        finality
      };

      if (rTxId) this.receiptMap.set(rTxId, recRecord);
      if (rHash) this.receiptMap.set(rHash, recRecord);

      // Index logs inside receipt
      const logs = rec.logs || [];
      for (let l = 0; l < logs.length; l++) {
        const log = logs[l];
        const evtId = log.eventId || `evt_${bNum}_${r}_${l}`;
        this.eventMap.set(evtId, {
          eventId: evtId,
          blockNumber: bNum,
          blockHash: bHash,
          txHash: rTxId,
          txIndex: r,
          logIndex: l,
          receiptHash: rHash,
          receiptsRoot,
          finality
        });
      }
    }

    if (this.metrics) {
      this.metrics.setIndexedCounts(this.txMap.size, this.receiptMap.size, this.eventMap.size);
    }
  }

  /**
   * Complete rebuild of the index from the authoritative blockchain.
   * @param {Array<object>} chain 
   */
  rebuild(chain) {
    this.setStatus('REBUILDING');
    this.txMap.clear();
    this.receiptMap.clear();
    this.eventMap.clear();
    this.blockMap.clear();

    try {
      if (Array.isArray(chain)) {
        for (const block of chain) {
          this.indexBlock(block);
        }
      }
      this.lastRebuildTime = new Date().toISOString();
      this.setStatus('READY');
      if (this.metrics) this.metrics.incrementReindex(true);
      return { success: true, indexedBlocks: this.blockMap.size, indexedTxs: this.txMap.size };
    } catch (err) {
      this.setStatus('DEGRADED');
      if (this.metrics) this.metrics.incrementReindex(false);
      throw err;
    }
  }

  getTransactionRecord(txIdOrHash) {
    return this.txMap.get(txIdOrHash) || null;
  }

  getReceiptRecord(identifier) {
    return this.receiptMap.get(identifier) || null;
  }

  getEventRecord(eventId) {
    return this.eventMap.get(eventId) || null;
  }

  getBlock(blockNumber) {
    return this.blockMap.get(Number(blockNumber)) || null;
  }

  /**
   * Generate an inclusion proof for a transaction by identifier.
   */
  generateTransactionProof(txIdentifier, blockchain = null) {
    if (this.status === 'SYNCING') {
      throw new MerkleError(MERKLE_ERROR_CODES.NODE_SYNCING, 'Proof indexer unavailable: node is synchronizing');
    }
    if (this.status === 'REBUILDING') {
      throw new MerkleError(MERKLE_ERROR_CODES.RECOVERY_REQUIRED, 'Proof indexer unavailable: index rebuild in progress');
    }

    let record = this.getTransactionRecord(txIdentifier);
    let block = null;

    if (record) {
      block = this.getBlock(record.blockNumber);
    }

    // Fallback: search blockchain if not in index or block not cached
    if ((!record || !block) && blockchain && Array.isArray(blockchain.chain)) {
      for (const b of blockchain.chain) {
        const txs = b.transactions || [];
        for (let i = 0; i < txs.length; i++) {
          const t = txs[i];
          const tid = t.transactionId || t.id || t.txId || t.hash;
          if (tid === txIdentifier || t.hash === txIdentifier) {
            record = {
              blockNumber: b.blockNumber !== undefined ? b.blockNumber : b.index,
              blockHash: b.blockHash || b.hash,
              txIndex: i,
              txId: tid,
              txHash: t.hash || tid,
              merkleRoot: b.merkleRoot,
              version: b.version || 1,
              finality: b.consensusStatus || 'FINALIZED'
            };
            block = b;
            break;
          }
        }
        if (record) break;
      }
    }

    if (!record || !block) {
      if (this.metrics) this.metrics.incrementIndexMiss();
      throw new MerkleError(
        MERKLE_ERROR_CODES.PROOF_NOT_FOUND,
        `Transaction '${txIdentifier}' not found in any finalized or committed block`
      );
    }

    if (this.metrics) this.metrics.incrementIndexHit();

    const txs = block.transactions || [];
    const tree = new MerkleTree(txs, {
      version: record.version || 1,
      commitmentType: 'TRANSACTION'
    });

    const proof = tree.getProof(record.txIndex, {
      blockHeight: record.blockNumber,
      blockHash: record.blockHash,
      transactionHash: record.txHash,
      finality: record.finality
    });

    return proof;
  }

  /**
   * Generate an inclusion proof for a receipt.
   */
  generateReceiptProof(identifier, blockchain = null) {
    if (this.status === 'SYNCING') {
      throw new MerkleError(MERKLE_ERROR_CODES.NODE_SYNCING, 'Proof indexer unavailable: node is synchronizing');
    }

    let record = this.getReceiptRecord(identifier);
    let block = null;

    if (record) {
      block = this.getBlock(record.blockNumber);
    }

    if ((!record || !block) && blockchain && Array.isArray(blockchain.chain)) {
      for (const b of blockchain.chain) {
        const receipts = b.executionReceipts || [];
        for (let r = 0; r < receipts.length; r++) {
          const rec = receipts[r];
          if (rec.transactionId === identifier || rec.receiptHash === identifier) {
            record = {
              blockNumber: b.blockNumber !== undefined ? b.blockNumber : b.index,
              blockHash: b.blockHash || b.hash,
              receiptIndex: r,
              txIndex: r,
              receiptHash: rec.receiptHash,
              receiptsRoot: b.receiptsRoot,
              version: b.version || 1,
              finality: b.consensusStatus || 'FINALIZED'
            };
            block = b;
            break;
          }
        }
        if (record) break;
      }
    }

    if (!record || !block) {
      throw new MerkleError(
        MERKLE_ERROR_CODES.PROOF_NOT_FOUND,
        `Receipt for '${identifier}' not found in any block`
      );
    }

    if (!block.receiptsRoot) {
      throw new MerkleError(
        MERKLE_ERROR_CODES.COMMITMENT_MISMATCH,
        `Block #${record.blockNumber} does not contain an authoritative receiptsRoot commitment`
      );
    }

    const receipts = block.executionReceipts || [];
    const tree = new MerkleTree(receipts, {
      version: record.version || 1,
      commitmentType: 'RECEIPT'
    });

    const proof = tree.getProof(record.receiptIndex, {
      blockHeight: record.blockNumber,
      blockHash: record.blockHash,
      transactionHash: record.transactionId || identifier,
      finality: record.finality
    });

    return proof;
  }

  /**
   * Generate an inclusion proof for an event log.
   */
  generateEventProof(eventId, blockchain = null) {
    const record = this.getEventRecord(eventId);
    if (!record) {
      throw new MerkleError(
        MERKLE_ERROR_CODES.PROOF_NOT_FOUND,
        `Event '${eventId}' not found in proof index`
      );
    }

    // Event proof returns receipt proof of the parent receipt containing the event log
    const receiptProof = this.generateReceiptProof(record.receiptHash || record.txHash, blockchain);
    
    return {
      eventId: record.eventId,
      logIndex: record.logIndex,
      blockHeight: record.blockNumber,
      blockHash: record.blockHash,
      receiptProof: receiptProof.toJSON(),
      receiptsRoot: record.receiptsRoot,
      finality: record.finality,
      description: 'Event log inclusion proven via parent receipt commitment in block receiptsRoot'
    };
  }

  getStatus() {
    return {
      status: this.status,
      indexedBlocks: this.blockMap.size,
      indexedTransactions: this.txMap.size,
      indexedReceipts: this.receiptMap.size,
      indexedEvents: this.eventMap.size,
      lastRebuildTimestamp: this.lastRebuildTime
    };
  }
}

module.exports = ProofIndexer;

