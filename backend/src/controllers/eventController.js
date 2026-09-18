/**
 * PDSChain Event Controller (Phase 13)
 * 
 * Exposes REST queries and real-time SSE streaming for blockchain events and logs.
 */

const { EventStore } = require('../events/EventStore');
const { EventBus } = require('../events/EventBus');
const { EventStreamManager } = require('../events/EventStreamManager');
const EventMetrics = require('../events/EventMetrics');

// Shared singleton for standard backend API instance
const defaultEventStore = new EventStore({ inMemoryOnly: false, filepath: 'database/events_journal.jsonl' });
const defaultEventBus = new EventBus({ eventStore: defaultEventStore });
const defaultEventMetrics = new EventMetrics();
const defaultStreamManager = new EventStreamManager({ eventStore: defaultEventStore, eventBus: defaultEventBus });

function getStore(req) {
  return (req && req.app && req.app.locals && req.app.locals.eventStore) || defaultEventStore;
}

function getStreamManager(req) {
  return (req && req.app && req.app.locals && req.app.locals.streamManager) || defaultStreamManager;
}

function getMetrics(req) {
  return (req && req.app && req.app.locals && req.app.locals.eventMetrics) || defaultEventMetrics;
}

const getEvents = (req, res) => {
  try {
    const store = getStore(req);
    const metrics = getMetrics(req);
    metrics.incrementQueried();

    const queryResult = store.query(req.query || {});
    res.status(200).json({
      success: true,
      schemaVersion: 1,
      ...queryResult
    });
  } catch (err) {
    res.status(400).json({
      success: false,
      error: err.message,
      code: 'QUERY_ERROR'
    });
  }
};

const getEventById = (req, res) => {
  try {
    const store = getStore(req);
    const event = store.getEventById(req.params.eventId);

    if (!event) {
      return res.status(404).json({
        success: false,
        message: `Event '${req.params.eventId}' not found`,
        code: 'EVENT_NOT_FOUND'
      });
    }

    res.status(200).json({
      success: true,
      schemaVersion: 1,
      event: event.toSafeObject()
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
};

const getBlockEvents = (req, res) => {
  try {
    const store = getStore(req);
    const param = req.params.heightOrHash;
    const events = store.getEventsForBlock(param);

    res.status(200).json({
      success: true,
      target: param,
      count: events.length,
      events: events.map(e => e.toSafeObject())
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
};

const getTransactionEvents = (req, res) => {
  try {
    const store = getStore(req);
    const txHash = req.params.txHash;
    const events = store.getEventsForTransaction(txHash);

    res.status(200).json({
      success: true,
      transactionHash: txHash,
      count: events.length,
      events: events.map(e => e.toSafeObject())
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
};

const getContractEvents = (req, res) => {
  try {
    const store = getStore(req);
    const contractAddress = req.params.address;
    const events = store.getEventsForContract(contractAddress);

    res.status(200).json({
      success: true,
      contractAddress,
      count: events.length,
      events: events.map(e => e.toSafeObject())
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
};

const streamEvents = (req, res) => {
  const streamManager = getStreamManager(req);
  const metrics = getMetrics(req);

  streamManager.addClient(req, res, req.query);
  metrics.setActiveClients(streamManager.getActiveClientCount());
};

const getMetricsHandler = (req, res) => {
  const metrics = getMetrics(req);
  if (req.headers.accept && req.headers.accept.includes('text/plain')) {
    res.setHeader('Content-Type', 'text/plain');
    return res.send(metrics.toPrometheusFormat());
  }
  const snapshot = metrics.getSnapshot();
  res.status(200).json({
    success: true,
    metrics: snapshot,
    ...snapshot
  });
};

module.exports = {
  getEvents,
  getEventById,
  getBlockEvents,
  getTransactionEvents,
  getContractEvents,
  streamEvents,
  getMetricsHandler,
  defaultEventStore,
  defaultEventBus,
  defaultStreamManager,
  defaultEventMetrics
};
