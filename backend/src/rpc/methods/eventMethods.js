/**
 * PDSChain JSON-RPC 2.0 Event Subsystem Methods (Phase 14)
 */

const { RPC_ERRORS, JsonRpcError } = require('../JsonRpcErrors');

const eventMethods = {
  /**
   * pds_getEvents
   * params: [filterObject]
   */
  async pds_getEvents(params, context) {
    const store = (context && context.eventStore);
    if (!store) {
      return { events: [], pageInfo: { total: 0, hasMore: false } };
    }

    const filter = (params && params[0]) || {};
    try {
      const result = store.query(filter);
      return result;
    } catch (err) {
      throw new JsonRpcError(RPC_ERRORS.INVALID_PARAMS, `Event query error: ${err.message}`);
    }
  },

  /**
   * pds_getEventById
   * params: [eventId]
   */
  async pds_getEventById(params, context) {
    if (!params || !params[0]) {
      throw new JsonRpcError(RPC_ERRORS.INVALID_PARAMS, 'Expected [eventId]');
    }

    const store = (context && context.eventStore);
    if (!store) {
      return null;
    }

    const event = store.getEventById(params[0]);
    if (!event) {
      return null;
    }
    return typeof event.toJSON === 'function' ? event.toJSON() : event;
  }
};

module.exports = eventMethods;

