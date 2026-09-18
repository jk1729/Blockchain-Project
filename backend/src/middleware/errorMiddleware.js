const { AppError } = require('../utils/errors');
const logger = require('../utils/logger');
const config = require('../config/env');

function errorMiddleware(err, req, res, next) {
  let statusCode = err.statusCode || 500;
  let message = err.message || 'Internal Server Error';
  let errors = err.errors || undefined;

  // Handle Sequelize validation errors
  if (err.name === 'SequelizeValidationError' || err.name === 'SequelizeUniqueConstraintError') {
    statusCode = 422;
    message = 'Database validation failed';
    errors = err.errors.map(e => e.message);
  }

  // Handle Execution and Mempool errors
  if (err.name === 'ExecutionError' || err.name === 'MempoolError') {
    statusCode = (err.code === 'ALREADY_APPLIED' || err.code === 'DUPLICATE_TRANSACTION' || err.code === 'CONFLICTING_NONCE') ? 409 : 400;
    message = err.message;
  }

  // Handle JWT errors
  if (err.name === 'JsonWebTokenError') {
    statusCode = 401;
    message = 'Invalid authentication token';
  }
  if (err.name === 'TokenExpiredError') {
    statusCode = 401;
    message = 'Authentication token expired';
  }

  if (statusCode >= 500) {
    logger.error(`[${req.method} ${req.originalUrl}] Unhandled Error:`, err.stack || err.message);
  } else {
    logger.warn(`[${req.method} ${req.originalUrl}] Operational Error (${statusCode}):`, message);
  }

  // Check if request was to JSON-RPC endpoint
  const isRpc = (req.originalUrl && (req.originalUrl.includes('/rpc'))) || (req.path && (req.path.includes('/rpc')));
  if (isRpc) {
    const isParseErr = err instanceof SyntaxError || statusCode === 400;
    return res.status(isParseErr ? 400 : statusCode).json({
      jsonrpc: '2.0',
      id: null,
      error: {
        code: isParseErr ? -32700 : -32603,
        message: isParseErr ? 'Parse error: Invalid JSON was received by the server.' : message
      }
    });
  }

  const { errorEnvelope } = require('../api/ResponseEnvelope');
  const isV1 = (req.originalUrl && req.originalUrl.startsWith('/api/v1')) || (req.path && req.path.startsWith('/api/v1')) || req.apiVersion === 'v1';
  if (isV1) {
    const errorCode = err.code || (statusCode === 404 ? 'RESOURCE_NOT_FOUND' : statusCode === 401 ? 'UNAUTHORIZED' : statusCode === 403 ? 'FORBIDDEN' : statusCode === 422 ? 'VALIDATION_ERROR' : 'INTERNAL_ERROR');
    return res.status(statusCode).json(errorEnvelope(errorCode, message, errors, req));
  }

  res.status(statusCode).json({
    success: false,
    message,
    errors,
    ...(config.NODE_ENV === 'development' && statusCode >= 500 ? { stack: err.stack } : {})
  });
}

module.exports = errorMiddleware;

