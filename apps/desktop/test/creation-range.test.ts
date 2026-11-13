// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { CREATION_COMMANDS as C, FrameRates, RationalTime, unwrap } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { readCreationProgram, readCreationTimeline } from '../src/utility/creation/programs';
import { approvedFilm, creationWorld, UI } from './helpers/creation';

const time = (seconds: number) => RationalTime.of(seconds * 60, FrameRates.fps60);

describe('authored video range commands', () => {
  it('trims and places the video without changing source, and restores the full range across restart undo/redo', async () => {
    const first = creationWorld();
    const film = await approvedFilm(first);
    const target = { projectId: film.projectId, timelineId: film.timeline.id };
    const before = unwrap(await readCreationProgram(first.programs, first.timelines, target));
    const itemId = before.timeline.tracks[0]!.items[0]!.id;
    unwrap(
      await first.bus.dispatch(
        C.setProgramRange,
        {
          ...target,
          revision: before.timeline.revision,
          itemId,
          start: time(2),
          sourceStart: time(10),
          duration: time(30),
        },
        UI,
      ),
    );
    const edited = unwrap(await readCreationProgram(first.programs, first.timelines, target));
    expect(edited.timeline.tracks[0]!.items).toMatchObject([
      { type: 'gap', duration: time(2) },
      { type: 'program', id: itemId, sourceStart: time(10), duration: time(30) },
    ]);
    expect(edited.inspection).toEqual(before.inspection);
    expect(edited.timeline.tracks.slice(1)).toEqual(before.timeline.tracks.slice(1));
    expect(
      (
        await first.bus.dispatch(
          C.setProgramRange,
          {
            ...target,
            revision: before.timeline.revision,
            itemId,
            start: time(0),
            sourceStart: time(0),
            duration: time(20),
          },
          UI,
        )
      ).ok,
    ).toBe(false);
    first.db.close();
    const reopened = creationWorld(first.userData);
    unwrap(await reopened.bus.undo(film.projectId, UI));
    const undone = unwrap(await readCreationTimeline(reopened.timelines, target));
    expect(undone.tracks).toEqual(before.timeline.tracks);
    unwrap(await reopened.bus.redo(film.projectId, UI));
    const redone = unwrap(await readCreationProgram(reopened.programs, reopened.timelines, target));
    expect(redone.timeline.tracks[0]!.items).toMatchObject([
      { type: 'gap', duration: time(2) },
      { type: 'program', id: itemId, sourceStart: time(10), duration: time(30) },
    ]);
    expect(redone.inspection).toEqual(before.inspection);
  });

  it('refuses out-of-source ranges and rolls back an audit failure', async () => {
    const world = creationWorld();
    const film = await approvedFilm(world);
    const target = { projectId: film.projectId, timelineId: film.timeline.id };
    const before = unwrap(await readCreationTimeline(world.timelines, target));
    const input = {
      ...target,
      revision: before.revision,
      itemId: before.tracks[0]!.items[0]!.id,
      start: time(0),
      sourceStart: time(140),
      duration: time(3),
    };
    expect((await world.bus.dispatch(C.setProgramRange, input, UI)).ok).toBe(false);
    expect(unwrap(await readCreationTimeline(world.timelines, target))).toEqual(before);
    world.db.driver.exec(
      "CREATE TRIGGER reject_range BEFORE INSERT ON commands WHEN NEW.name='creation.setProgramRange' BEGIN SELECT RAISE(ABORT, 'audit refused'); END",
    );
    expect((await world.bus.dispatch(C.setProgramRange, { ...input, sourceStart: time(0) }, UI)).ok).toBe(
      false,
    );
    expect(unwrap(await readCreationTimeline(world.timelines, target))).toEqual(before);
  });
});
