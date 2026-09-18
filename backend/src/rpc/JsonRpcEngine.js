/**
 * PDSChain JSON-RPC 2.0 Execution Engine (Phases 14 & 17 Hardening)
 * 
 * Compliant with JSON-RPC 2.0 specification:
 * - Single request and batch processing
 * - Standard and domain error code mapping (-32005 UNAUTHORIZED)
 * - Method-level authorization via central AuthorizationService
 * - Secret redaction on outputs
 * - Request validation and bounds enforcement
 */

const { RPC_ERRORS, JsonRpcError, createErrorResponse } = require('./JsonRpcErrors');
const defaultMethods = require('./methods');
const { sanitizeSecrets } = require('../api/ResponseEnvelope');
const { defaultAuthorizationService } = require('../security/permissions');

const RPC_METHOD_PERMISSIONS = Object.freeze({
  // Public read queries
  'pds_blockNumber': 'public:read:chain',
  'pds_getBlockByNumber': 'public:read:block',
  'pds_getBlockByHash': 'public:read:block',
  'pds_getBlockTransactionCountByNumber': 'public:read:block',
  'pds_getBlockTransactionCountByHash': 'public:read:block',
  'pds_getTransactionByHash': 'public:read:transaction',
  'pds_getTransactionReceipt': 'public:read:receipt',
  'pds_validateChain': 'public:read:chain',
  'pds_getValidators': 'public:read:validator-summary',
  'pds_getConsensusStatus': 'public:read:validator-summary',
  'pds_getQuorum': 'public:read:validator-summary',
  'pds_getQuorumInfo': 'public:read:validator-summary',
  'pds_getNetworkStatus': 'public:read:network-summary',
  'pds_getNetworkTopology': 'public:read:network-summary',
  'pds_getPeerList': 'public:read:network-summary',
  'pds_getSyncStatus': 'public:read:chain',
  'pds_getEvents': 'public:read:event',
  'pds_getEventById': 'public:read:event',
  'pds_getContractEvents': 'public:read:event',
  'pds_getCode': 'public:read:contract',
  'pds_getTransactionProof': 'public:read:proof',
  'pds_getReceiptProof': 'public:read:proof',
  'pds_getEventProof': 'public:read:proof',
  'pds_verifyMerkleProof': 'public:read:proof',
  'pds_getMerkleRoot': 'public:read:proof',
  'pds_getProofStatus': 'public:read:proof',

  // Client operations
  'pds_sendRawTransaction': 'client:submit:transaction',
  'pds_call': 'public:read:contract',
  'pds_estimateGas': 'client:estimate:gas',

  // Consensus & Operator operations
  'pds_propose': 'client:submit:transaction', // Requires authenticated transaction submitter / proposer
  'pds_rebuildProofIndex': 'operator:trigger:reindex',
  'pds_rotateConsensusKey': 'security:stage:key-rotation',
  'pds_triggerSync': 'operator:trigger:sync',
  'pds_reloadCertificates': 'security:reload:certificate'
});

class JsonRpcEngine {
  constructor(options = {}) {
    this.methods = new Map();
    this.maxBatchSize = options.maxBatchSize || 20;
    this.authService = options.authService || defaultAuthorizationService;
    this.methodPermissions = { ...RPC_METHOD_PERMISSIONS, ...(options.methodPermissions || {}) };

    // Register default methods
    this.registerMethods(options.methods || defaultMethods);
  }

  registerMethod(name, handler, requiredPermission = null) {
    if (typeof handler !== 'function') {
      throw new Error(`Handler for JSON-RPC method '${name}' must be a function.`);
    }
    this.methods.set(name, handler);
    if (requiredPermission) {
      this.methodPermissions[name] = requiredPermission;
    }
  }

  registerMethods(methodsMap) {
    for (const [name, handler] of Object.entries(methodsMap)) {
      this.registerMethod(name, handler);
    }
  }

  hasMethod(name) {
    return this.methods.has(name);
  }

