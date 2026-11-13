// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * timeline.setStyle (P3-V10, P3-V16): the video's look from a saved Style, with the Style's caption look on the
 * captions it has. One undo step (`timeline.restore` with the style and captions as they were). Clearing the
 * Style (null) needs no store.
 */
import {
  defineCommand,
  err,
  NotImplementedError,
  ok,
  TIMELINE_COMMANDS,
  timelineCommandPayloads as payloads,
  type AsyncResult,
  type Style,
  type StyleId,
} from '@taalcut/core';
import { readStyle } from '../styles/read-style';
import { setStyle } from '../styles/set-style';
import { writeEdit, type CommandDeps } from './context';

export function createStyleCommands(deps: CommandDeps) {
  async function lookFor(styleId: StyleId | null): AsyncResult<Style | null> {
    if (styleId === null) return ok(null);
    if (!deps.styles) return err(NotImplementedError({ feature: 'timeline.styles' }));
    return readStyle(deps.styles, styleId);
  }

  const set = defineCommand({
    name: TIMELINE_COMMANDS.setStyle,
    payload: payloads[TIMELINE_COMMANDS.setStyle],
    sideEffect: 'write',
    handle: async (payload, context) => {
      const style = await lookFor(payload.styleId);
      if (!style.ok) return style;
      return writeEdit(deps, payload, context, (timeline) => setStyle(timeline, style.value));
    },
  });

  return { set, all: [set] };
}
