// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  coverLeadSource,
  defineCommand,
  err,
  ok,
  setCoverPayloadSchema,
  ValidationError,
} from '@taalcut/core';
import { sequenceLength, videoItems } from '../model/sequence';
import { writeEdit, type CommandDeps } from './context';

export function coverCommand(deps: CommandDeps) {
  return defineCommand({
    name: 'timeline.setCover',
    payload: setCoverPayloadSchema,
    sideEffect: 'write',
    handle: (payload, context) =>
      writeEdit(deps, payload, context, (timeline) => {
        const length = sequenceLength(videoItems(timeline));
        // CVR2: a composition draws the whole cover, so its `source` is its lead picture and nothing else.
        const cover = payload.cover.composition
          ? { ...payload.cover, source: coverLeadSource(payload.cover.composition.pictures) }
          : payload.cover;
        if (cover.source.kind === 'frame' && cover.source.frame >= length)
          return err(ValidationError({ field: 'frame' }));
        const designs = [
          ...(cover.composition ? [cover.composition] : []),
          ...(cover.options?.designs ?? []),
        ];
        for (const design of designs) {
          const late = design.pictures.find(
            (picture) => picture.source.kind === 'frame' && picture.source.frame >= length,
          );
          if (late)
            return err(
              ValidationError(
                { field: 'pictures' },
                {
                  detail: `Picture "${late.name}" names a frame past the end of the video (${length} frames)`,
                },
              ),
            );
        }
        const covers = [...(timeline.covers ?? []).filter((item) => item.aspect !== cover.aspect), cover];
        return ok({ timeline: { ...timeline, covers }, changed: ['covers'] });
      }),
  });
}
