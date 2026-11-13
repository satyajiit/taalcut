// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { audioEditorCapabilities } from '@taalcut/audio';
import { availableEditorCapabilities, commandCapabilities, queryCapabilities } from '@taalcut/core';
import { renderEditorCapabilities } from '@taalcut/render';
import { timelineEditorCapabilities } from '@taalcut/timeline';

/** Same domain catalogue as desktop, with availability determined by the eval's real registered tools. */
export function editEditorCapabilities(registered: (name: string) => boolean) {
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
