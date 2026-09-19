/**
 * PDSChain EventStore (Phase 13)
 * 
 * Provides durable append-only event journaling, in-memory multi-index querying,
 * strict deduplication, and crash recovery.
 */

const fs = require('fs');
const path = require('path');
const { BlockchainEvent } = require('./BlockchainEvent');
const logger = require('../utils/logger');

const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 50;

class EventStore {
  /**
   * @param {object} [options]
   * @param {string} [options.filepath] - Path to events_journal.jsonl
   * @param {string} [options.journalPath]
   * @param {boolean} [options.inMemoryOnly=false]
   * @param {number} [options.maxInMemoryEvents=50000]
   */
  constructor(options = {}) {
    this.inMemoryOnly = options.inMemoryOnly || false;
    this.filepath = options.filepath || options.journalPath || null;
    this.maxInMemoryEvents = options.maxMemoryEvents || options.maxInMemoryEvents || 50000;
    this.eventBus = options.eventBus || null;
    if (this.eventBus) {
      this.eventBus.eventStore = this;
    }

    // Linear ordered events storage
    this.events = [];
    // Fast lookup index by eventId
    this.eventsById = new Map();
    // Deduplication registry: deduplicationKey -> eventId
    this.dedupKeys = new Map();
    this.lastPersistenceError = null;

    // Ensure journal directory exists if persistent
    if (!this.inMemoryOnly && this.filepath) {
      try {
        const dir = path.dirname(this.filepath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
      } catch (err) {
        logger.warn(`[EventStore] Could not create journal directory: ${err.message}. Falling back to inMemoryOnly.`);
        this.inMemoryOnly = true;
      }
    }
  }

  async initialize() {
    return this.recover();
  }

  close() {
    // Persistent journal is append-only sync
  }

  record(event) {
    this.lastPersistenceError = null;
    const ev = event instanceof BlockchainEvent ? event : new BlockchainEvent(event);
    ev.validate();
    if (this.eventsById.has(ev.eventId)) {
      const existing = this.eventsById.get(ev.eventId);
      const existingPayloadStr = JSON.stringify(existing.payload || {});
      const newPayloadStr = JSON.stringify(ev.payload || {});
      const isIdentical = (existingPayloadStr === newPayloadStr) &&
                          (existing.eventType === ev.eventType) &&
                          (existing.category === ev.category);
      if (!isIdentical) {
        const collisionErr = new Error(`[EventStore] Collision detected: Event ID '${ev.eventId}' already exists with conflicting payload.`);
        collisionErr.code = 'ERR_EVENT_COLLISION';
        this.lastPersistenceError = collisionErr;
        logger.error(collisionErr.message);
        return false;
      }
      return false;
    }
    const dedupKey = ev.getDeduplicationKey();
    if (this.dedupKeys.has(dedupKey)) {
      return false;
    }
    try {
      this.append(ev);
    } catch (err) {
      this.lastPersistenceError = err;
      return false;
    }
    if (this.lastPersistenceError) return false;
    if (this.eventBus && !this._publishing) {
      this._publishing = true;
      try {
        this.eventBus.publish(ev);
      } finally {
        this._publishing = false;
      }
    }
    return true;
  }

  /**
   * Append and persist a canonical event
   * @param {BlockchainEvent|object} event 
   * @returns {BlockchainEvent}
   */
  append(event) {
    const ev = event instanceof BlockchainEvent ? event : new BlockchainEvent(event);
    ev.validate();
    this.lastPersistenceError = null;

    // Check same-ID collisions
    if (this.eventsById.has(ev.eventId)) {
      const existing = this.eventsById.get(ev.eventId);
      const existingPayloadStr = JSON.stringify(existing.payload || {});
      const newPayloadStr = JSON.stringify(ev.payload || {});
      const isIdentical = (existingPayloadStr === newPayloadStr) &&
                          (existing.eventType === ev.eventType) &&
                          (existing.category === ev.category);
      if (isIdentical) {
        return existing;
      }
      const collisionErr = new Error(`[EventStore] Collision detected: Event ID '${ev.eventId}' already exists with conflicting payload.`);
      collisionErr.code = 'ERR_EVENT_COLLISION';
      this.lastPersistenceError = collisionErr;
      logger.error(collisionErr.message);
      throw collisionErr;
    }

    // Check deduplication
    const dedupKey = ev.getDeduplicationKey();
    if (this.dedupKeys.has(dedupKey)) {
      const existingId = this.dedupKeys.get(dedupKey);
      return this.eventsById.get(existingId);
    }

    // Persist to append-only journal file
    if (!this.inMemoryOnly && this.filepath) {
      try {
        const line = JSON.stringify(ev.toJSON()) + '\n';
        fs.appendFileSync(this.filepath, line, 'utf8');
      } catch (err) {
        this.lastPersistenceError = err;
        logger.error(`[EventStore] Failed to append event to journal: ${err.message}`);
        return ev;
      }
    }

    // Record in-memory only after durable persistence succeeds.
    this.events.push(ev);
    this.eventsById.set(ev.eventId, ev);
    this.dedupKeys.set(dedupKey, ev.eventId);

    if (this.events.length > this.maxInMemoryEvents) {
      const pruned = this.events.shift();
      if (pruned) {
        this.eventsById.delete(pruned.eventId);
        this.dedupKeys.delete(pruned.getDeduplicationKey());
      }
    }

    return ev;
  }

  /**
   * Query events with multi-criteria filters and pagination
   * @param {object} [filters]
   * @returns {{ events: BlockchainEvent[], total: number, nextCursor: number|null, hasMore: boolean }}
   */
  query(filters = {}) {
    const category = filters.category ? String(filters.category).toUpperCase().trim() : null;
    const eventType = (filters.eventType || filters.type) ? String(filters.eventType || filters.type).toUpperCase().trim() : null;
    const severity = filters.severity ? String(filters.severity).toUpperCase().trim() : null;
    const finalityStatus = filters.finalityStatus ? String(filters.finalityStatus).toUpperCase().trim() : null;

    const fromBlock = filters.fromBlock !== undefined && filters.fromBlock !== null && !isNaN(Number(filters.fromBlock)) ? Number(filters.fromBlock) : null;
    const toBlock = filters.toBlock !== undefined && filters.toBlock !== null && !isNaN(Number(filters.toBlock)) ? Number(filters.toBlock) : null;

    const blockHash = filters.blockHash ? String(filters.blockHash).trim() : null;
    const transactionHash = (filters.transactionHash || filters.txHash) ? String(filters.transactionHash || filters.txHash).trim() : null;
    const contractAddress = filters.contractAddress ? String(filters.contractAddress).toLowerCase().trim() : null;
    const validatorId = filters.validatorId ? String(filters.validatorId).toUpperCase().trim() : null;
    const peerId = filters.peerId ? String(filters.peerId).toUpperCase().trim() : null;
    const correlationId = filters.correlationId ? String(filters.correlationId).trim() : null;

    const fromTime = (filters.fromTime || filters.since) ? new Date(filters.fromTime || filters.since).getTime() : null;
    const toTime = (filters.toTime || filters.until) ? new Date(filters.toTime || filters.until).getTime() : null;
    const searchQuery = filters.q ? String(filters.q).toLowerCase().trim() : null;

    // Filter matching events
    let matched = this.events.filter((ev) => {
      if (category && ev.category !== category) return false;
      if (eventType && ev.eventType !== eventType) return false;
      if (severity && ev.severity !== severity) return false;
      if (finalityStatus && ev.finalityStatus !== finalityStatus) return false;

      if (fromBlock !== null && (ev.blockHeight === null || ev.blockHeight < fromBlock)) return false;
      if (toBlock !== null && (ev.blockHeight === null || ev.blockHeight > toBlock)) return false;

      if (blockHash && ev.blockHash !== blockHash) return false;
      if (transactionHash && ev.transactionHash !== transactionHash) return false;
      if (contractAddress && ev.contractAddress !== contractAddress) return false;
      if (validatorId && ev.validatorId !== validatorId) return false;
      if (peerId && ev.peerId !== peerId) return false;
      if (correlationId && ev.correlationId !== correlationId) return false;

      if (fromTime !== null || toTime !== null) {
        const evTime = new Date(ev.timestamp).getTime();
        if (fromTime !== null && evTime < fromTime) return false;
        if (toTime !== null && evTime > toTime) return false;
      }

      if (searchQuery) {
        const matches = (ev.eventId && ev.eventId.toLowerCase().includes(searchQuery)) ||
                        (ev.blockHash && ev.blockHash.toLowerCase().includes(searchQuery)) ||
                        (ev.transactionHash && ev.transactionHash.toLowerCase().includes(searchQuery)) ||
                        (ev.contractAddress && ev.contractAddress.toLowerCase().includes(searchQuery)) ||
                        (ev.eventType && ev.eventType.toLowerCase().includes(searchQuery));
        if (!matches) return false;
      }

      return true;
    });

    const total = matched.length;
    let rawLimit = parseInt(filters.limit || DEFAULT_PAGE_SIZE, 10);
    if (isNaN(rawLimit) || rawLimit <= 0) rawLimit = DEFAULT_PAGE_SIZE;
    const limit = Math.min(rawLimit, MAX_PAGE_SIZE);
    const offset = parseInt(filters.cursor || filters.offset || 0, 10);

    const paginated = matched.slice(offset, offset + limit);
    const nextOffset = offset + limit;
    const hasMore = nextOffset < total;

    return {
      events: paginated,
      total,
      limit,
      offset,
      nextCursor: hasMore ? nextOffset : null,
      hasMore
    };
  }

  getEvent(eventId) {
    if (!eventId) return null;
    return this.eventsById.get(String(eventId).trim()) || null;
  }

  getEventById(eventId) {
    return this.getEvent(eventId);
  }

  getEventsForBlock(blockNumberOrHash) {
    if (typeof blockNumberOrHash === 'number' || /^\d+$/.test(String(blockNumberOrHash))) {
      const height = Number(blockNumberOrHash);
      return this.events.filter(e => e.blockHeight === height);
    }
    const hash = String(blockNumberOrHash).trim();
    return this.events.filter(e => e.blockHash === hash);
  }

  getEventsByBlock(blockNumberOrHash) {
    return this.getEventsForBlock(blockNumberOrHash);
  }

  getEventsForTransaction(txHash) {
    const target = String(txHash).trim();
    return this.events.filter(e => e.transactionHash === target);
  }

  getEventsByTx(txHash) {
    return this.getEventsForTransaction(txHash);
  }

  getEventsForContract(contractAddress) {
    const target = String(contractAddress).toLowerCase().trim();
    return this.events.filter(e => e.contractAddress === target);
  }

  getEventsByContract(contractAddress) {
    return this.getEventsForContract(contractAddress);
  }

  getTotalCount() {
    return this.events.length;
  }

  rebuildIndexes() {
    this.eventsById.clear();
    this.dedupKeys.clear();
    for (const ev of this.events) {
      this.eventsById.set(ev.eventId, ev);
      this.dedupKeys.set(ev.getDeduplicationKey(), ev.eventId);
    }
  }

  async replay() {
    return this.recover();
  }

  /**
   * Rebuild or recover events from journal file on disk
   */
  recover() {
    if (this.inMemoryOnly || !this.filepath || !fs.existsSync(this.filepath)) {
      return { loaded: 0, recovered: 0, corruptLines: 0, corrupted: 0 };
    }

    let recovered = 0;
    let corrupted = 0;

    try {
      const raw = fs.readFileSync(this.filepath, 'utf8');
      const lines = raw.split('\n');

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        try {
          const parsed = JSON.parse(line);
          const ev = new BlockchainEvent(parsed);
          ev.validate();

          const dedupKey = ev.getDeduplicationKey();
          if (!this.dedupKeys.has(dedupKey)) {
            this.events.push(ev);
            this.eventsById.set(ev.eventId, ev);
            this.dedupKeys.set(dedupKey, ev.eventId);
            recovered++;
          }
        } catch (err) {
          corrupted++;
          logger.warn(`[EventStore] Corrupt event journal record at line ${i + 1}: ${err.message}`);
        }
      }
    } catch (err) {
      logger.error(`[EventStore] Failed to read journal file: ${err.message}`);
    }

    return {
      loaded: recovered,
      recovered,
      corruptLines: corrupted,
      corrupted
    };
  }

