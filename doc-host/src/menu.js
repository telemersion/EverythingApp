'use strict';

const { Menu, shell } = require('electron');

// Docked DevTools would sit inside the view's own bounds (the host UI lies beneath the documents).
function toggleDetachedDevTools(contents) {
  if (contents.isDevToolsOpened()) contents.closeDevTools();
  else contents.openDevTools({ mode: 'detach' });
}

// Ids of the items that need an active document.
const DOCUMENT_ITEMS = ['save', 'close', 'reveal', 'reload', 'dev-tools'];

// The application menu. Items act on the workspace's active document;
// workspace.apply() refreshes their enabled and checked states (updateMenu).
// Menu accelerators fire while a document view has keyboard focus (M2 Task 1
// spike), so no shortcut needs a before-input-event handler.
function buildMenu({ workspace, isDev }) {
  const isMac = process.platform === 'darwin';
  // Runs fn; anything it throws is shown as "could not <action> <file>".
  const run = (action, fn, filePath) => Promise.resolve()
    .then(fn)
    .catch((err) => workspace.showError({ action, filePath, err }));
  const withDoc = (action, fn) => () => {
    const doc = workspace.activeDocument();
    if (doc) run(action, () => fn(doc), doc.filePath);
  };

  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'Open…', accelerator: 'CmdOrCtrl+O', click: () => run('show the open dialog', () => workspace.openDialog()) },
        { id: 'save', label: 'Save', accelerator: 'CmdOrCtrl+S', click: withDoc('save', (doc) => doc.save()) },
        { id: 'close', label: 'Close', accelerator: 'CmdOrCtrl+W', click: withDoc('close', (doc) => workspace.closeDocument(doc.id)) },
        { label: 'Close Window', accelerator: 'CmdOrCtrl+Shift+W', click: () => workspace.win.close() },
        { type: 'separator' },
        // Update Kit… (update-kit) and Undo Kit Update (undo-kit) come in Task 13.
        { id: 'reveal', label: isMac ? 'Reveal in Finder' : 'Show in folder', click: withDoc('show', (doc) => shell.showItemInFolder(doc.filePath)) },
        ...(isMac ? [] : [{ type: 'separator' }, { role: 'quit' }]),
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { id: 'list-visible', label: 'Document List', type: 'checkbox', click: () => workspace.setList({ visible: !workspace.model.list.visible }) },
        { id: 'list-mode-list', label: 'List', type: 'radio', click: () => workspace.setList({ mode: 'list' }) },
        { id: 'list-mode-thumbnails', label: 'Thumbnails', type: 'radio', click: () => workspace.setList({ mode: 'thumbnails' }) },
        { type: 'separator' },
        // Split Right (split-right) and Split Down (split-down) come in Task 11.
        { id: 'reload', label: 'Reload', accelerator: 'CmdOrCtrl+R', click: withDoc('reload', (doc) => doc.reloadInteractive()) },
        ...(isDev ? [{
          id: 'dev-tools',
          label: 'Developer Tools',
          accelerator: isMac ? 'Alt+Cmd+I' : 'Ctrl+Shift+I',
          click: withDoc('open the developer tools for', (doc) => toggleDetachedDevTools(doc.view.webContents)),
        }, {
          id: 'host-ui-dev-tools',
          label: 'Host UI Developer Tools',
          click: () => run('open the developer tools for the host UI', () => toggleDetachedDevTools(workspace.hostUi.view.webContents)),
        }] : []),
      ],
    },
    {
      label: 'Window',
      role: 'window',
      submenu: [
        { role: 'minimize' },
        ...(isMac ? [{ role: 'zoom' }] : []),
        { type: 'separator' },
        { label: 'Next Tab', accelerator: 'Ctrl+Tab', click: () => workspace.cycleTab(1) },
        { label: 'Previous Tab', accelerator: 'Ctrl+Shift+Tab', click: () => workspace.cycleTab(-1) },
        {
          label: 'Select Tab',
          submenu: [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => ({
            label: `Tab ${n}`,
            accelerator: `CmdOrCtrl+${n}`,
            click: () => workspace.selectTabAt(n - 1),
          })),
        },
        {
          label: 'Focus Pane',
          submenu: ['Left', 'Right', 'Up', 'Down'].map((side) => ({
            label: side,
            accelerator: `CmdOrCtrl+Alt+${side}`,
            click: () => workspace.focusNeighbour(side.toLowerCase()),
          })),
        },
      ],
    },
  ];
  const menu = Menu.buildFromTemplate(template);
  updateMenu(menu, workspace);
  return menu;
}

// Enabled and checked states from the workspace.
function updateMenu(menu, workspace) {
  const item = (id) => menu.getMenuItemById(id);
  const hasDocument = workspace.activeDocument() !== null;
  for (const id of DOCUMENT_ITEMS) if (item(id)) item(id).enabled = hasDocument;
  const { list } = workspace.model;
  item('list-visible').checked = list.visible;
  item('list-mode-list').checked = list.mode === 'list';
  item('list-mode-thumbnails').checked = list.mode === 'thumbnails';
}

module.exports = { buildMenu, updateMenu };
