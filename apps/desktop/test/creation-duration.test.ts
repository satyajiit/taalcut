// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { CREATION_COMMANDS as C, FrameRates, RationalTime, unwrap } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { readCreationProgram } from '../src/utility/creation/programs';
import { approvedFilm, creationWorld, SOURCE, UI } from './helpers/creation';

const time = (seconds: number) => RationalTime.of(seconds * 60, FrameRates.fps60);

describe('authored source duration edits', () => {
  it('atomically changes source and full program length, then restores both after restart', async () => {
    const first = creationWorld();
    const film = await approvedFilm(first);
    const target = { projectId: film.projectId, timelineId: film.timeline.id };
    const before = unwrap(await readCreationProgram(first.programs, first.timelines, target));
    unwrap(
      await first.bus.dispatch(
        C.replaceSource,
        {
          ...target,
          revision: before.timeline.revision,
          source: SOURCE.replaceAll('142', '150'),
        },
        UI,
      ),
    );
    const after = unwrap(await readCreationProgram(first.programs, first.timelines, target));
    expect(after.inspection.program.duration).toEqual(time(150));
    expect(after.timeline.tracks[0]!.items[0]).toMatchObject({ duration: time(150) });
    expect(after.inspection.source).toContain('data-duration="150"');
    expect(after.inspection.program.hash).not.toBe(before.inspection.program.hash);
    first.db.close();
    const reopened = creationWorld(first.userData);
    unwrap(await reopened.bus.undo(film.projectId, UI));
    const undone = unwrap(await readCreationProgram(reopened.programs, reopened.timelines, target));
    expect(undone.inspection).toEqual(before.inspection);
    expect(undone.timeline.tracks).toEqual(before.timeline.tracks);
    unwrap(await reopened.bus.redo(film.projectId, UI));
    const redone = unwrap(await readCreationProgram(reopened.programs, reopened.timelines, target));
    expect(redone.inspection).toEqual(after.inspection);
    expect(redone.timeline.tracks).toEqual(after.timeline.tracks);
  });

  it('preserves manual trims and refuses source edits which remove their selected range', async () => {
    const world = creationWorld();
    const film = await approvedFilm(world);
    const target = { projectId: film.projectId, timelineId: film.timeline.id };
    unwrap(
      await world.bus.dispatch(
        C.setProgramRange,
        {
          ...target,
          revision: 1,
          itemId: film.timeline.tracks[0]!.items[0]!.id,
          start: time(2),
          sourceStart: time(10),
          duration: time(30),
        },
        UI,
      ),
    );
    const before = unwrap(await readCreationProgram(world.programs, world.timelines, target));
    unwrap(
      await world.bus.dispatch(
        C.replaceSource,
        {
          ...target,
          revision: before.timeline.revision,
          source: SOURCE.replaceAll('142', '100'),
        },
        UI,
      ),
    );
    const after = unwrap(await readCreationProgram(world.programs, world.timelines, target));
    expect(after.inspection.program.duration).toEqual(time(100));
    expect(after.timeline.tracks[0]!.items[1]).toMatchObject({ sourceStart: time(10), duration: time(30) });
    expect(
      (
        await world.bus.dispatch(
          C.replaceSource,
          {
            ...target,
            revision: after.timeline.revision,
            source: SOURCE.replaceAll('142', '20'),
          },
          UI,
        )
      ).ok,
    ).toBe(false);
    expect(unwrap(await readCreationProgram(world.programs, world.timelines, target))).toEqual(after);
  });
});
