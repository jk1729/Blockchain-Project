/**
 * PDSChain EventStreamManager (Phase 13 & Phase 17 Security Hardening)
 * 
 * Manages Server-Sent Events (SSE) real-time streaming connections.
 * Features:
 * - Query-based subscription filtering.
 * - Authorization-aware event delivery (sensitive categories like TLS, KEY_MANAGEMENT,
 *   SECURITY, RECOVERY, AUDIT strictly require operator permissions).
 * - Resume support via Last-Event-ID header.
 * - Periodic keep-alive heartbeats.
 * - Backpressure and slow client buffer bounds.
 * - Clean disconnect and resource reclamation.
 */

const logger = require('../utils/logger');
const { defaultAuthorizationService } = require('../security/permissions');

const CLIENT_MAX_BUFFER = 500;
const HEARTBEAT_INTERVAL_MS = 15000; // 15 seconds

const RESTRICTED_CATEGORIES = new Set([
  'TLS',
  'KEY_MANAGEMENT',
  'SECURITY',
  'AUDIT',
  'RECOVERY'
]);

class EventStreamManager {
  /**
   * @param {object} [options]
   * @param {EventStore} [options.eventStore]
   * @param {EventBus} [options.eventBus]
   * @param {AuthorizationService} [options.authService]
   */
  constructor(options = {}) {
    this.eventStore = options.eventStore || null;
    this.eventBus = options.eventBus || null;
    this.authService = options.authService || defaultAuthorizationService;

    // Set of active client handlers: clientId -> ClientSession
    this.clients = new Map();
    this.nextClientId = 1;
    this.heartbeatTimer = null;

    if (this.eventBus) {
      this.eventBus.subscribe('*', (ev) => this.broadcast(ev));
    }

    this._startHeartbeat();
  }

