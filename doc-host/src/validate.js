'use strict';

const MAX_DATA_BYTES = 50 * 1024 * 1024;

// Checks a snapshot the document handed to the host. Returns an error
// message, or null if the snapshot may be written.
function validateSnapshot(json, maxBytes = MAX_DATA_BYTES) {
  if (typeof json !== 'string') return 'The document returned no data (expected a JSON string).';
  if (Buffer.byteLength(json, 'utf8') > maxBytes) {
    return `The data is larger than ${Math.round(maxBytes / 1024 / 1024)} MB.`;
  }
  let value;
  try {
    value = JSON.parse(json);
  } catch (err) {
    return `The document returned invalid JSON: ${err.message}`;
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return 'The data must be a JSON object.';
  }
  return null;
}

module.exports = { MAX_DATA_BYTES, validateSnapshot };
