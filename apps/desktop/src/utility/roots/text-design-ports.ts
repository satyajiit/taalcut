// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * TXT1 in the agent process: what timeline's text tools (`timeline.textLook`, `timeline.designText`,
 * `timeline.placeText`) read beside the timeline and its template: the Style a video names, and render's bundled
 * faces with their class and weights. The people under a text come from the subject tracks the module already has.
 */
import { StyleStoreToken, type Container } from '@taalcut/core';
import { textFaces } from '@taalcut/render';
import type { TimelineToolDeps } from '@taalcut/timeline';

export function textDesignPorts(container: Container): Pick<TimelineToolDeps, 'textStyle' | 'textFaces'> {
  return {
    textFaces: textFaces(),
    ...(container.has(StyleStoreToken)
      ? { textStyle: (styleId) => container.resolve(StyleStoreToken).get(styleId) }
      : {}),
  };
}
