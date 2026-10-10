'use strict';

// Help sheets with fixed copy (M3).

// How to make EverythingApp the default for HTML: neither operating system
// lets an app do it itself, so the host explains the steps.
function htmlAssociationSheet(platform) {
  const detail = platform === 'win32'
    ? 'Right-click any .html file and choose Open with → Choose another app. Pick EverythingApp and select Always.'
    : 'In Finder, select any .html file and choose File → Get Info. Under "Open with", pick EverythingApp, then click Change All.';
  return { message: 'Use EverythingApp for HTML documents', detail, buttons: ['OK'] };
}

// Help → About EverythingApp on Windows (macOS uses its own About panel).
function aboutSheet({ version, electron }) {
  return { message: 'EverythingApp', detail: `Version ${version}\nElectron ${electron}`, buttons: ['OK'] };
}

module.exports = { htmlAssociationSheet, aboutSheet };
