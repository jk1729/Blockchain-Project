/**
 * Phase 19: OpenTelemetry-Compatible Distributed Tracing Test Suite
 */

const { Span, SPAN_STATUS } = require('../src/observability/Span');
const { Tracer } = require('../src/observability/Tracer');
const RequestContext = require('../src/observability/RequestContext');

describe('Phase 19: Distributed Tracing & Spans', () => {
  describe('1. Span Lifecycle & Secret Redaction', () => {
    test('should track span start, end, and duration', async () => {
      const span = new Span('test_operation', {
        traceId: '1234567890abcdef1234567890abcdef',
        spanId: '1234567890abcdef'
      });

      expect(span.ended).toBe(false);
      await new Promise((resolve) => setTimeout(resolve, 20));
      span.end();

      expect(span.ended).toBe(true);
      expect(span.durationMs).toBeGreaterThanOrEqual(15);
      expect(span.toJSON().durationMs).toBe(span.durationMs);
    });

    test('should redact secrets in span attributes and bound value length', () => {
      const span = new Span('sensitive_op', { traceId: '123', spanId: '456' });
      span.setAttribute('user.password', 'super_secret_pw');
      span.setAttribute('auth.header', 'Bearer mySecretToken12345');
      span.setAttribute('long.value', 'x'.repeat(600));

      const json = span.toJSON();
      expect(json.attributes['user.password']).toBe('[REDACTED]');
      expect(json.attributes['auth.header']).toBe('Bearer [REDACTED_JWT]');
      expect(json.attributes['long.value']).toContain('...[TRUNCATED]');
    });

    test('recordException should mark status ERROR and attach error attributes', () => {
      const span = new Span('failing_op', { traceId: '123', spanId: '456' });
      const err = new Error('Consensus timeout in round 3');
      err.code = 'ROUND_TIMEOUT';

      span.recordException(err);
      span.end();

      const json = span.toJSON();
      expect(json.status.code).toBe(SPAN_STATUS.ERROR);
      expect(json.status.message).toBe('Consensus timeout in round 3');
      expect(json.attributes['error.name']).toBe('Error');
      expect(json.attributes['error.code']).toBe('ROUND_TIMEOUT');
    });
  });

  describe('2. Tracer Active Spans & Context Propagation', () => {
    test('startActiveSpan should execute callback with active context and end automatically', async () => {
      const tracer = new Tracer({ exporter: 'memory', sampleRate: 1.0 });

      await tracer.startActiveSpan('parent_job', async (parentSpan) => {
        parentSpan.setAttribute('component', 'CONSENSUS');

        // Check active context inside parent span
        expect(RequestContext.get('spanId')).toBe(parentSpan.spanId);

        // Run child active span
        await tracer.startActiveSpan('child_job', async (childSpan) => {
          expect(childSpan.parentSpanId).toBe(parentSpan.spanId);
          expect(childSpan.traceId).toBe(parentSpan.traceId);
        });
      });

      const exported = tracer.getExportedSpans();
      expect(exported.length).toBe(2);
      expect(exported[0].name).toBe('child_job');
      expect(exported[1].name).toBe('parent_job');
      expect(exported[0].parentSpanId).toBe(exported[1].spanId);
    });

    test('should reject sampling when sampleRate is 0.0', () => {
      const tracer = new Tracer({ exporter: 'memory', sampleRate: 0.0 });
      const span = tracer.startSpan('unsampled_span');
      expect(span.isSampled).toBe(false);

      span.end();
      expect(tracer.getExportedSpans().length).toBe(0);
    });
  });
});

