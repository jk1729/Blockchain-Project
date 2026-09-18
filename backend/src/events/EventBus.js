/**
 * PDSChain EventBus (Phase 13)
 * 
 * In-memory typed event publishing and subscription bus.
 * Features:
 * - Subscriber isolation (subscriber errors do not crash caller).
 * - Bounded queue with backpressure.
 * - Recursion / cascade loop prevention.
 * - Graceful queue draining.
 */

const EventEmitter = require('events');
const { BlockchainEvent } = require('./BlockchainEvent');
const logger = require('../utils/logger');

const MAX_QUEUE_SIZE = 5000;
const MAX_RECURSION_DEPTH = 5;

class EventBus extends EventEmitter {
  /**
   * @param {object} [options]
   * @param {number} [options.maxQueueSize=5000]
   * @param {EventStore} [options.eventStore]
   */
  constructor(options = {}) {
    super();
    this.maxQueueSize = options.maxQueueSize || MAX_QUEUE_SIZE;
    this.eventStore = options.eventStore || null;
    this.queue = [];
    this.isProcessing = false;
    this.isDraining = false;
    this.recursionDepth = 0;
    this.droppedEventsCount = 0;
  }

  /**
   * Publish an event to the bus and persist to EventStore if configured
   * @param {BlockchainEvent|object} event 
   * @param {boolean} [synchronous=false]
   * @returns {BlockchainEvent}
   */
  publish(event, synchronous = false) {
    if (this.isDraining) {
      logger.warn('[EventBus] Refusing event publish during shutdown drain');
      return null;
    }

    if (this.recursionDepth >= MAX_RECURSION_DEPTH) {
      logger.error(`[EventBus] Recursion limit reached (${MAX_RECURSION_DEPTH}). Dropping cascading event.`);
      this.droppedEventsCount++;
      return null;
    }

    const ev = event instanceof BlockchainEvent ? event : new BlockchainEvent(event);
    ev.validate();

    // Persist to store first if attached
    if (this.eventStore) {
      try {
        this.eventStore.append(ev);
      } catch (err) {
        logger.error(`[EventBus] Failed to persist event ${ev.eventId}: ${err.message}`);
      }
    }

    if (synchronous) {
      this._dispatchDirect(ev);
      return ev;
    }

    // Check backpressure queue limit
    if (this.queue.length >= this.maxQueueSize) {
      logger.warn(`[EventBus] Queue overflow (${this.queue.length}/${this.maxQueueSize}). Dropping oldest best-effort event.`);
      this.queue.shift();
      this.droppedEventsCount++;
    }

    this.queue.push(ev);
    this._processQueue();

    return ev;
  }

  /**
   * Subscribe to specific event type, category, or all events
   * @param {string} filterPattern - EventType, Category, or '*'
   * @param {function} handler - Callback(event)
   * @param {boolean} [critical=false] - If critical, error is rethrown
   */
  subscribe(filterPattern, handler, critical = false) {
    const pattern = String(filterPattern).toUpperCase().trim();

    const wrappedHandler = async (event) => {
      try {
        await handler(event);
      } catch (err) {
        logger.error(`[EventBus] Error in subscriber for '${pattern}': ${err.message}`);
        if (critical) {
          throw err;
        }
      }
    };

    this.on(pattern, wrappedHandler);
    return () => this.off(pattern, wrappedHandler);
  }

  _dispatchDirect(ev) {
    this.recursionDepth++;
    try {
      // 1. Emit wildcard
      this.emit('*', ev);
      // 2. Emit category
      if (ev.category) {
        this.emit(ev.category, ev);
      }
      // 3. Emit specific eventType
      if (ev.eventType) {
        this.emit(ev.eventType, ev);
      }
    } finally {
      this.recursionDepth--;
    }
  }

  async _processQueue() {
    if (this.isProcessing) return;
    this.isProcessing = true;

    while (this.queue.length > 0) {
      const ev = this.queue.shift();
      if (ev) {
        this._dispatchDirect(ev);
      }
    }

    this.isProcessing = false;
  }

  /**
   * Graceful shutdown and drain
   */
  async drain() {
    this.isDraining = true;
    while (this.queue.length > 0) {
      await this._processQueue();
    }
    this.removeAllListeners();
  }

  getQueueDepth() {
    return this.queue.length;
  }

  getDroppedCount() {
    return this.droppedEventsCount;
  }

  getSubscriberCount(event) {
    if (event) return this.listenerCount(event);
    return this.eventNames().reduce((acc, name) => acc + this.listenerCount(name), 0);
  }

  clear() {
    this.queue = [];
    this.removeAllListeners();
  }
}

module.exports = {
  EventBus,
  MAX_QUEUE_SIZE
};
