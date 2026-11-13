// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { defineCommand, ok, SIMPLE_EDITOR_COMMANDS as N, simpleEditorPayloads as P } from '@taalcut/core';
import { adjustClips, copyClipSettings } from '../edits/bulk-settings';
import { freezeFrame, setHoldDuration } from '../edits/freeze-frame';
import { removeWords } from '../edits/remove-words';
import { replaceCaptions } from '../edits/replace-captions';
import { readTimelineTranscript } from '../service/transcript';
import { writeMade } from './editor-commands';
import { writeEdit, type CommandDeps } from './context';
import { narrationCommand } from './narration-command';
import { makeSizeCommand } from './size-command';

export function createSimpleEditorCommands(deps: CommandDeps) {
  const captions = defineCommand({
    name: N.replaceCaptions,
    payload: P[N.replaceCaptions],
    sideEffect: 'write',
    handle: async (payload, context) => {
      let replacements = 0;
      const written = await writeEdit(deps, payload, context, (timeline) => {
        const edited = replaceCaptions(timeline, payload);
        if (edited.ok) replacements = edited.value.replacements;
        return edited;
      });
      return written.ok
        ? ok({ ...written.value, result: { ...written.value.result, replacements } })
        : written;
    },
  });
  const adjust = defineCommand({
    name: N.adjustClips,
    payload: P[N.adjustClips],
    sideEffect: 'write',
    handle: (payload, context) =>
      writeEdit(deps, payload, context, (timeline) => adjustClips(timeline, payload.clipIds, payload)),
  });
  const copy = defineCommand({
    name: N.copyClipSettings,
    payload: P[N.copyClipSettings],
    sideEffect: 'write',
    handle: (payload, context) =>
      writeEdit(deps, payload, context, (timeline) =>
        copyClipSettings(timeline, payload.sourceClipId, payload.clipIds, payload.settings),
      ),
  });
  const freeze = defineCommand({
    name: N.freezeFrame,
    payload: P[N.freezeFrame],
    sideEffect: 'write',
    handle: (payload, context) =>
      writeMade(deps, payload, context, (timeline, options) => freezeFrame(timeline, payload, options)),
  });
  const hold = defineCommand({
    name: N.setHoldDuration,
    payload: P[N.setHoldDuration],
    sideEffect: 'write',
    handle: (payload, context) =>
      writeMade(deps, payload, context, (timeline, options) => setHoldDuration(timeline, payload, options)),
  });
  const words = defineCommand({
    name: N.removeWords,
    payload: P[N.removeWords],
    sideEffect: 'write',
    handle: (payload, context) =>
      writeMade(deps, payload, context, async (timeline, options) => {
        const transcript = await readTimelineTranscript(timeline, deps.transcripts);
        return transcript.ok
          ? removeWords(timeline, payload.words, transcript.value.words, options.ids)
          : transcript;
      }),
  });
  return {
    all: [captions, adjust, copy, freeze, hold, words, makeSizeCommand(deps), narrationCommand(deps)],
  };
}
