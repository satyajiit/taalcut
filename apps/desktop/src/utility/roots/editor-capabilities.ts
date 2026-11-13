// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { availableEditorCapabilities, commandCapabilities, queryCapabilities } from '@taalcut/core';
import { audioEditorCapabilities } from '@taalcut/audio';
import { timelineEditorCapabilities } from '@taalcut/timeline';
import { renderEditorCapabilities } from '@taalcut/render';

/** Domains declare actions; only desktop knows which services this installation can run. */
export function editorCapabilities(registered: (name: string) => boolean) {
  return availableEditorCapabilities(
    [
      timelineEditorCapabilities,
      renderEditorCapabilities,
      audioEditorCapabilities,
      [
        ...commandCapabilities(['history.undo', 'history.redo']),
        ...queryCapabilities(['history.get', 'editor.capabilities']),
      ],
    ],
    registered,
  );
}
