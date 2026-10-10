'use strict';

const crypto = require('node:crypto');

// A new document id: 16 random bytes as 32 lowercase hex characters.
function newDocId() {
  return crypto.randomBytes(16).toString('hex');
}

module.exports = { newDocId };
