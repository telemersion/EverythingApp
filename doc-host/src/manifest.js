'use strict';

// The manifest section: what the host must know about a document's behaviour
// without running it (document specification, section 5). Checked strictly:
// only the keys the specification defines, with valid values.
const KEYS = ['textFields'];
const SEGMENT = /^(\*|[A-Za-z_][A-Za-z0-9_]*)$/;

function isPattern(value) {
  return typeof value === 'string' && value !== '' && value.split('.').every((s) => SEGMENT.test(s));
}

// Returns { manifest, errors: [{ code, message }] }; manifest is the parsed
// object when there are no errors, otherwise null.
function checkManifest(text) {
  const fail = (code, message) => ({ manifest: null, errors: [{ code, message }] });
  if (text.includes('<')) {
    return fail('manifest-escape', 'The manifest contains "<". Write every "<" in the manifest as \\u003c.');
  }
  let manifest;
  try {
    manifest = JSON.parse(text);
  } catch (err) {
    return fail('manifest-json', `The manifest must contain a JSON object: ${err.message}`);
  }
  if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return fail('manifest-json', 'The manifest must contain a JSON object, such as {}.');
  }
  const errors = [];
  for (const key of Object.keys(manifest)) {
    if (!KEYS.includes(key)) {
      errors.push({ code: 'manifest-key', message: `The manifest has the key "${key}", which the document specification does not define.` });
    }
  }
  const fields = manifest.textFields;
  if (fields !== undefined
    && (!Array.isArray(fields) || !fields.every(isPattern) || new Set(fields).size !== fields.length)) {
    errors.push({ code: 'manifest-invalid',
      message: `textFields must be a list of unique path patterns such as "rows.*.note"; found ${JSON.stringify(fields)}.` });
  }
  return { manifest: errors.length ? null : manifest, errors };
}

module.exports = { checkManifest };
