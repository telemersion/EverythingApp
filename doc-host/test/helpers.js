'use strict';

const { buildDocument } = require('../src/frame');
const { escapeJson } = require('../src/splice');
const { currentKit } = require('../kit');

const SAMPLE_DATA = { rows: [{ note: 'a<b', price: '$&' }] };

// Parts of a small, valid test document. Override any slot.
function makeParts(overrides = {}) {
  const kit = currentKit();
  return {
    lang: 'en',
    api: '1',
    docType: 'test-doc',
    docTypeVersion: '1.0',
    title: 'Test document',
    style: '\nbody { margin: 0; }\n',
    data: escapeJson(JSON.stringify(SAMPLE_DATA)),
    kitVersion: kit.version,
    kit: kit.text,
    script: '\nwindow.testDoc = EvKit.init();\n',
    ...overrides,
  };
}

function makeDocument(overrides) {
  return buildDocument(makeParts(overrides));
}

module.exports = { SAMPLE_DATA, makeParts, makeDocument };
