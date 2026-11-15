// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * DSG2: the preview's graphic with three designs. With `designs: { arranged, options }`, Golden hour's first video
 * has a title drawn with the first of its three designs (no proposal), the copies of all three, and the set on the
 * graphic; graphics.chooseOption draws it with another and ⌘Z brings the first back; a design that isn't one of
 * its options is refused; without `options` the video is as HFW1-UI left it. The still reader hands a picture back
 * as a data: URL and nothing for a text file. Made-up designs only.
 */
import { callRpc, GRAPHICS_COMMANDS, type GraphicItem, type Timeline } from '@taalcut/core';
import {
  DESIGN_COMPOSITIONS,
  DESIGN_FILE_SHAS,
  DESIGN_OPTION_COMPOSITIONS,
  DESIGN_OPTION_IDS,
} from '@taalcut/ui';
import { describe, expect, it } from 'vitest';
import { createFakeBackend } from '../src/backend/fake/fake-backend';
import { GOLDEN_PROJECT, GOLDEN_TIMELINES } from '../src/backend/fake/make/ids';
import { designStillReader } from '../src/chat/design-stills';

const projectId = GOLDEN_PROJECT;
const timelineId = GOLDEN_TIMELINES[0]!;
const where = { projectId, timelineId, itemId: DESIGN_OPTION_IDS.graphic };

function setup(options = true) {
  const { client } = createFakeBackend({
    phase2: { library: { tickMs: 0 } },
    phase3: { designs: { arranged: true, options } },
  });
  const dispatch = (name: string, payload: unknown) =>
    callRpc(client.commands.dispatch({ name, payload, source: 'ui' }));
  const undo = () => callRpc(client.commands.undo({ projectId, source: 'ui' }));
  const title = async () => {
    const timeline: Timeline = await client.timelines.get({ timelineId });
    const item = timeline.tracks
      .flatMap((track) => (track.kind === 'text' ? track.items : []))
      .find(
        (entry): entry is GraphicItem => entry.type === 'graphic' && entry.id === DESIGN_OPTION_IDS.graphic,
      );
    return { timeline, item };
  };
  return { client, dispatch, undo, title };
}

describe('the preview’s graphic with three designs (DSG2)', () => {
  it('is in the video drawn with the first design, the other two beside it', async () => {
    const { title } = setup();
    const { timeline, item } = await title();
    expect(item?.proposal).toBeUndefined();
    expect(item?.composition.id).toBe(DESIGN_OPTION_COMPOSITIONS[0].id);
    expect(item?.options?.designs.map((design) => design.compositionId)).toEqual(
      DESIGN_OPTION_IDS.compositions,
    );
    for (const design of DESIGN_OPTION_COMPOSITIONS)
      expect(timeline.graphicCompositions?.some((copy) => copy.id === design.id)).toBe(true);
    // Without the option the video is as it was.
    expect((await setup(false).title()).item).toBeUndefined();
  });

  it('choosing another draws it with that design, keeping its words; ⌘Z brings the first back', async () => {
    const { dispatch, undo, title } = setup();
    const third = DESIGN_OPTION_COMPOSITIONS[2];
    const chosen = await dispatch(GRAPHICS_COMMANDS.chooseOption, { ...where, compositionId: third.id });
    expect(chosen.ok, JSON.stringify(chosen)).toBe(true);
    const after = (await title()).item;
    expect(after?.composition).toMatchObject({
      id: third.id,
      hash: third.hash,
      params: { title: 'Golden hour market' },
    });
    expect(after?.options?.designs).toHaveLength(3);
    expect((await undo()).ok).toBe(true);
    expect((await title()).item?.composition.id).toBe(DESIGN_OPTION_COMPOSITIONS[0].id);
    const stranger = await dispatch(GRAPHICS_COMMANDS.chooseOption, {
      ...where,
      compositionId: DESIGN_COMPOSITIONS.bubble.id,
    });
    expect(!stranger.ok && stranger.error.code).toBe('render.graphic_invalid');
  });

  it('reads a still as a data: URL once, and nothing for a file that is not a picture', async () => {
    let reads = 0;
    const backend = {
      workspace: {
        read: (input: { sha256: string }) => {
          reads += 1;
          return Promise.resolve(
            input.sha256 === DESIGN_OPTION_IDS.stills[0]
              ? {
                  sha256: input.sha256,
                  bytes: 4,
                  text: null,
                  image: { mimeType: 'image/jpeg', dataBase64: '/9j/2Q==' },
                }
              : { sha256: input.sha256, bytes: 9, text: 'body {}' },
          );
        },
      },
    };
    const still = designStillReader(backend as never);
    expect(await still(projectId, DESIGN_OPTION_IDS.stills[0])).toBe('data:image/jpeg;base64,/9j/2Q==');
    expect(await still(projectId, DESIGN_OPTION_IDS.stills[0])).toBe('data:image/jpeg;base64,/9j/2Q==');
    expect(reads).toBe(1);
    expect(await still(projectId, DESIGN_FILE_SHAS.bubbleCss)).toBeNull();
  });
});
