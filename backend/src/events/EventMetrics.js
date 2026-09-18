/**
 * PDSChain EventMetrics (Phase 13)
 * 
 * Prometheus metrics exporter and runtime telemetry for events subsystem.
 */

class EventMetrics {
  constructor(eventBus = null) {
    this.eventsEmittedTotal = new Map(); // "category:type" -> count
    this.eventsPersistedCount = 0;
    this.eventsQueryCount = 0;
    this.eventsStreamedCount = 0;
    this.eventsDroppedCount = 0;
    this.eventsDeduplicatedCount = 0;
    this.activeStreamClients = 0;
    this.queueDepth = 0;

    if (eventBus && typeof eventBus.subscribe === 'function') {
      eventBus.subscribe('*', (ev) => {
        this.incrementEmitted(ev.category, ev.eventType || ev.type);
      });
    }
  }

  getTotalEmitted() {
    let sum = 0;
    for (const v of this.eventsEmittedTotal.values()) sum += v;
    return sum;
  }

  incrementEmitted(category, type) {
    const key = `${category || 'UNKNOWN'}:${type || 'UNKNOWN'}`;
    this.eventsEmittedTotal.set(key, (this.eventsEmittedTotal.get(key) || 0) + 1);
  }

  incrementPersisted(count = 1) {
    this.eventsPersistedCount += count;
  }

  incrementQueried() {
    this.eventsQueryCount++;
  }

  incrementStreamed(count = 1) {
    this.eventsStreamedCount += count;
  }

  incrementDropped(count = 1) {
    this.eventsDroppedCount += count;
  }

  incrementDeduplicated(count = 1) {
    this.eventsDeduplicatedCount += count;
  }

  setActiveClients(count) {
    this.activeStreamClients = count;
  }

  setQueueDepth(depth) {
    this.queueDepth = depth;
  }

  getSnapshot() {
    const totalEmitted = this.getTotalEmitted();
    return {
      totalEventsEmitted: totalEmitted,
      eventsEmittedTotal: totalEmitted,
      eventsPersistedTotal: this.eventsPersistedCount,
      eventsQueryTotal: this.eventsQueryCount,
      eventsStreamedTotal: this.eventsStreamedCount,
      eventsDroppedTotal: this.eventsDroppedCount,
      eventsDeduplicatedTotal: this.eventsDeduplicatedCount,
      activeStreamClients: this.activeStreamClients,
      queueDepth: this.queueDepth,
      emittedByCategoryAndType: Object.fromEntries(this.eventsEmittedTotal)
    };
  }

  toPrometheusFormat() {
    const lines = [
      '# HELP pdschain_events_emitted_total Total number of blockchain events published',
      '# TYPE pdschain_events_emitted_total counter',
      `pdschain_events_emitted_total ${this.getTotalEmitted()}`,

      '# HELP pdschain_events_persisted_total Total number of blockchain events persisted to store',
      '# TYPE pdschain_events_persisted_total counter',
      `pdschain_events_persisted_total ${this.eventsPersistedCount}`,

      '# HELP pdschain_events_query_total Total number of event queries executed',
      '# TYPE pdschain_events_query_total counter',
      `pdschain_events_query_total ${this.eventsQueryCount}`,

      '# HELP pdschain_events_streamed_total Total number of events delivered over live streams',
      '# TYPE pdschain_events_streamed_total counter',
      `pdschain_events_streamed_total ${this.eventsStreamedCount}`,

      '# HELP pdschain_events_stream_active_clients Active real-time streaming clients',
      '# TYPE pdschain_events_stream_active_clients gauge',
      `pdschain_events_stream_active_clients ${this.activeStreamClients}`,

      '# HELP pdschain_events_queue_depth In-memory event bus queue depth',
      '# TYPE pdschain_events_queue_depth gauge',
      `pdschain_events_queue_depth ${this.queueDepth}`,

      '# HELP pdschain_events_dropped_total Total number of dropped events due to queue backpressure',
      '# TYPE pdschain_events_dropped_total counter',
      `pdschain_events_dropped_total ${this.eventsDroppedCount}`,

      '# HELP pdschain_events_deduplicated_total Total number of duplicate events suppressed',
      '# TYPE pdschain_events_deduplicated_total counter',
      `pdschain_events_deduplicated_total ${this.eventsDeduplicatedCount}`
    ];

    return lines.join('\n') + '\n';
  }
}

module.exports = EventMetrics;
