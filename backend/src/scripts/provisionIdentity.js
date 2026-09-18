#!/usr/bin/env node

/**
 * CLI Tool: Provision PDSChain Validator Identity (Phase 11)
 * 
 * Usage:
 *   node src/scripts/provisionIdentity.js --id VAL-01 --out ./identity/val-01.json [--force]
 */

const path = require('path');
const { IdentityProvisioner } = require('../blockchain/identity/IdentityProvisioner');

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    id: null,
    out: null,
    institution: null,
    operator: null,
    force: false
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--id' && args[i + 1]) {
      options.id = args[++i];
    } else if (args[i] === '--out' && args[i + 1]) {
      options.out = args[++i];
    } else if (args[i] === '--institution' && args[i + 1]) {
      options.institution = args[++i];
    } else if (args[i] === '--operator' && args[i + 1]) {
      options.operator = args[++i];
    } else if (args[i] === '--force') {
      options.force = true;
    }
  }

  return options;
}

function main() {
  const options = parseArgs();

  if (!options.id) {
    console.error('Error: --id <VALIDATOR_ID> is required (e.g. --id VAL-01)');
    process.exit(1);
  }

  const validatorId = options.id.toUpperCase().trim();
  const outFile = options.out || path.resolve(process.cwd(), 'database', 'validators', validatorId, 'identity.json');

  console.log(`Generating Ed25519 cryptographic identity for ${validatorId}...`);
  const identity = IdentityProvisioner.generate(validatorId, {
    institution: options.institution,
    operator: options.operator
  });

  console.log(`Writing identity to: ${outFile}`);
  try {
    IdentityProvisioner.saveToFile(outFile, identity, { overwrite: options.force });
    console.log(`Success! Identity provisioned for ${validatorId}:`);
    console.log(`  Address:    ${identity.address}`);
    console.log(`  Public Key: ${identity.publicKey}`);
    console.log(`  File:       ${outFile}`);
    console.log(`  Permissions: Read/Write by owner only (0600)`);
  } catch (err) {
    console.error(`Failed to save identity: ${err.message}`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { main };

