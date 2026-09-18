/**
 * Phase 19: Request Context & Correlation Propagation Test Suite
 */

const RequestContext = require('../src/observability/RequestContext');

describe('Phase 19: Request Context & Correlation Propagation', () => {
  describe('1. AsyncLocalStorage Context Continuity', () => {
    test('should maintain context across asynchronous delays and promise chains', async () => {
      const initialContext = {
        requestId: 'req_test_abc123',
        traceId: '1234567890abcdef1234567890abcdef',
        spanId: '1234567890abcdef',
        nodeId: 'node-01'
      };

      await RequestContext.run(initialContext, async () => {
        expect(RequestContext.get('requestId')).toBe('req_test_abc123');

        // Simulate asynchronous I/O delay
        await new Promise((resolve) => setTimeout(resolve, 20));

        // Context must still be preserved
        expect(RequestContext.get('requestId')).toBe('req_test_abc123');
        expect(RequestContext.get('traceId')).toBe('1234567890abcdef1234567890abcdef');
        expect(RequestContext.get('spanId')).toBe('1234567890abcdef');

        // Update context
        RequestContext.set('customKey', 'customValue');
        expect(RequestContext.get('customKey')).toBe('customValue');
      });

      // Context must not leak outside of run()
      expect(RequestContext.get('requestId')).toBeUndefined();
    });

    test('should wrap background tasks with preserved and extra context', async () => {
      const parentCtx = {
        requestId: 'req_parent_999',
        traceId: 'trace_parent_888'
      };

      await RequestContext.run(parentCtx, async () => {
        const result = await RequestContext.wrapTask(async () => {
          return {
            reqId: RequestContext.get('requestId'),
            workerId: RequestContext.get('workerId')
          };
        }, { workerId: 'worker-07' });

        expect(result.reqId).toBe('req_parent_999');
        expect(result.workerId).toBe('worker-07');
      });
    });
  });

  describe('2. Inbound Identifier Validation & Security Bounds', () => {
    test('should accept valid alphanumeric inbound request IDs', () => {
      expect(RequestContext.validateInboundId('req-client-12345_abc')).toBe('req-client-12345_abc');
      expect(RequestContext.validateInboundId('9876543210')).toBe('9876543210');
    });

    test('should reject empty, whitespace, or oversized request IDs', () => {
      expect(RequestContext.validateInboundId('')).toBeNull();
      expect(RequestContext.validateInboundId('   ')).toBeNull();
      expect(RequestContext.validateInboundId('a'.repeat(129))).toBeNull();
    });

    test('should reject request IDs with illegal characters or script injection', () => {
      expect(RequestContext.validateInboundId('<script>alert(1)</script>')).toBeNull();
      expect(RequestContext.validateInboundId('req/../../etc/passwd')).toBeNull();
      expect(RequestContext.validateInboundId('req\n[ERROR] faked')).toBeNull();
    });
  });

  describe('3. W3C Traceparent Header Parsing', () => {
    test('should parse valid W3C traceparent headers', () => {
      const header = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';
      const parsed = RequestContext.parseTraceParent(header);

      expect(parsed).not.toBeNull();
      expect(parsed.traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
      expect(parsed.parentSpanId).toBe('00f067aa0ba902b7');
      expect(parsed.flags).toBe('01');
    });

    test('should reject malformed traceparent headers', () => {
      expect(RequestContext.parseTraceParent('invalid-header')).toBeNull();
      expect(RequestContext.parseTraceParent('01-shorttrace-shortspan-01')).toBeNull();
      expect(RequestContext.parseTraceParent('')).toBeNull();
      expect(RequestContext.parseTraceParent(null)).toBeNull();
    });
  });
});