  getRegisteredMethods() {
    return Array.from(this.methods.keys());
  }

  getMethodPermission(methodName) {
    return this.methodPermissions[methodName] || 'public:read:chain';
  }

  /**
   * Process incoming request (single or batch).
   * @param {Object|Array} body - Parsed JSON body
   * @param {Object} context - Execution context (e.g. req.user, peerManager, etc.)
   * @returns {Promise<Object|Array|null>} JSON-RPC response(s)
   */
  async handle(body, context = {}) {
    // 1. Batch Request
    if (Array.isArray(body)) {
      if (body.length === 0) {
        return createErrorResponse(null, RPC_ERRORS.INVALID_REQUEST, 'Batch request array cannot be empty');
      }

      if (body.length > this.maxBatchSize) {
        return createErrorResponse(null, RPC_ERRORS.INVALID_REQUEST, `Batch size exceeds maximum limit of ${this.maxBatchSize}`);
      }

      const results = await Promise.all(
        body.map(item => this._handleSingle(item, context))
      );

      // Notifications return null and are omitted from batch responses per JSON-RPC 2.0 spec
      const nonNullResults = results.filter(r => r !== null);
      return nonNullResults.length > 0 ? nonNullResults : null;
    }

    // 2. Single Request
    return this._handleSingle(body, context);
  }

  async _handleSingle(req, context) {
    // Check if valid object
    if (!req || typeof req !== 'object' || Array.isArray(req)) {
      return createErrorResponse(null, RPC_ERRORS.INVALID_REQUEST);
    }

    const { jsonrpc, method, params, id } = req;

    // Check version
    if (jsonrpc !== '2.0') {
      return createErrorResponse(id !== undefined ? id : null, RPC_ERRORS.INVALID_REQUEST, 'Field "jsonrpc" must be "2.0"');
    }

    // Check method name
    if (typeof method !== 'string' || method.trim() === '') {
      return createErrorResponse(id !== undefined ? id : null, RPC_ERRORS.INVALID_REQUEST, 'Field "method" must be a non-empty string');
    }

    // Check if method exists
    const handler = this.methods.get(method);
    if (!handler) {
      return createErrorResponse(id !== undefined ? id : null, RPC_ERRORS.METHOD_NOT_FOUND, `Method '${method}' not found`);
    }

    // Phase 17: Method-Level Permission Authorization Check
    const requiredPermission = this.getMethodPermission(method);
    const authService = context.authService || this.authService;

    if (authService && requiredPermission) {
      const authResult = authService.evaluate({
        user: context.user || null,
        permissionId: requiredPermission,
        context: {
          method,
          requestId: context.req ? (context.req.requestId || context.req.headers['x-request-id']) : null,
          correlationId: context.req ? context.req.correlationId : null
        }
      });

      if (!authResult.allowed) {
        return createErrorResponse(
          id !== undefined ? id : null,
          RPC_ERRORS.UNAUTHORIZED,
          `Unauthorized: Method '${method}' requires permission '${requiredPermission}' (${authResult.reason})`
        );
      }
    }

    // Execute handler
    try {
      const result = await handler(params || [], context);

      // If notification (no id), no response is sent
      if (id === undefined) {
        return null;
      }

      return {
        jsonrpc: '2.0',
        id,
        result: sanitizeSecrets(result)
      };
    } catch (err) {
      if (id === undefined) {
        return null;
      }

      if (err instanceof JsonRpcError) {
        return {
          jsonrpc: '2.0',
          id,
          error: sanitizeSecrets(err.toJSON())
        };
      }

      return {
        jsonrpc: '2.0',
        id,
        error: {
          code: RPC_ERRORS.INTERNAL_ERROR.code,
          message: err.message || RPC_ERRORS.INTERNAL_ERROR.message
        }
      };
    }
  }
}

const defaultEngine = new JsonRpcEngine();

module.exports = {
  JsonRpcEngine,
  defaultEngine,
  RPC_METHOD_PERMISSIONS
};
