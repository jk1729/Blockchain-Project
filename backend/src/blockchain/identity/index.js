const Identity = require('./Identity');
const keyManager = require('./keyManager');
const signature = require('./signature');

module.exports = {
  Identity,
  ...keyManager,
  ...signature
};

