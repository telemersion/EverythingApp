'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { htmlAssociationSheet, aboutSheet } = require('../src/help');

test('the HTML association sheet explains the steps for the OS', () => {
  assert.deepEqual(htmlAssociationSheet('darwin'), {
    message: 'Use EverythingApp for HTML documents',
    detail: 'In Finder, select any .html file and choose File → Get Info. Under "Open with", pick EverythingApp, then click Change All.',
    buttons: ['OK'],
  });
  assert.equal(htmlAssociationSheet('win32').detail,
    'Right-click any .html file and choose Open with → Choose another app. Pick EverythingApp and select Always.');
});

test('the About sheet names the version and Electron', () => {
  assert.deepEqual(aboutSheet({ version: '0.1.0', electron: '44.5.1' }),
    { message: 'EverythingApp', detail: 'Version 0.1.0\nElectron 44.5.1', buttons: ['OK'] });
});
