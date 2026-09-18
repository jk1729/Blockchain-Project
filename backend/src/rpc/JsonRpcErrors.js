/**
 * PDSChain JSON-RPC 2.0 Standard & Domain Error Definitions (Phase 14)
 */

const RPC_ERRORS = {
  // Standard JSON-RPC 2.0 Error Codes
  PARSE_ERROR: { code: -32700, message: 'Parse error: Invalid JSON was received by the server.' },
  INVALID_REQUEST: { code: -32600, message: 'Invalid Request: The JSON sent is not a valid Request object.' },
  METHOD_NOT_FOUND: { code: -32601, message: 'Method not found: The method does not exist / is not available.' },
  INVALID_PARAMS: { code: -32602, message: 'Invalid params: Invalid method parameter(s).' },
  INTERNAL_ERROR: { code: -32603, message: 'Internal error: Internal JSON-RPC error.' },

  // PDSChain Domain-Specific Error Codes (-32000 to -32099)
  EXECUTION_ERROR: { code: -32000, message: 'Execution error: Smart contract or transaction execution failed.' },
  RESOURCE_NOT_FOUND: { code: -32001, message: 'Resource not found: Requested block, transaction, or entity not found.' },
  TRANSACTION_REJECTED: { code: -32002, message: 'Transaction rejected: Nonce conflict, insufficient balance, or invalid signature.' },
  CONSENSUS_SYNC_ERROR: { code: -32003, message: 'Consensus/Sync error: Node is currently synchronizing or consensus is degraded.' },
  RATE_LIMIT_EXCEEDED: { code: -32004, message: 'Rate limit exceeded: Too many requests sent to this node.' },
  UNAUTHORIZED: { code: -32005, message: 'Unauthorized: Authentication required or invalid credentials.' }
};

class JsonRpcError extends Error {
  constructor(errorSpec, customMessage = null, data = null) {
    super(customMessage || errorSpec.message);
    this.code = errorSpec.code;
    this.name = 'JsonRpcError';
    if (data !== null && data !== undefined) {
      this.data = data;
    }
  }

  toJSON() {
    const res = {
      code: this.code,
      message: this.message
    };
    if (this.data !== undefined) {
      res.data = this.data;
    }
    return res;
  }
}

function createErrorResponse(id, rpcError, customMessage = null, data = null) {
  let msg = rpcError.message;
  let errorData = data;
  if (typeof customMessage === 'string') {
    msg = customMessage;
  } else if (customMessage !== null && customMessage !== undefined && data === null) {
    errorData = customMessage;
  }

  const errorObj = {
    code: rpcError.code,
    message: msg
  };
  if (errorData !== null && errorData !== undefined) {
    errorObj.data = errorData;
  }
  return {
    jsonrpc: '2.0',
    id: id !== undefined ? id : null,
    error: errorObj
  };
}

module.exports = {
  RPC_ERRORS,
  JsonRpcError,
  createErrorResponse
};