  _startHeartbeat() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = setInterval(() => {
      this._sendHeartbeats();
    }, HEARTBEAT_INTERVAL_MS);
    if (this.heartbeatTimer.unref) this.heartbeatTimer.unref();
  }

  _sendHeartbeats() {
    for (const [clientId, client] of this.clients.entries()) {
      try {
        if (!client.res.writableEnded) {
          client.res.write(': heartbeat\n\n');
        }
      } catch (err) {
        this.removeClient(clientId);
      }
    }
  }

  /**
   * Register a new client SSE response stream
   * @param {object} req - Express Request
   * @param {object} res - Express Response
   * @param {object} [filters] - Query parameters
   * @returns {number|null} clientId or null if unauthorized
   */
  addClient(req, res, filters = {}) {
    const user = req.user || null;
    const requestedCategory = filters.category ? String(filters.category).toUpperCase().trim() : null;

    // Phase 17: Enforce authorization if client subscribes explicitly to restricted security/internal categories
    if (requestedCategory && RESTRICTED_CATEGORIES.has(requestedCategory)) {
      const isAllowed = this.authService ? this.authService.isAuthorized(user, 'operator:read:security-events') : false;
      if (!isAllowed) {
        if (typeof res.status === 'function') {
          res.status(403).json({
            success: false,
            error: `Access denied: subscription to '${requestedCategory}' events requires 'operator:read:security-events' permission`,
            code: 'FORBIDDEN'
          });
          return null;
        } else if (typeof res.writeHead === 'function') {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: false,
            error: `Access denied: subscription to '${requestedCategory}' events requires 'operator:read:security-events' permission`,
            code: 'FORBIDDEN'
          }));
          return null;
        }
      }
    }

    const clientId = this.nextClientId++;

    // Establish SSE stream headers
    if (typeof res.writeHead === 'function') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no'
      });
    }
    if (typeof res.write === 'function') {
      res.write(': connected\n\n');
    }

    const clientSession = {
      clientId,
      req,
      res,
      user,
      filters: {
        category: requestedCategory,
        eventType: filters.eventType ? String(filters.eventType).toUpperCase().trim() : null,
        severity: filters.severity ? String(filters.severity).toUpperCase().trim() : null,
        validatorId: filters.validatorId ? String(filters.validatorId).toUpperCase().trim() : null,
        contractAddress: filters.contractAddress ? String(filters.contractAddress).toLowerCase().trim() : null,
        fromBlock: filters.fromBlock !== undefined && filters.fromBlock !== null ? Number(filters.fromBlock) : null
      },
      queuedCount: 0,
      connectedAt: Date.now()
    };

    this.clients.set(clientId, clientSession);

    // Resume events if Last-Event-ID header is present
    const lastEventId = (req.headers && req.headers['last-event-id']) || filters.lastEventId || null;
    if (lastEventId && this.eventStore) {
      this._replayMissedEvents(clientSession, lastEventId);
    }

    if (req.on) {
      req.on('close', () => {
        this.removeClient(clientId);
      });
      req.on('error', () => {
        this.removeClient(clientId);
      });
    }

    return clientId;
  }

  removeClient(clientId) {
    const client = this.clients.get(clientId);
    if (!client) return;

    this.clients.delete(clientId);
    try {
      if (!client.res.writableEnded) {
        client.res.end();
      }
    } catch (e) {}
  }

  registerClient(res, filters = {}, lastEventId = null) {
    const req = {
      headers: { 'last-event-id': lastEventId },
      user: null,
      on: (event, handler) => {
        if (res && res.on) res.on(event, handler);
      }
    };
    const clientId = this.addClient(req, res, filters);
    return clientId ? this.clients.get(clientId) : null;
  }

  /**
   * Broadcast an event to all interested connected clients
   * @param {BlockchainEvent} event 
   */
  broadcast(event) {
    if (!event || this.clients.size === 0) return;

    const frame = this._formatSSE(event);

    for (const [clientId, client] of this.clients.entries()) {
      if (!this._matchesFilter(event, client)) {
        continue;
      }

      // Check client socket backpressure
      if (client.bufferedMessages > CLIENT_MAX_BUFFER || client.queuedCount > CLIENT_MAX_BUFFER) {
        logger.warn(`[EventStreamManager] Client ${clientId} slow consumer buffer exceeded. Terminating stream.`);
        this.removeClient(clientId);
        continue;
      }

      try {
        const ok = client.res.write(frame);
        if (ok === false) {
          client.bufferedMessages = (client.bufferedMessages || 0) + 1;
          client.queuedCount++;
          if (client.bufferedMessages > CLIENT_MAX_BUFFER || client.queuedCount > CLIENT_MAX_BUFFER) {
            this.removeClient(clientId);
          }
        } else {
          client.queuedCount = 0;
        }
      } catch (err) {
        this.removeClient(clientId);
      }
    }
  }

  _matchesFilter(ev, client) {
    if (!client) return false;

    // Enforce authorization for restricted event categories
    if (RESTRICTED_CATEGORIES.has(ev.category)) {
      const isAllowed = this.authService ? this.authService.isAuthorized(client.user, 'operator:read:security-events') : false;
      if (!isAllowed) {
        return false;
      }
    }

    const f = client.filters;
    if (!f) return true;
    if (f.category && ev.category !== f.category && !(f.category === 'BLOCKCHAIN' && ev.category === 'BLOCK')) return false;
    if (f.eventType && ev.eventType !== f.eventType) return false;
    if (f.severity && ev.severity !== f.severity) return false;
    if (f.validatorId && ev.validatorId !== f.validatorId) return false;
    if (f.contractAddress && (!ev.contractAddress || ev.contractAddress.toLowerCase() !== f.contractAddress.toLowerCase())) return false;
    if (f.fromBlock !== null && (ev.blockHeight === null || ev.blockHeight < f.fromBlock)) return false;
    return true;
  }

  _formatSSE(ev) {
    const data = JSON.stringify(ev.toJSON());
    return `id: ${ev.eventId}\nevent: ${ev.eventType}\ndata: ${data}\n\n`;
  }

  _replayMissedEvents(client, lastEventId) {
    try {
      const all = this.eventStore.events || [];
      const idx = all.findIndex(e => e.eventId === lastEventId);
      if (idx !== -1 && idx < all.length - 1) {
        const missed = all.slice(idx + 1);
        for (const ev of missed) {
          if (this._matchesFilter(ev, client)) {
            client.res.write(this._formatSSE(ev));
          }
        }
      }
    } catch (err) {
      logger.warn(`[EventStreamManager] Failed to replay events from ${lastEventId}: ${err.message}`);
    }
  }

  getActiveClientCount() {
    return this.clients.size;
  }

  closeAll() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    for (const clientId of Array.from(this.clients.keys())) {
      this.removeClient(clientId);
    }
  }
}

module.exports = {
  EventStreamManager,
  RESTRICTED_CATEGORIES,
  CLIENT_MAX_BUFFER,
  HEARTBEAT_INTERVAL_MS
};
