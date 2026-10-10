// Build entry of the module "codemirror": a minimal CodeMirror 6 editor
// (document specification, section 6). MODULE_VERSION is set by build.js.
import { EditorState } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { history, defaultKeymap, historyKeymap } from '@codemirror/commands';

EvKit.defineModule('codemirror', MODULE_VERSION, { EditorState, EditorView, keymap, history, defaultKeymap, historyKeymap });