  /**
   * Deterministically rebuild events from authoritative Blockchain ledger
   * @param {object} blockchain
   * @param {object} [evmRuntime]
   */
  rebuildFromBlockchain(blockchain, evmRuntime = null) {
    if (!blockchain || !Array.isArray(blockchain.chain)) return 0;
    let count = 0;

    for (const block of blockchain.chain) {
      const blockHeight = parseInt(block.blockNumber !== undefined ? block.blockNumber : block.index, 10) || 0;
      const blockHash = block.blockHash || block.hash;
      const timestamp = block.timestamp || new Date().toISOString();

      // Block Finalized Event
      this.append(new BlockchainEvent({
        eventType: 'BLOCK_FINALIZED',
        category: 'BLOCK',
        severity: 'INFO',
        finalityStatus: 'FINALIZED',
        blockHeight,
        blockHash,
        timestamp,
        payload: {
          transactionCount: Array.isArray(block.transactions) ? block.transactions.length : 0,
          stateRoot: block.stateRoot || null,
          proposerId: block.proposerId || null
        }
      }));
      count++;

      // Transaction Events
      if (Array.isArray(block.transactions)) {
        block.transactions.forEach((tx, txIndex) => {
          const txHash = tx.transactionId || tx.id || `TX-${blockHeight}-${txIndex}`;
          this.append(new BlockchainEvent({
            eventType: 'TRANSACTION_EXECUTED',
            category: 'TRANSACTION',
            severity: 'INFO',
            finalityStatus: 'FINALIZED',
            blockHeight,
            blockHash,
            transactionHash: txHash,
            transactionIndex: txIndex,
            timestamp,
            payload: {
              type: tx.type || 'TRANSFER',
              sender: tx.sender || null,
              receiver: tx.receiver || null
            }
          }));
          count++;
        });
      }
    }

    // Add EVM Contract Events if runtime is available
    if (evmRuntime && Array.isArray(evmRuntime.contractEvents)) {
      evmRuntime.contractEvents.forEach((cEvent, logIndex) => {
        this.append(new BlockchainEvent({
          eventType: 'CONTRACT_EVENT_EMITTED',
          category: 'CONTRACT',
          severity: 'INFO',
          finalityStatus: 'FINALIZED',
          blockHeight: cEvent.blockNumber || 0,
          transactionHash: cEvent.transactionId || null,
          logIndex,
          contractAddress: cEvent.contractAddress,
          timestamp: cEvent.timestamp || new Date().toISOString(),
          payload: {
            name: cEvent.name,
            signature: cEvent.signature,
            args: cEvent.args,
            rawTopics: cEvent.rawTopics,
            rawData: cEvent.rawData
          }
        }));
        count++;
      });
    }

    return count;
  }

  clear() {
    this.events = [];
    this.eventsById.clear();
    this.dedupKeys.clear();
    if (!this.inMemoryOnly && this.filepath && fs.existsSync(this.filepath)) {
      try { fs.unlinkSync(this.filepath); } catch (e) {}
    }
  }

  size() {
    return this.events.length;
  }
}

module.exports = {
  EventStore,
  MAX_PAGE_SIZE,
  DEFAULT_PAGE_SIZE
};
