const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Op } = require('sequelize');
const config = require('../config/env');
const User = require('../models/User');
const { DEFAULT_12_VALIDATORS, resolveValidatorId, getShortValidatorId } = require('../consensus/consensusConfig');
const { UnauthorizedError, ConflictError } = require('../utils/errors');
const { validateRegisterPayload, validateLoginPayload } = require('../validators/schemas');

const revokedTokens = new Set();

function resolveLoginIdentifier(rawInput) {
  if (!rawInput || typeof rawInput !== 'string') return '';
  const clean = rawInput.trim().toLowerCase();

  // Check if input is a validator alias: v1..v12, val-01..val-12, val01..val12, node-01..node-12, or email prefix
  const localPart = clean.includes('@') ? clean.split('@')[0] : clean;
  const valMatch = localPart.match(/^(?:v|val-?|node-?)(0?[1-9]|1[0-2])$/i);
  if (valMatch) {
    const num = parseInt(valMatch[1], 10);
    return `v${num}`;
  }

  // Known role email aliases
  const emailAliases = {
    'admin@pdschain.local': 'admin',
    'admin@pdschain.gov.in': 'admin',
    'fps102@pdschain.local': 'shop',
    'shop@pdschain.local': 'shop',
    'shop@pdschain.gov.in': 'shop',
    'wh003@pdschain.local': 'warehouse',
    'warehouse@pdschain.local': 'warehouse',
    'warehouse@pdschain.gov.in': 'warehouse',
    'arun@pdschain.local': 'citizen',
    'citizen@pdschain.local': 'citizen',
    'citizen@pdschain.gov.in': 'citizen',
    'val07@pdschain.local': 'validator',
    'validator@pdschain.local': 'validator',
    'validator@pdschain.gov.in': 'validator'
  };
  if (emailAliases[clean]) {
    return emailAliases[clean];
  }

  return clean;
}

function formatUserPayload(user) {
  const isValidator = user.role === 'VALIDATOR';
  const validatorId = isValidator ? resolveValidatorId(user.entityId || 'VAL-07') : null;
  const shortValidatorId = isValidator ? getShortValidatorId(validatorId) : null;
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    name: user.name,
    email: user.email || `${user.username}@pdschain.local`,
    entityId: isValidator ? validatorId : user.entityId,
    validatorId,
    shortValidatorId
  };
}

class AuthService {
  async register(data) {
    validateRegisterPayload(data);

    const existing = await User.findOne({
      where: { username: data.username.toLowerCase().trim() }
    });

    if (existing) {
      throw new ConflictError(`Username '${data.username}' is already registered.`);
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(data.password, salt);

    let role = (data.role || 'CITIZEN').toUpperCase();
    // Public self-registration cannot grant privileged roles unless created by an authenticated ADMIN
    if (['ADMIN', 'VALIDATOR', 'SHOP', 'WAREHOUSE'].includes(role) && !data.isAdminCreated) {
      role = 'CITIZEN';
    }

    const user = await User.create({
      username: data.username.toLowerCase().trim(),
      passwordHash,
      role,
      name: data.name || data.username,
      email: data.email || `${data.username.toLowerCase().trim()}@pdschain.local`,
      entityId: data.entityId || null
    });

    const token = this.generateToken(user);

    return {
      user: formatUserPayload(user),
      token
    };
  }

  async login(username, password) {
    validateLoginPayload({ username, password });

    const rawTrimmed = username.toLowerCase().trim();
    const resolvedUsername = resolveLoginIdentifier(rawTrimmed);

    let user = await User.scope('withPassword').findOne({
      where: {
        [Op.or]: [
          { username: rawTrimmed },
          { username: resolvedUsername },
          { email: rawTrimmed }
        ]
      }
    });

    // If logging in as v1..v12 in dev/test and the account was not yet seeded in an older DB snapshot,
    // provision it from the canonical validator registry on first login if the validator password matches.
    const valMatch = resolvedUsername.match(/^v([1-9]|1[0-2])$/);
    if (!user && valMatch && config.NODE_ENV !== 'production') {
      const idx = parseInt(valMatch[1], 10) - 1;
      const vDef = DEFAULT_12_VALIDATORS[idx];
      const expectedDemoPw = process.env.DEMO_VALIDATOR_PASSWORD || 'validator123';
      if (vDef && (password === expectedDemoPw || password === `${resolvedUsername}123`)) {
        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash(password, salt);
        user = await User.create({
          username: resolvedUsername,
          passwordHash,
          role: 'VALIDATOR',
          name: `${vDef.shortId} — ${vDef.name} (${vDef.validatorId})`,
          email: `${resolvedUsername}@pdschain.local`,
          entityId: vDef.validatorId
        });
      }
    }

    if (!user) {
      throw new UnauthorizedError('Invalid credentials. Check username and password.');
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      throw new UnauthorizedError('Invalid credentials. Check username and password.');
    }

    const token = this.generateToken(user);

    return {
      user: formatUserPayload(user),
      token
    };
  }

  generateToken(user) {
    const payload = formatUserPayload(user);
    return jwt.sign(
      {
        id: payload.id,
        username: payload.username,
        role: payload.role,
        entityId: payload.entityId,
        validatorId: payload.validatorId,
        shortValidatorId: payload.shortValidatorId
      },
      config.JWT_SECRET,
      { expiresIn: config.JWT_EXPIRES_IN }
    );
  }

  revokeToken(token) {
    if (token && typeof token === 'string') {
      revokedTokens.add(token.trim());
    }
  }

  isTokenRevoked(token) {
    return Boolean(token && revokedTokens.has(token.trim()));
  }
}

module.exports = new AuthService();

