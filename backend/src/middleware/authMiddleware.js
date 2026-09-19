const jwt = require('jsonwebtoken');
const config = require('../config/env');
const { UnauthorizedError } = require('../utils/errors');
const User = require('../models/User');

async function authMiddleware(req, res, next) {
  try {
    let token;
    const authHeader = req.headers.authorization;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1];
    } else if (req.query && req.query.token) {
      // Explicitly reject query-string token authentication for security (CWE-598)
      throw new UnauthorizedError('Passing authentication tokens via query string is not permitted. Use Authorization: Bearer <token>.');
    }

    if (!token) {
      throw new UnauthorizedError('Authentication token missing. Please log in.');
    }

    const decoded = jwt.verify(token, config.JWT_SECRET);
    const user = await User.findByPk(decoded.id);

    if (!user) {
      throw new UnauthorizedError('User account associated with token no longer exists.');
    }

    req.user = {
      id: user.id,
      username: user.username,
      role: user.role,
      name: user.name,
      entityId: user.entityId
    };

    next();
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return next(err);
    }
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError' || err instanceof SyntaxError) {
      return next(new UnauthorizedError('Invalid authentication token'));
    }
    next(err);
  }
}

// Optional Auth (doesn't fail if no token, but populates req.user if valid)
async function optionalAuthMiddleware(req, res, next) {
  try {
    let token = null;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1];
    }
    // Note: Query parameter tokens are intentionally rejected/ignored for security

    if (token) {
      const decoded = jwt.verify(token, config.JWT_SECRET);
      const user = await User.findByPk(decoded.id);
      if (user) {
        req.user = {
          id: user.id,
          username: user.username,
          role: user.role,
          name: user.name,
          entityId: user.entityId
        };
      }
    }
  } catch (e) {
    // Ignore invalid token in optional mode
  }
  next();
}

module.exports = {
  authMiddleware,
  optionalAuthMiddleware
};
