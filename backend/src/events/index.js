/**
 * PDSChain Events & Logs Subsystem (Phase 13)
 */

const {
  EventCategory,
  EVENT_CATEGORIES,
  EventSeverity,
  EVENT_SEVERITIES,
  FinalityStatus,
  FINALITY_STATUS,
  EventType,
  EVENT_TYPES
} = require('./EventTypes');
const { BlockchainEvent, BlockchainEventError, MAX_PAYLOAD_SIZE_BYTES } = require('./BlockchainEvent');
const { EventStore, MAX_PAGE_SIZE, DEFAULT_PAGE_SIZE } = require('./EventStore');
const { EventBus, MAX_QUEUE_SIZE } = require('./EventBus');
const { EventStreamManager, CLIENT_MAX_BUFFER } = require('./EventStreamManager');
const EventMetrics = require('./EventMetrics');

module.exports = {
  EventCategory,
  EVENT_CATEGORIES,
  EventSeverity,
  EVENT_SEVERITIES,
  FinalityStatus,
  FINALITY_STATUS,
  EventType,
  EVENT_TYPES,
  BlockchainEvent,
  BlockchainEventError,
  MAX_PAYLOAD_SIZE_BYTES,
  MAX_PAYLOAD_BYTES: MAX_PAYLOAD_SIZE_BYTES,
  EventStore,
  MAX_PAGE_SIZE,
  DEFAULT_PAGE_SIZE,
  EventBus,
  MAX_QUEUE_SIZE,
  EventStreamManager,
  CLIENT_MAX_BUFFER,
  EventMetrics
};
