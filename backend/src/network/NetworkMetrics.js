class NetworkMetrics {
  constructor() {
    this.reset();
  }

  reset() {
    this.messagesSentTotal = {};
    this.messagesReceivedTotal = {};
    this.messagesRejectedTotal = {};
    this.duplicateMessagesTotal = 0;
    this.framingErrorsTotal = 0;
    this.reconnectAttemptsTotal = 0;
    this.activeConnections = 0;
    this.bytesSentTotal = 0;
    this.bytesReceivedTotal = 0;
    this.peerLatency = new Map(); // validatorId -> latencyMs

    // Phase 10: Sync & Recovery Metrics
    this.syncRequestsTotal = 0;
    this.syncResponsesTotal = 0;
    this.blocksRequestedTotal = 0;
    this.blocksReceivedTotal = 0;
    this.blocksAcceptedTotal = 0;
    this.blocksRejectedTotal = 0;
    this.invalidCertificatesTotal = 0;
    this.invalidExecutionRootsTotal = 0;
    this.divergenceEventsTotal = 0;
    this.recoveryAttemptsTotal = 0;
    this.recoveryFailuresTotal = 0;
    this.journalReplayFailuresTotal = 0;
    this.checkpointFailuresTotal = 0;
    this.syncDurationMs = 0;
    this.syncBytesTransferred = 0;

    // Phase 11: Deployment & Health Metrics
    this.validatorIsLive = 1;
    this.validatorIsReady = 0;
    this.validatorIsConsensusReady = 0;
    this.restartsTotal = 0;
    this.crashesTotal = 0;
    this.blockFinalizationLatencyMs = 0;
  }

  incrementSent(type = 'UNKNOWN', bytes = 0) {
    this.messagesSentTotal[type] = (this.messagesSentTotal[type] || 0) + 1;
    this.bytesSentTotal += bytes;
  }

  incrementReceived(type = 'UNKNOWN', bytes = 0) {
    this.messagesReceivedTotal[type] = (this.messagesReceivedTotal[type] || 0) + 1;
    this.bytesReceivedTotal += bytes;
  }

  incrementRejected(reason = 'UNKNOWN') {
    this.messagesRejectedTotal[reason] = (this.messagesRejectedTotal[reason] || 0) + 1;
  }

  incrementDuplicate() {
    this.duplicateMessagesTotal += 1;
  }

  incrementFramingError() {
    this.framingErrorsTotal += 1;
  }

  incrementReconnect() {
    this.reconnectAttemptsTotal += 1;
  }

  setActiveConnections(count) {
    this.activeConnections = Math.max(0, count);
  }

  recordLatency(validatorId, latencyMs) {
    if (validatorId) {
      this.peerLatency.set(validatorId, Math.max(0, latencyMs));
    }
  }

  // Phase 10 Helpers
  incrementSyncRequest(blocksCount = 0) {
    this.syncRequestsTotal += 1;
    this.blocksRequestedTotal += Math.max(0, blocksCount);
  }

  incrementSyncResponse(blocksCount = 0, bytes = 0) {
    this.syncResponsesTotal += 1;
    this.blocksReceivedTotal += Math.max(0, blocksCount);
    this.syncBytesTransferred += Math.max(0, bytes);
  }

  incrementBlockAccepted(count = 1) {
    this.blocksAcceptedTotal += Math.max(1, count);
  }

  incrementBlockRejected(reason = 'UNKNOWN') {
    this.blocksRejectedTotal += 1;
    this.incrementRejected(reason);
  }

  incrementInvalidCertificate() {
    this.invalidCertificatesTotal += 1;
    this.incrementRejected('INVALID_CERTIFICATE');
  }

  incrementInvalidExecutionRoot() {
    this.invalidExecutionRootsTotal += 1;
    this.incrementRejected('INVALID_EXECUTION_ROOT');
  }

  incrementDivergenceEvent() {
    this.divergenceEventsTotal += 1;
  }

  incrementRecoveryAttempt() {
    this.recoveryAttemptsTotal += 1;
  }

  incrementRecoveryFailure() {
    this.recoveryFailuresTotal += 1;
  }

  incrementJournalFailure() {
    this.journalReplayFailuresTotal += 1;
  }

  incrementCheckpointFailure() {
    this.checkpointFailuresTotal += 1;
  }

  recordSyncDuration(durationMs) {
    this.syncDurationMs += Math.max(0, durationMs);
  }

  // Phase 11: Deployment & Health Methods
  setLive(isLive) {
    this.validatorIsLive = isLive ? 1 : 0;
  }

  setReady(isReady) {
    this.validatorIsReady = isReady ? 1 : 0;
  }

  setConsensusReady(isReady) {
    this.validatorIsConsensusReady = isReady ? 1 : 0;
  }

  incrementRestart() {
    this.restartsTotal += 1;
  }

  incrementCrash() {
    this.crashesTotal += 1;
  }

  recordBlockFinalizationLatency(latencyMs) {
    this.blockFinalizationLatencyMs = Math.max(0, latencyMs);
  }

  getSnapshot() {
    const latencies = {};
    for (const [vId, lat] of this.peerLatency.entries()) {
      latencies[vId] = lat;
    }

    return {
      messagesSentTotal: { ...this.messagesSentTotal },
      messagesReceivedTotal: { ...this.messagesReceivedTotal },
      messagesRejectedTotal: { ...this.messagesRejectedTotal },
      duplicateMessagesTotal: this.duplicateMessagesTotal,
      framingErrorsTotal: this.framingErrorsTotal,
      reconnectAttemptsTotal: this.reconnectAttemptsTotal,
      activeConnections: this.activeConnections,
      bytesSentTotal: this.bytesSentTotal,
      bytesReceivedTotal: this.bytesReceivedTotal,
      peerLatency: latencies,
      // Phase 10
      syncRequestsTotal: this.syncRequestsTotal,
      syncResponsesTotal: this.syncResponsesTotal,
      blocksRequestedTotal: this.blocksRequestedTotal,
      blocksReceivedTotal: this.blocksReceivedTotal,
      blocksAcceptedTotal: this.blocksAcceptedTotal,
      blocksRejectedTotal: this.blocksRejectedTotal,
      invalidCertificatesTotal: this.invalidCertificatesTotal,
      invalidExecutionRootsTotal: this.invalidExecutionRootsTotal,
      divergenceEventsTotal: this.divergenceEventsTotal,
      recoveryAttemptsTotal: this.recoveryAttemptsTotal,
      recoveryFailuresTotal: this.recoveryFailuresTotal,
      journalReplayFailuresTotal: this.journalReplayFailuresTotal,
      checkpointFailuresTotal: this.checkpointFailuresTotal,
      syncDurationMs: this.syncDurationMs,
      syncBytesTransferred: this.syncBytesTransferred,
      // Phase 11
      validatorIsLive: this.validatorIsLive,
      validatorIsReady: this.validatorIsReady,
      validatorIsConsensusReady: this.validatorIsConsensusReady,
      restartsTotal: this.restartsTotal,
      crashesTotal: this.crashesTotal,
      blockFinalizationLatencyMs: this.blockFinalizationLatencyMs,
      timestamp: Date.now()
    };
  }

  toPrometheusFormat() {
    const lines = [];
    lines.push('# HELP pdschain_network_active_connections Number of active peer connections');
    lines.push('# TYPE pdschain_network_active_connections gauge');
    lines.push(`pdschain_network_active_connections ${this.activeConnections}`);

    lines.push('# HELP pdschain_network_messages_sent_total Total messages sent by type');
    lines.push('# TYPE pdschain_network_messages_sent_total counter');
    for (const [type, count] of Object.entries(this.messagesSentTotal)) {
      lines.push(`pdschain_network_messages_sent_total{type="${type}"} ${count}`);
    }

    lines.push('# HELP pdschain_network_messages_received_total Total messages received by type');
    lines.push('# TYPE pdschain_network_messages_received_total counter');
    for (const [type, count] of Object.entries(this.messagesReceivedTotal)) {
      lines.push(`pdschain_network_messages_received_total{type="${type}"} ${count}`);
    }

    lines.push('# HELP pdschain_network_messages_rejected_total Total messages rejected by reason');
    lines.push('# TYPE pdschain_network_messages_rejected_total counter');
    for (const [reason, count] of Object.entries(this.messagesRejectedTotal)) {
      lines.push(`pdschain_network_messages_rejected_total{reason="${reason}"} ${count}`);
    }

    lines.push('# HELP pdschain_network_duplicates_total Total duplicate messages ignored');
    lines.push('# TYPE pdschain_network_duplicates_total counter');
    lines.push(`pdschain_network_duplicates_total ${this.duplicateMessagesTotal}`);

    lines.push('# HELP pdschain_network_framing_errors_total Total stream framing errors');
    lines.push('# TYPE pdschain_network_framing_errors_total counter');
    lines.push(`pdschain_network_framing_errors_total ${this.framingErrorsTotal}`);

    lines.push('# HELP pdschain_network_reconnect_attempts_total Total reconnect attempts');
    lines.push('# TYPE pdschain_network_reconnect_attempts_total counter');
    lines.push(`pdschain_network_reconnect_attempts_total ${this.reconnectAttemptsTotal}`);

    lines.push('# HELP pdschain_network_peer_latency_ms Peer latency in milliseconds');
    lines.push('# TYPE pdschain_network_peer_latency_ms gauge');
    for (const [vId, lat] of this.peerLatency.entries()) {
      lines.push(`pdschain_network_peer_latency_ms{peer="${vId}"} ${lat}`);
    }

    // Phase 10 Prometheus export
    lines.push('# HELP pdschain_sync_requests_total Total sync requests initiated');
    lines.push('# TYPE pdschain_sync_requests_total counter');
    lines.push(`pdschain_sync_requests_total ${this.syncRequestsTotal}`);

    lines.push('# HELP pdschain_sync_blocks_accepted_total Total synchronized blocks accepted');
    lines.push('# TYPE pdschain_sync_blocks_accepted_total counter');
    lines.push(`pdschain_sync_blocks_accepted_total ${this.blocksAcceptedTotal}`);

    lines.push('# HELP pdschain_sync_blocks_rejected_total Total synchronized blocks rejected');
    lines.push('# TYPE pdschain_sync_blocks_rejected_total counter');
    lines.push(`pdschain_sync_blocks_rejected_total ${this.blocksRejectedTotal}`);

    lines.push('# HELP pdschain_recovery_attempts_total Total ledger recovery attempts');
    lines.push('# TYPE pdschain_recovery_attempts_total counter');
    lines.push(`pdschain_recovery_attempts_total ${this.recoveryAttemptsTotal}`);

    lines.push('# HELP pdschain_recovery_failures_total Total ledger recovery failures');
    lines.push('# TYPE pdschain_recovery_failures_total counter');
    lines.push(`pdschain_recovery_failures_total ${this.recoveryFailuresTotal}`);

    // Phase 11 Prometheus export
    lines.push('# HELP pdschain_validator_is_live Validator process liveness probe (1 = live, 0 = terminating)');
    lines.push('# TYPE pdschain_validator_is_live gauge');
    lines.push(`pdschain_validator_is_live ${this.validatorIsLive}`);

    lines.push('# HELP pdschain_validator_is_ready Validator readiness probe (1 = ready, 0 = not ready)');
    lines.push('# TYPE pdschain_validator_is_ready gauge');
    lines.push(`pdschain_validator_is_ready ${this.validatorIsReady}`);

    lines.push('# HELP pdschain_validator_is_consensus_ready Validator consensus readiness (1 = ready, 0 = not ready)');
    lines.push('# TYPE pdschain_validator_is_consensus_ready gauge');
    lines.push(`pdschain_validator_is_consensus_ready ${this.validatorIsConsensusReady}`);

    lines.push('# HELP pdschain_validator_restarts_total Total supervisor restarts of this validator');
    lines.push('# TYPE pdschain_validator_restarts_total counter');
    lines.push(`pdschain_validator_restarts_total ${this.restartsTotal}`);

    lines.push('# HELP pdschain_validator_crashes_total Total unexpected crashes of this validator');
    lines.push('# TYPE pdschain_validator_crashes_total counter');
    lines.push(`pdschain_validator_crashes_total ${this.crashesTotal}`);

    lines.push('# HELP pdschain_block_finalization_latency_ms Block finalization latency in milliseconds');
    lines.push('# TYPE pdschain_block_finalization_latency_ms gauge');
    lines.push(`pdschain_block_finalization_latency_ms ${this.blockFinalizationLatencyMs}`);

    return lines.join('\n') + '\n';
  }
}

module.exports = NetworkMetrics;
