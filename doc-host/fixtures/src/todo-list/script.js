// To-do list: one entry per item, ticked off when done.
// Data shape: {"items":[{"text":"","done":false}]}
(function () {
  'use strict';

  const doc = EvKit.init({ onDirtyChange: (dirty) => showStatus(dirty) });
  const data = doc.data;
  data.items = Array.isArray(data.items) ? data.items : [];

  // In the host, the host owns saving: no Save button and no status line.
  const app = document.getElementById('ev-app');
  app.innerHTML = `
    <main>
      <header>
        <h1>To-do list</h1>
        ${doc.hosted ? '' : '<span id="status">Saved</span>'}
      </header>
      <form id="new">
        <input id="text" type="text" placeholder="New item" aria-label="New item" autocomplete="off">
        <button id="add" class="primary">Add</button>
        ${doc.hosted ? '' : '<button id="save" type="button">Save</button>'}
      </form>
      <ul id="items"></ul>
      <p id="empty" hidden>Nothing to do yet.</p>
      <p id="count"></p>
    </main>
  `;

  const $ = (id) => document.getElementById(id);

  function showStatus(dirty) {
    const s = $('status');
    if (!s) return;
    s.textContent = dirty ? 'Unsaved changes' : 'Saved';
    s.classList.toggle('dirty', dirty);
  }

  function showCount() {
    const open = data.items.filter((item) => !item.done).length;
    $('empty').hidden = data.items.length > 0;
    $('count').textContent = data.items.length ? `${open} of ${data.items.length} open` : '';
  }

  function update() {
    showCount();
    doc.changed();
  }

  function makeItem(item) {
    const li = document.createElement('li');
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = !!item.done;
    box.setAttribute('aria-label', 'Done');
    box.addEventListener('change', () => {
      item.done = box.checked;
      li.classList.toggle('done', item.done);
      update();
    });
    const text = document.createElement('span');
    text.textContent = item.text;
    const del = document.createElement('button');
    del.textContent = '×';
    del.title = 'Delete item';
    del.setAttribute('aria-label', 'Delete item');
    del.addEventListener('click', () => {
      data.items.splice(data.items.indexOf(item), 1);
      li.remove();
      update();
    });
    li.classList.toggle('done', !!item.done);
    li.append(box, text, del);
    return li;
  }

  // The form is never submitted (rule 7); Enter and the Add button add an item.
  $('new').addEventListener('submit', (event) => {
    event.preventDefault();
    const value = $('text').value.trim();
    if (!value) return;
    const item = { text: value, done: false };
    data.items.push(item);
    $('items').append(makeItem(item));
    $('text').value = '';
    update();
  });

  if (!doc.hosted) $('save').addEventListener('click', () => doc.save());

  data.items.forEach((item) => $('items').append(makeItem(item)));
  showCount();
})();
