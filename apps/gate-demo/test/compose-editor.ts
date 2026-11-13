// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { audioEditorCapabilities } from '@taalcut/audio';
import {
  availableEditorCapabilities,
  commandCapabilities,
  queryCapabilities,
} from '@taalcut/core';
import { renderEditorCapabilities } from '@taalcut/render';
import { timelineEditorCapabilities } from '@taalcut/timeline';
import { editorCatalogueTool, type ToolRegistry } from '@taalcut/tools';

/** Mirrors desktop composition; the cassette contract test catches catalogue drift. */
export function demoEditorCatalogue(registry: () => ToolRegistry) {
  return editorCatalogueTool(() =>
    availableEditorCapabilities(
      [
        timelineEditorCapabilities,
        renderEditorCapabilities,
        audioEditorCapabilities,
        [
          ...commandCapabilities(['history.undo', 'history.redo']),
          ...queryCapabilities(['history.get', 'editor.capabilities']),
        ],
      ],
      (name) => registry().resolve(name) !== undefined,
    ),
  );
}
