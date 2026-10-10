// Hours sheet: one row per work session.
// Data shape: {"rows":{"<id>":{"date":"YYYY-MM-DD","person":"","task":"","hours":0,"note":""}}}
// Rows live under ids from EvKit.newId(). The order on screen is a view (by
// date when the sheet opens or "Sort by date" is pressed) and is not stored.
(function () {
  'use strict';

  const doc = EvKit.init();
  const data = doc.data;
  const isMap = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  data.rows = isMap(data.rows) ? data.rows : {};
  let view = []; // [id, row] pairs in the order shown

  const todayStr = () => {
    const d = new Date();
    return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  };

  // ---------- Build the UI (only exists at runtime, never saved) ----------
  // The Save button and status are marked data-ev-fallback: the kit hides them in the host
  // and wires them in a browser.
  const app = document.getElementById('ev-app');
  app.innerHTML = `
    <main>
      <header>
        <h1>Hours sheet</h1>
        <span id="status" data-ev-fallback="status">Saved</span>
      </header>

      <div class="bar">
        <button id="add" class="primary">Add row</button>
        <label>Person
          <select id="fPerson"><option value="">All</option></select>
        </label>
        <label>Month
          <input type="month" id="fMonth">
        </label>
        <button id="clearFilter" title="Show all rows">Clear filter</button>
        <span class="spacer"></span>
        <button id="sort">Sort by date</button>
        <button id="save" class="primary" data-ev-fallback="save">Save</button>
      </div>

      <div class="sheet">
        <table>
          <thead>
            <tr>
              <th class="c-date">Date</th>
              <th class="c-person">Person</th>
              <th class="c-task">Task</th>
              <th class="c-hours num">Hours</th>
              <th>Note</th>
              <th class="c-del"></th>
            </tr>
          </thead>
          <tbody id="rows"></tbody>
          <tfoot>
            <tr>
              <td colspan="3">Total</td>
              <td class="num" id="total">0</td>
              <td colspan="2" id="count" style="font-weight:400;color:var(--muted)"></td>
            </tr>
          </tfoot>
        </table>
        <div class="empty" id="empty" hidden>No entries yet. Use “Add row” to log the first work session.</div>
      </div>

      <div id="people"></div>

      <p class="hint">
        ${doc.hosted
          ? 'Save with <kbd>Ctrl</kbd>+<kbd>S</kbd> (or <kbd>Cmd</kbd>+<kbd>S</kbd>) or File → Save.'
          : 'Save with <kbd>Ctrl</kbd>+<kbd>S</kbd> (or <kbd>Cmd</kbd>+<kbd>S</kbd>). In Chrome and Edge, pick this file once ' +
            'and it is remembered; later saves overwrite it. In other browsers a new copy of this page is downloaded; ' +
            'replace the old file with it.'}
      </p>
    </main>
    <datalist id="persons"></datalist>
    <datalist id="tasks"></datalist>
  `;

  const $ = (id) => document.getElementById(id);
  const tbody = $('rows');

  // ---------- Helpers ----------
  const fmt = (n) => (Math.round(n * 100) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 });

  function unique(field) {
    return [...new Set(Object.values(data.rows).map(r => (r[field] || '').trim()).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b));
  }

  function fillDatalist(id, values) {
    const dl = $(id);
    dl.innerHTML = '';
    values.forEach(v => { const o = document.createElement('option'); o.value = v; dl.append(o); });
  }

  function refreshLists() {
    const persons = unique('person');
    fillDatalist('persons', persons);
    fillDatalist('tasks', unique('task'));
    const sel = $('fPerson');
    const current = sel.value;
    sel.innerHTML = '<option value="">All</option>';
    persons.forEach(p => { const o = document.createElement('option'); o.value = p; o.textContent = p; sel.append(o); });
    sel.value = persons.includes(current) ? current : '';
  }

  function isVisible(r) {
    const p = $('fPerson').value, m = $('fMonth').value;
    if (p && (r.person || '').trim() !== p) return false;
    if (m && !(r.date || '').startsWith(m)) return false;
    return true;
  }

  function applyFilterAndTotals() {
    let total = 0, shown = 0;
    const byPerson = new Map();
    const trs = tbody.children;
    for (let i = 0; i < trs.length; i++) {
      const r = view[i][1];
      const vis = isVisible(r);
      trs[i].hidden = !vis;
      if (vis) {
        shown++;
        const h = Number(r.hours) || 0;
        total += h;
        const key = (r.person || '').trim() || '(no person)';
        byPerson.set(key, (byPerson.get(key) || 0) + h);
      }
    }
    $('total').textContent = fmt(total);
    $('count').textContent = shown + (shown === 1 ? ' entry' : ' entries');
    $('empty').hidden = view.length > 0;

    const box = $('people');
    box.innerHTML = '';
    [...byPerson.entries()].sort((a, b) => a[0].localeCompare(b[0])).forEach(([name, h]) => {
      const s = document.createElement('span');
      s.textContent = name;
      const b = document.createElement('b');
      b.textContent = fmt(h) + ' h';
      s.append(b);
      box.append(s);
    });
  }

  // ---------- Rows ----------
  function cell(cls, input) {
    const td = document.createElement('td');
    if (cls) td.className = cls;
    td.append(input);
    return td;
  }

  function field(row, key, type, extra = {}) {
    const i = document.createElement('input');
    i.type = type;
    i.setAttribute('aria-label', key);
    Object.entries(extra).forEach(([k, v]) => i.setAttribute(k, v));
    i.value = key === 'hours' ? (row.hours || '') : (row[key] || '');
    i.addEventListener('input', () => {
      row[key] = key === 'hours' ? (parseFloat(i.value.replace(',', '.')) || 0) : i.value;
      doc.changed();
      applyFilterAndTotals();
    });
    if (key === 'person' || key === 'task') i.addEventListener('change', refreshLists);
    return i;
  }

  function makeRow(id, row) {
    const tr = document.createElement('tr');
    tr.append(
      cell('', field(row, 'date', 'date')),
      cell('', field(row, 'person', 'text', { list: 'persons', autocomplete: 'off' })),
      cell('', field(row, 'task', 'text', { list: 'tasks', autocomplete: 'off' })),
      cell('num', field(row, 'hours', 'text', { inputmode: 'decimal', placeholder: '0' })),
      cell('', field(row, 'note', 'text'))
    );
    const del = document.createElement('td');
    del.className = 'del';
    const b = document.createElement('button');
    b.textContent = '×';
    b.title = 'Delete row';
    b.setAttribute('aria-label', 'Delete row');
    b.addEventListener('click', () => {
      const idx = view.findIndex(([vid]) => vid === id);
      if (idx < 0) return;
      view.splice(idx, 1);
      delete data.rows[id];
      tr.remove();
      doc.changed();
      refreshLists();
      applyFilterAndTotals();
    });
    del.append(b);
    tr.append(del);
    return tr;
  }

  // Sorting is a view: it changes what is shown, never the data.
  function byDate() {
    return Object.entries(data.rows)
      .sort((a, b) => (a[1].date || '').localeCompare(b[1].date || '') || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  }

  function renderAll() {
    view = byDate();
    tbody.innerHTML = '';
    view.forEach(([id, r]) => tbody.append(makeRow(id, r)));
    refreshLists();
    applyFilterAndTotals();
  }

  $('add').addEventListener('click', () => {
    const last = view.length ? view[view.length - 1][1] : null;
    const row = {
      date: $('fMonth').value ? ($('fMonth').value + '-01') : todayStr(),
      person: $('fPerson').value || (last ? last.person : '') || '',
      task: '', hours: 0, note: ''
    };
    if ($('fMonth').value && todayStr().startsWith($('fMonth').value)) row.date = todayStr();
    const id = EvKit.newId();
    data.rows[id] = row;
    view.push([id, row]);
    const tr = makeRow(id, row);
    tbody.append(tr);
    doc.changed();
    applyFilterAndTotals();
    const target = row.person ? tr.querySelector('td:nth-child(3) input') : tr.querySelector('td:nth-child(2) input');
    target.focus();
  });

  $('sort').addEventListener('click', renderAll);

  $('fPerson').addEventListener('change', applyFilterAndTotals);
  $('fMonth').addEventListener('input', applyFilterAndTotals);
  $('clearFilter').addEventListener('click', () => {
    $('fPerson').value = ''; $('fMonth').value = '';
    applyFilterAndTotals();
  });

  renderAll();
})();
