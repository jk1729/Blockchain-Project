/**
 * Non-destructive 12-Validator Provisioning Script (V1..V12 / VAL-01..VAL-12)
 *
 * Provisions:
 * 1. Isolated Ed25519 keypair identity files in database/validators/VAL-XX/identity.json
 * 2. Canonical public key records in the SQLite/PostgreSQL `validators` table
 * 3. Twelve distinct authenticated demo login accounts (v1..v12) in the `users` table
 *
 * Preserves all existing blocks, transactions, beneficiaries, shops, warehouses, and audit logs.
 */

const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { sequelize } = require('../config/database');
const User = require('../models/User');
const Validator = require('../models/Validator');
const { DEFAULT_12_VALIDATORS } = require('../consensus/consensusConfig');
const { getOrCreateDevParticipant } = require('../blockchain/identity/keyManager');

async function provisionValidators(options = {}) {
  const defaultPassword = options.password || process.env.DEMO_VALIDATOR_PASSWORD || 'validator123';
  const salt = await bcrypt.genSalt(10);
  const passwordHash = await bcrypt.hash(defaultPassword, salt);

  const provisioned = [];

  for (let i = 0; i < DEFAULT_12_VALIDATORS.length; i++) {
    const vDef = DEFAULT_12_VALIDATORS[i];
    const num = i + 1;
    const shortLower = `v${num}`;
    const participant = getOrCreateDevParticipant(vDef.validatorId, 'VALIDATOR');

    // 1. Write isolated identity file to database/validators/VAL-XX/identity.json
    const valDir = path.resolve(process.cwd(), '..', 'database', 'validators', vDef.validatorId);
    const altValDir = path.resolve(process.cwd(), 'database', 'validators', vDef.validatorId);
    const targetDir = fs.existsSync(path.resolve(process.cwd(), '..', 'database')) ? valDir : altValDir;
    fs.mkdirSync(targetDir, { recursive: true });

    const identityFile = path.join(targetDir, 'identity.json');
    if (!fs.existsSync(identityFile)) {
      fs.writeFileSync(
        identityFile,
        JSON.stringify(
          {
            validatorId: vDef.validatorId,
            shortId: vDef.shortId,
            name: vDef.name,
            org: vDef.org,
            address: participant.address,
            publicKey: participant.publicKey,
            privateKey: participant.privateKey,
            provisionedAt: new Date().toISOString()
          },
          null,
          2
        ),
        { mode: 0o600 }
      );
    }

    // 2. Upsert Validator record in DB with real Ed25519 public key
    const existingVal = await Validator.findOne({ where: { validatorId: vDef.validatorId } });
    if (existingVal) {
      existingVal.publicKey = participant.publicKey;
      existingVal.name = vDef.name;
      existingVal.org = vDef.org;
      existingVal.trustConfiguration = vDef.trustConfiguration;
      await existingVal.save();
    } else {
      await Validator.create({
        validatorId: vDef.validatorId,
        name: vDef.name,
        org: vDef.org,
        publicKey: participant.publicKey,
        status: 'Online',
        blockHeight: 35,
        heartbeat: 'Just now',
        txValidated: 14280 - (i * 2),
        participation: '100%',
        trustConfiguration: vDef.trustConfiguration
      });
    }

    // 3. Upsert User account (v1..v12) in `users` table
    const existingUser = await User.scope('withPassword').findOne({ where: { username: shortLower } });
    if (!existingUser) {
      await User.create({
        username: shortLower,
        passwordHash,
        role: 'VALIDATOR',
        name: `${vDef.shortId} — ${vDef.name} (${vDef.validatorId})`,
        email: `${shortLower}@pdschain.local`,
        entityId: vDef.validatorId
      });
    } else {
      existingUser.role = 'VALIDATOR';
      existingUser.name = `${vDef.shortId} — ${vDef.name} (${vDef.validatorId})`;
      existingUser.entityId = vDef.validatorId;
      await existingUser.save();
    }

    provisioned.push({
      validatorId: vDef.validatorId,
      shortId: vDef.shortId,
      username: shortLower,
      email: `${shortLower}@pdschain.local`,
      name: vDef.name,
      org: vDef.org,
      address: participant.address,
      publicKeyPrefix: `${participant.publicKey.slice(0, 16)}...`,
      port: vDef.port,
      p2pPort: vDef.p2pPort
    });
  }

  return provisioned;
}

if (require.main === module) {
  provisionValidators()
    .then(async (list) => {
      console.log(JSON.stringify({ success: true, count: list.length, validators: list }, null, 2));
      await sequelize.close();
    })
    .catch(async (err) => {
      console.error('Provisioning failed:', err);
      await sequelize.close();
      process.exit(1);
    });
}

module.exports = { provisionValidators };
