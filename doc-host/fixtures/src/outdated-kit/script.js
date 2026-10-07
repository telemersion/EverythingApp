// Note written for kit 1.0.0: decides from doc.hosted whether to show its own Save UI.
// Data shape: {"text":""}
(function () {
  'use strict';

  const doc = EvKit.init({ onDirtyChange: (dirty) => showStatus(dirty) });
  const data = doc.data;
  data.text = typeof data.text === 'string' ? data.text : '';

  const app = document.getElementById('ev-app');
  app.innerHTML = `
    <main>
      <textarea id="text" aria-label="Note"></textarea>
      ${doc.hosted ? '' : '<button id="save" type="button">Save</button><span id="status">Saved</span>'}
    </main>
  `;

  const $ = (id) => document.getElementById(id);
  $('text').value = data.text;
  $('text').addEventListener('input', () => {
    data.text = $('text').value;
    doc.changed();
  });

  function showStatus(dirty) {
    const s = $('status');
    if (!s) return;
    s.textContent = dirty ? 'Unsaved changes' : 'Saved';
    s.classList.toggle('dirty', dirty);
  }

  if (!doc.hosted) $('save').addEventListener('click', () => doc.save());
})();
