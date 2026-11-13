// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

export { editorBrief, withEditor, type EditorBrief } from './editor-brief';
export { createEditorResolver, type EditorResolver, type EditorSources } from './editor-port';
export {
  EDITOR_TURN_FAMILIES,
  editorRoute,
  MAKE_WORDS,
  QUESTION_STARTS,
  type EditorRoute,
} from './editor-route';
export { editorFocus, editorMentions, type EditorFocus, type EditorMention } from './editor-words';
