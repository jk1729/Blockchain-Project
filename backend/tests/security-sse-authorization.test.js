/**
 * Phase 17 Test Suite 4: Real-time SSE Stream Subscription Authorization
 */

const {
  BlockchainEvent,
  EventBus,
  EventStore,
  EventStreamManager,
  EVENT_TYPES,
  EVENT_CATEGORIES
} = require('../src/events');
const { defaultAuthorizationService } = require('../src/security/permissions');

describe('Phase 17: SSE Stream Subscription Authorization & Filtering', () => {
  let eventBus;
  let eventStore;
  let streamManager;

  beforeEach(async () => {
    eventBus = new EventBus();
    eventStore = new EventStore({ inMemoryOnly: true, eventBus });
    await eventStore.initialize();
    streamManager = new EventStreamManager({ eventStore, eventBus, authService: defaultAuthorizationService });
  });

  afterEach(() => {
    if (streamManager) streamManager.closeAll();
    if (eventStore) eventStore.close();
    if (eventBus) eventBus.clear();
  });

  test('should allow public client to subscribe to public event categories', () => {
    const mockRes = {
      writeHead: jest.fn(),
      write: jest.fn(),
      end: jest.fn(),
      on: jest.fn()
    };

    const client = streamManager.registerClient(mockRes, {
      category: EVENT_CATEGORIES.BLOCKCHAIN
    });

    expect(client).toBeDefined();
    expect(streamManager.getActiveClientCount()).toBe(1);
  });

  test('should reject unauthenticated subscriber requesting restricted SECURITY category with 403', () => {
    const mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
      writeHead: jest.fn(),
      write: jest.fn(),
      end: jest.fn()
    };
    const req = {
      user: null,
      headers: {},
      on: jest.fn()
    };

    const clientId = streamManager.addClient(req, mockRes, {
      category: 'SECURITY'
    });

    expect(clientId).toBeNull();
    expect(mockRes.status).toHaveBeenCalledWith(403);
    expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      code: 'FORBIDDEN'
    }));
  });

  test('should allow authenticated operator to subscribe to restricted categories', () => {
    const mockRes = {
      writeHead: jest.fn(),
      write: jest.fn(),
      end: jest.fn(),
      on: jest.fn()
    };
    const req = {
      user: { id: 5, username: 'sec_op', role: 'SECURITY_OPERATOR' },
      headers: {},
      on: jest.fn()
    };

    const clientId = streamManager.addClient(req, mockRes, {
      category: 'SECURITY'
    });

    expect(clientId).toBeDefined();
    expect(streamManager.getActiveClientCount()).toBe(1);
  });

  test('should not broadcast restricted security events to public subscribers', () => {
    const publicData = [];
    const publicRes = {
      writeHead: jest.fn(),
      write: jest.fn(chunk => publicData.push(chunk)),
      end: jest.fn(),
      on: jest.fn()
    };
    streamManager.addClient({ user: null, headers: {}, on: jest.fn() }, publicRes, {});

    const operatorData = [];
    const operatorRes = {
      writeHead: jest.fn(),
      write: jest.fn(chunk => operatorData.push(chunk)),
      end: jest.fn(),
      on: jest.fn()
    };
    streamManager.addClient(
      { user: { id: 7, username: 'admin_user', role: 'ADMIN' }, headers: {}, on: jest.fn() },
      operatorRes,
      {}
    );

    // Publish a sensitive security/TLS event
    const secEvt = BlockchainEvent.create({
      type: EVENT_TYPES.CERTIFICATE_REVOKED_CRL,
      category: EVENT_CATEGORIES.TLS,
      payload: { reason: 'Unauthorized peer connection attempt' }
    });
    eventBus.publish(secEvt);

    // Public client must not have received the security event
    const publicJoined = publicData.join('');
    expect(publicJoined).not.toContain(secEvt.eventId);

    // Operator client must have received it
    const operatorJoined = operatorData.join('');
    expect(operatorJoined).toContain(secEvt.eventId);
  });
});
