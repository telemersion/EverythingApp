'use strict';

const BADGE_ORDER = ['missing', 'non-conforming', 'data-conflict', 'updated-while-dirty', 'check-error', 'kit-update'];

function emptyStatus() {
  return {
    dirty: false,
    missing: false,
    nonConforming: null,
    dataConflict: false,
    updatedWhileDirty: false,
    checkError: null,
    kitUpdate: null,
    kitUpdated: null,
    updatedFromDisk: 0, // 0 = off; else a key that changes on every start of the period
    dismissed: [],
  };
}

const COPY_REPORT = { id: 'copy-report', label: 'Copy report' };

// Per kind: when it holds, and how its banner reads.
const KINDS = {
  missing: {
    holds: (s) => s.missing,
    banner: (s, { name, filePath }) => ({
      message: `${name} was moved or deleted. Your changes exist only in this window. Put the file back at ${filePath} and save again. The last saved version is in the version store.`,
      actions: [],
      dismissLabel: 'OK',
    }),
  },
  'non-conforming': {
    holds: (s) => s.nonConforming !== null,
    banner: () => ({
      message: 'The file on disk no longer follows the document specification. This version keeps running; saving is refused until the file is fixed.',
      actions: [{ ...COPY_REPORT }],
      dismissLabel: 'OK',
    }),
  },
  'data-conflict': {
    holds: (s) => s.dataConflict,
    banner: (s, { name }) => ({
      message: `The data in ${name} was changed on disk, and you have unsaved changes.`,
      actions: [{ id: 'keep-mine', label: 'Keep mine' }, { id: 'take-disk', label: 'Take the version on disk' }],
      dismissLabel: 'Later',
    }),
  },
  'updated-while-dirty': {
    holds: (s) => s.updatedWhileDirty,
    banner: () => ({
      message: 'This document was updated on disk. Your data is unsaved.',
      actions: [{ id: 'save-reload', label: 'Save my data and reload' }, { id: 'discard-reload', label: 'Reload and discard my changes' }],
      dismissLabel: 'Later',
    }),
  },
  'check-error': {
    holds: (s) => s.checkError !== null,
    banner: (s, { name }) => ({
      message: `EverythingApp could not check ${name} for changes on disk.`,
      actions: [{ ...COPY_REPORT }],
      dismissLabel: 'OK',
    }),
  },
  'kit-update': {
    holds: (s) => s.kitUpdate !== null,
    banner: (s) => ({
      message: `This document uses kit ${s.kitUpdate.from}; ${s.kitUpdate.to} is available.`,
      actions: [{ id: 'update-kit', label: 'Update kit' }],
      dismissLabel: 'Not now',
    }),
  },
  'kit-updated': {
    holds: (s) => s.kitUpdated !== null,
    banner: (s) => ({
      message: `Kit updated to ${s.kitUpdated.to}.`,
      actions: [{ id: 'undo-kit', label: 'Undo' }],
      dismissLabel: 'OK',
    }),
  },
  'updated-from-disk': {
    holds: (s) => s.updatedFromDisk,
    banner: (s) => ({
      message: 'Updated from disk.',
      actions: [],
      dismissLabel: null,
      fadeMs: 4000,
      fadeKey: s.updatedFromDisk,
    }),
  },
};

const BANNER_ORDER = [...BADGE_ORDER, 'kit-updated', 'updated-from-disk'];

function describeStatus(status, { name, filePath }) {
  const badges = BADGE_ORDER.filter((kind) => KINDS[kind].holds(status));
  const banners = BANNER_ORDER
    .filter((kind) => KINDS[kind].holds(status) && !status.dismissed.includes(kind))
    .map((kind) => ({ kind, ...KINDS[kind].banner(status, { name, filePath }) }));
  return { badges, badge: badges.length > 0 ? badges[0] : null, banners };
}

module.exports = { emptyStatus, BADGE_ORDER, describeStatus };
