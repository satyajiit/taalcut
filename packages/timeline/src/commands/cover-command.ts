// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { defineCommand, err, ok, setCoverPayloadSchema, ValidationError } from '@taalcut/core';
import { sequenceLength, videoItems } from '../model/sequence';
import { writeEdit, type CommandDeps } from './context';

export function coverCommand(deps: CommandDeps) {
  return defineCommand({
    name: 'timeline.setCover',
    payload: setCoverPayloadSchema,
    sideEffect: 'write',
    handle: (payload, context) =>
      writeEdit(deps, payload, context, (timeline) => {
        const cover = payload.cover;
        if (cover.source.kind === 'frame' && cover.source.frame >= sequenceLength(videoItems(timeline)))
          return err(ValidationError({ field: 'frame' }));
        const covers = [...(timeline.covers ?? []).filter((item) => item.aspect !== cover.aspect), cover];
        return ok({ timeline: { ...timeline, covers }, changed: ['covers'] });
      }),
  });
}
