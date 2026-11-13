// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  DEFAULT_MIX,
  err,
  newId,
  RationalTime,
  TIMELINE_SCHEMA_VERSION,
  ValidationError,
  type AuthoredProgram,
  type ProjectId,
  type Timeline,
  type TimelineId,
  type Result,
} from '@taalcut/core';
import { checkEdited } from '../model/validate';
import { marker } from '../model/markers';

export interface CreateAuthoredTimelineInput {
  readonly projectId: ProjectId;
  readonly program: AuthoredProgram;
  readonly name: string;
  readonly timelineId?: TimelineId;
  readonly now?: number;
}

/** One native item keeps the whole film's camera, cursor and logo choreography on one continuous clock. */
export function createAuthoredTimeline(input: CreateAuthoredTimelineInput): Result<Timeline> {
  const { program } = input;
  const now = input.now ?? Date.now();
  return checkEdited({
    schemaVersion: TIMELINE_SCHEMA_VERSION,
    id: input.timelineId ?? newId<'Timeline'>(),
    projectId: input.projectId,
    name: input.name,
    revision: 1,
    canvas: program.canvas,
    template: null,
    beatMap: null,
    cast: null,
    captions: null,
    music: { path: 'none' },
    styleId: null,
    voiceover: null,
    mix: DEFAULT_MIX,
    authoredPrograms: [program],
    tracks: [
      {
        kind: 'video',
        id: 'V1',
        name: 'V1',
        enabled: true,
        items: [
          {
            type: 'program',
            id: newId<'TimelineItem'>(),
            program: { id: program.id, hash: program.hash },
            sourceStart: RationalTime.of(0, program.canvas.rate),
            duration: RationalTime.rescale(program.duration, program.canvas.rate, 'round'),
            locked: false,
            enabled: true,
            slotId: null,
          },
        ],
      },
    ],
    markers: program.chapters.map((chapter) =>
      marker(
        newId<'TimelineItem'>(),
        'note',
        chapter.name.slice(0, 120),
        RationalTime.toFrames(chapter.start, program.canvas.rate),
        RationalTime.toFrames(chapter.duration, program.canvas.rate),
        program.canvas.rate,
      ),
    ),
    createdAt: now,
    updatedAt: now,
  });
}

/** The command transaction stores this timeline and the immutable source version together. */
export function replaceAuthoredProgram(timeline: Timeline, program: AuthoredProgram): Result<Timeline> {
  const previous = timeline.authoredPrograms?.find((candidate) => candidate.id === program.id);
  if (!previous)
    return err(
      ValidationError(
        { field: 'authoredProgram' },
        { detail: 'This program does not belong to the timeline.' },
      ),
    );
  const tracks = timeline.tracks.map((track) =>
    track.kind !== 'video'
      ? track
      : {
          ...track,
          items: track.items.map((item) =>
            item.type !== 'program' || item.program.id !== program.id
              ? item
              : {
                  ...item,
                  program: { id: program.id, hash: program.hash },
                  ...(item.sourceStart.value === 0 &&
                  RationalTime.compare(item.duration, previous.duration) === 0
                    ? { duration: RationalTime.rescale(program.duration, timeline.canvas.rate, 'round') }
                    : {}),
                },
          ),
        },
  );
  return checkEdited({
    ...timeline,
    tracks,
    authoredPrograms: [
      ...(timeline.authoredPrograms ?? []).filter((candidate) => candidate.id !== program.id),
      program,
    ],
  });
}
