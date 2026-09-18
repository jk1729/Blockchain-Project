/**
 * PDSChain Performance Measurement Collector (Phase 21 - Stage B, C)
 * 
 * High-resolution metrics and latency percentile engine.
 * Records request latencies, computes exact percentiles (p50, p90, p95, p99, max),
 * tracks throughput (RPS), status code distributions, and samples system resources.
 */

class MeasurementCollector {
  constructor(options = {}) {
    this.name = options.name || 'DefaultCollector';
    this.startTime = null;
    this.endTime = null;
    this.durationMs = 0;

    // Operation latency records
    this.latencies = []; // Array of numbers in milliseconds
    this.operations = []; // Array of full measurement records
    this.byStatusCode = {}; // statusCode -> count
    this.byOperation = {}; // operationName -> array of latencies
    this.byErrorType = {}; // errorType -> count

    // Resource samples
    this.resourceSamples = [];
    this.resourceSampleInterval = null;
    this.maxRecordedOperations = options.maxRecordedOperations || 100000;
  }

  /**
   * Start high-resolution timing for an operation.
   * Returns a completion callback.
   */
  startTimer(operationName = 'DEFAULT') {
    const startNs = process.hrtime.bigint();

    return (metadata = {}) => {
      const endNs = process.hrtime.bigint();
      const latencyMs = Number(endNs - startNs) / 1e6; // Convert nanoseconds to milliseconds

      this.recordOperation({
        operation: operationName,
        latencyMs,
        statusCode: metadata.statusCode || (metadata.success === false ? 500 : 200),
        success: metadata.success !== false,
        errorType: metadata.errorType || null,
        bytesSent: metadata.bytesSent || 0,
        bytesReceived: metadata.bytesReceived || 0
      });

      return latencyMs;
    };
  }

  /**
   * Record a completed operation.
   */
  recordOperation(record) {
    const latencyMs = typeof record.latencyMs === 'number' ? record.latencyMs : 0;
    const statusCode = String(record.statusCode || (record.success === false ? '500' : '200'));
    const opName = String(record.operation || 'DEFAULT');

    if (this.latencies.length < this.maxRecordedOperations) {
      this.latencies.push(latencyMs);
    }

    // Status code breakdown
    this.byStatusCode[statusCode] = (this.byStatusCode[statusCode] || 0) + 1;

    // Operation breakdown
    if (!this.byOperation[opName]) {
      this.byOperation[opName] = [];
    }
    if (this.byOperation[opName].length < 10000) {
      this.byOperation[opName].push(latencyMs);
    }

    // Error type breakdown
    if (record.errorType) {
      this.byErrorType[record.errorType] = (this.byErrorType[record.errorType] || 0) + 1;
    }
  }

  /**
   * Sample current Node.js runtime resources.
   */
  sampleResource() {
    const mem = process.memoryUsage();
    const sample = {
      timestamp: Date.now(),
      heapUsedBytes: mem.heapUsed,
      heapTotalBytes: mem.heapTotal,
      rssBytes: mem.rss,
      externalBytes: mem.external,
      eventLoopLagMs: 0 // Will be computed if perf_hooks monitor is enabled
    };

    this.resourceSamples.push(sample);
    return sample;
  }

  /**
   * Start periodic resource sampling.
   */
  startResourceSampling(intervalMs = 500) {
    this.sampleResource();
    this.resourceSampleInterval = setInterval(() => {
      this.sampleResource();
    }, intervalMs);
    if (this.resourceSampleInterval.unref) {
      this.resourceSampleInterval.unref();
    }
  }

  /**
   * Stop periodic resource sampling.
   */
  stopResourceSampling() {
    if (this.resourceSampleInterval) {
      clearInterval(this.resourceSampleInterval);
      this.resourceSampleInterval = null;
    }
    this.sampleResource();
  }

  /**
   * Compute percentile with linear interpolation on sorted array.
   */
  static computePercentile(sortedArray, p) {
    if (!sortedArray || sortedArray.length === 0) return 0;
    if (sortedArray.length === 1) return sortedArray[0];

    const rank = (p / 100) * (sortedArray.length - 1);
    const low = Math.floor(rank);
    const high = Math.ceil(rank);
    const weight = rank - low;

    if (low === high) return sortedArray[low];
    return sortedArray[low] * (1 - weight) + sortedArray[high] * weight;
  }

  /**
   * Finalize and compute complete performance statistics.
   */
  getSummary() {
    const totalRequests = this.latencies.length;
    const sorted = [...this.latencies].sort((a, b) => a - b);

    let sum = 0;
    for (let i = 0; i < sorted.length; i++) {
      sum += sorted[i];
    }
    const mean = totalRequests > 0 ? sum / totalRequests : 0;

    let varianceSum = 0;
    for (let i = 0; i < sorted.length; i++) {
      varianceSum += Math.pow(sorted[i] - mean, 2);
    }
    const stdDev = totalRequests > 1 ? Math.sqrt(varianceSum / (totalRequests - 1)) : 0;

    let failedRequests = 0;
    for (const [code, count] of Object.entries(this.byStatusCode)) {
      const codeNum = parseInt(code, 10);
      if (codeNum >= 400 || isNaN(codeNum)) {
        failedRequests += count;
      }
    }
    const successfulRequests = totalRequests - failedRequests;
    const errorRate = totalRequests > 0 ? failedRequests / totalRequests : 0;

    const durationSec = this.durationMs > 0 ? this.durationMs / 1000 : 1;
    const throughputRps = Number((totalRequests / durationSec).toFixed(2));

    // Resource analysis
    let peakHeapUsedBytes = 0;
    let initialHeapUsedBytes = 0;
    let finalHeapUsedBytes = 0;
    if (this.resourceSamples.length > 0) {
      initialHeapUsedBytes = this.resourceSamples[0].heapUsedBytes;
      finalHeapUsedBytes = this.resourceSamples[this.resourceSamples.length - 1].heapUsedBytes;
      for (const s of this.resourceSamples) {
        if (s.heapUsedBytes > peakHeapUsedBytes) {
          peakHeapUsedBytes = s.heapUsedBytes;
        }
      }
    }

    const latencyMetrics = {
      min: sorted.length > 0 ? Number(sorted[0].toFixed(3)) : 0,
      p50: Number(MeasurementCollector.computePercentile(sorted, 50).toFixed(3)),
      p90: Number(MeasurementCollector.computePercentile(sorted, 90).toFixed(3)),
      p95: Number(MeasurementCollector.computePercentile(sorted, 95).toFixed(3)),
      p99: Number(MeasurementCollector.computePercentile(sorted, 99).toFixed(3)),
      p999: Number(MeasurementCollector.computePercentile(sorted, 99.9).toFixed(3)),
      max: sorted.length > 0 ? Number(sorted[sorted.length - 1].toFixed(3)) : 0,
      mean: Number(mean.toFixed(3)),
      stdDev: Number(stdDev.toFixed(3))
    };

    return {
      totalRequests,
      successfulRequests,
      failedRequests,
      errorRate: Number(errorRate.toFixed(4)),
      durationMs: this.durationMs,
      throughputRps,
      latency: latencyMetrics,
      byStatusCode: { ...this.byStatusCode },
      byErrorType: { ...this.byErrorType },
      resources: {
        initialHeapUsedBytes,
        finalHeapUsedBytes,
        peakHeapUsedBytes,
        heapDeltaBytes: finalHeapUsedBytes - initialHeapUsedBytes,
        sampleCount: this.resourceSamples.length
      }
    };
  }
}

module.exports = { MeasurementCollector };

