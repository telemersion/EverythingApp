'use strict';
const path = require('node:path');

function parentOf(p) {
  return path.dirname(p);
}

function folderName(p) {
  // Directly in a root, the parent's base name is empty: use the whole parent path.
  return path.basename(parentOf(p)) || parentOf(p);
}

// File names; paths sharing a name get "name · folder", and "name · full parent path" if that collides too.
function documentLabels(paths) {
  const byName = new Map();
  for (const p of paths) {
    const name = path.basename(p);
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name).push(p);
  }
  const labels = new Map();
  for (const [name, group] of byName) {
    const unique = [...new Set(group)];
    if (unique.length < 2) {
      labels.set(unique[0], name);
      continue;
    }
    const counts = new Map();
    for (const p of unique) counts.set(folderName(p), (counts.get(folderName(p)) || 0) + 1);
    for (const p of unique) {
      const folder = counts.get(folderName(p)) > 1 ? parentOf(p) : folderName(p);
      labels.set(p, `${name} · ${folder}`);
    }
  }
  // Keep the caller's order.
  return new Map(paths.map((p) => [p, labels.get(p)]));
}

module.exports = { documentLabels };
