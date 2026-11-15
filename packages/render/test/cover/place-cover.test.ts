// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * CVR2: `workspace.placeCover`. A composition on the cover's canvas is gated, drawn (here by a stand-in for the
 * render worker's coverImage, which says what it was asked to draw) and saved as the cover: its files, its
 * pictures by reference, its medium. A cover that cannot be drawn, or whose drawn checks say it is broken, is
 * refused and nothing is saved. Designs of one run are offered together, three at most, each another idea.
 */
import {
  coverSettingsSchema,
  defineCommand,
  err,
  ok,
  setCoverPayloadSchema,
  ValidationError,
  type CompositionGateCheck,
  type CoverImageInput,
  type CoverSettings,
} from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { spokenTimeline } from '../compositions/support';
import { workspaceWorld } from '../workspace/tools/support';
import { compositionText } from './composed-fixture';

const detail = (result: { ok: boolean; error?: { detail?: string } }) =>
  result.ok ? '' : (result.error?.detail ?? '');
const PASS: CompositionGateCheck[] = ['words', 'typeFloor', 'safeArea', 'pictures', 'marks'].map((id) => ({
  id,
  status: 'pass',
}));

/** The tools over a timeline, with a cover drawer that answers `checks` and keeps what it was asked to draw. */
async function world(checks: () => CompositionGateCheck[] | 'cannot' = () => PASS) {
  const timeline = spokenTimeline([]);
  const drawn: CoverImageInput[] = [];
  const w = workspaceWorld(timeline, {
    coverImage: async (input) => {
      drawn.push(input);
      const said = checks();
      if (said === 'cannot')
        return err(ValidationError({ field: 'cover.composition' }, { detail: 'the picture cannot be read' }));
      return ok({
        mimeType: 'image/jpeg' as const,
        dataBase64: '/9j/2Q==',
        width: 1080,
        height: 1920,
        revision: input.revision,
        checks: said,
      });
    },
  });
  // The timeline lane's setCover, reduced to what a cover needs: the cover kept at its aspect.
  w.bus.register(
    defineCommand({
      name: 'timeline.setCover',
      payload: setCoverPayloadSchema,
      sideEffect: 'write',
      handle: async ({ timelineId, cover }, context) => {
        const updated = await w.store.update(
          timelineId,
          (held) => ({
            ...held,
            covers: [...(held.covers ?? []).filter((item) => item.aspect !== cover.aspect), cover],
          }),
          context,
        );
        return updated.ok
          ? ok({ result: { timelineId, revision: updated.value.revision, affectedItemIds: [] } })
          : updated;
      },
    }),
  );
  const target = { projectId: w.projectId, timelineId: timeline.id };
  const write = async (name: string, file: string, edit: (html: string) => string = (html) => html) => {
    const html = edit(await compositionText(file));
    const done = await w.call('workspace.write', {
      projectId: w.projectId,
      path: `${name}/index.html`,
      text: html,
    });
    if (!done.ok) throw new Error(JSON.stringify(done.error));
  };
  const cover = async (aspect = '9:16'): Promise<CoverSettings | undefined> => {
    const held = await w.store.get(timeline.id);
    return held.ok ? held.value.covers?.find((item) => item.aspect === aspect) : undefined;
  };
  const place = async (name: string, more: Record<string, unknown> = {}, run?: string) => {
    const held = await w.store.get(timeline.id);
    return w.call(
      'workspace.placeCover',
      {
        ...target,
        revision: held.ok ? held.value.revision : 1,
        entry: `${name}/index.html`,
        aspect: '9:16',
        medium: 'footage',
        pictures: [{ name: 'hero', frame: 20 }],
        idea: 'The sun is the only colour',
        ...more,
      },
      run,
    );
  };
  return { ...w, timeline, drawn, write, cover, place };
}

describe('workspace.placeCover (CVR2)', () => {
  it('starts a cover on the cover’s own canvas', async () => {
    const w = await world();
    const made = await w.call('workspace.new', { projectId: w.projectId, name: 'wide', cover: '16:9' });
    expect(made.ok).toBe(true);
    const read = await w.call('workspace.read', { projectId: w.projectId, path: 'wide/index.html' });
    expect(read.ok && String(read.value.text)).toContain('data-width="1920" data-height="1080"');
    expect(w.tool('workspace.placeCover').command).toBe('timeline.setCover');
  });

  it('draws the cover it is about to save, then saves it: files, pictures by reference, medium, words', async () => {
    const w = await world();
    await w.write('poster', 'poster-9x16.html');
    const placed = await w.place('poster', { params: { headline: 'North of nowhere' } });
    if (!placed.ok) throw new Error(detail(placed));
    expect(placed.value).toMatchObject({ aspect: '9:16', width: 1080, height: 1920, designs: 1, fix: [] });
    expect(String(placed.value.note)).toContain(`render.exportCover with aspect "9:16" and revision`);

    const saved = (await w.cover())!;
    expect(coverSettingsSchema.safeParse(saved).success).toBe(true);
    expect(saved).toMatchObject({
      aspect: '9:16',
      medium: 'footage',
      // What a reader that knows no compositions sees: the lead picture.
      source: { kind: 'frame', frame: 20 },
      composition: {
        entry: 'poster/index.html',
        params: { headline: 'North of nowhere' },
        pictures: [{ name: 'hero', source: { kind: 'frame', frame: 20 } }],
        idea: 'The sun is the only colour',
        at: 1,
      },
      options: { set: w.runId },
    });
    expect(saved.composition?.variables.map((variable) => variable.name)).toEqual([
      'headline',
      'kicker',
      'accent',
    ]);
    expect(saved.design).toBeUndefined();
    // No frame was written into the workspace: the one file is the composition.
    expect(saved.composition?.files.map((file) => file.path)).toEqual(['poster/index.html']);
    // It was drawn as the draft it then saved, before the save.
    expect(w.drawn).toHaveLength(1);
    expect(w.drawn[0]).toMatchObject({
      aspect: '9:16',
      cover: { composition: { hash: saved.composition?.hash } },
    });
  });

  it('saves nothing when the cover cannot be drawn, or is drawn broken, and says why', async () => {
    let checks: CompositionGateCheck[] | 'cannot' = 'cannot';
    const w = await world(() => checks);
    await w.write('poster', 'poster-9x16.html');
    expect(detail(await w.place('poster'))).toBe('the picture cannot be read');
    checks = [
      ...PASS.slice(1),
      { id: 'words', status: 'fail', detail: '"NOWHERE" runs 40 px past the right edge, so it is cut.' },
    ];
    expect(detail(await w.place('poster'))).toBe(
      'The cover was drawn and not saved: "NOWHERE" runs 40 px past the right edge, so it is cut.',
    );
    expect(await w.cover()).toBeUndefined();

    // What is weak but not broken is saved and reported for the next pass.
    checks = [
      ...PASS.slice(0, 1),
      { id: 'typeFloor', status: 'fail', detail: 'too small' },
      ...PASS.slice(2),
    ];
    const placed = await w.place('poster');
    expect(placed.ok && placed.value.fix).toEqual(['typeFloor: too small']);
    expect(placed.ok && String(placed.value.note)).toContain('Saved, with something to fix');
    expect(await w.cover()).toBeDefined();
  });

  it('refuses what is not a cover composition before it draws anything', async () => {
    const w = await world();
    await w.write('poster', 'poster-9x16.html');
    await w.write('broken', 'poster-9x16.html', (html) =>
      html.replace('<div id="ground"></div>', '<iframe></iframe>'),
    );
    expect(detail(await w.place('broken'))).toContain('did not pass the gate');
    expect(detail(await w.place('poster', { pictures: [{ name: 'hero' }] }))).toContain(
      'Picture "hero" needs exactly one of frame',
    );
    expect(
      detail(await w.place('poster', { pictures: [{ name: 'hero', frame: 2, assetId: w.projectId }] })),
    ).toContain('exactly one of frame');
    expect(w.drawn).toHaveLength(0);
    const blind = workspaceWorld(w.timeline);
    const none = await blind.call('workspace.placeCover', {
      projectId: blind.projectId,
      timelineId: w.timeline.id,
      revision: 1,
      entry: 'poster/index.html',
      aspect: '9:16',
      medium: 'footage',
      idea: 'x',
    });
    expect(detail(none)).toBe('Covers cannot be drawn here, so none was saved.');
  });

  it('offers the designs of one run together: another idea joins, a recolour does not, three at most', async () => {
    const w = await world();
    await w.write('poster', 'poster-9x16.html');
    await w.write('split', 'split-16x9.html');
    await w.write('duo', 'duo-4x5.html');
    await w.write('window', 'window-1x1.html');
    await w.write('recolour', 'poster-9x16.html', (html) => html.replace('#ffb347', '#40c4ff'));
    const duo = {
      pictures: [
        { name: 'dusk', frame: 20 },
        { name: 'dawn', frame: 80 },
      ],
    };

    expect((await w.place('poster')).ok).toBe(true);
    expect(detail(await w.place('recolour'))).toContain('share their');
    const second = await w.place('split');
    expect(second.ok && second.value.designs).toBe(2);
    // The newest is in use; the first is still offered.
    let saved = (await w.cover())!;
    expect(saved.composition?.entry).toBe('split/index.html');
    expect(saved.options?.designs.map((design) => design.entry)).toEqual([
      'poster/index.html',
      'split/index.html',
    ]);

    // The same entry again replaces its design, and is in use.
    await w.write('poster', 'poster-9x16.html', (html) =>
      html.replace('font-size: 206px', 'font-size: 190px'),
    );
    const again = await w.place('poster');
    expect(again.ok && again.value.designs).toBe(2);
    saved = (await w.cover())!;
    expect(saved.composition?.entry).toBe('poster/index.html');
    expect(saved.options?.designs).toHaveLength(2);

    expect((await w.place('duo', duo)).ok).toBe(true);
    expect(detail(await w.place('window'))).toContain('This cover has its 3 designs already');

    // A later run starts its own set.
    const later = await w.place('window', {}, 'a-later-run');
    expect(later.ok && later.value.designs).toBe(1);
    expect((await w.cover())?.options).toMatchObject({ set: 'a-later-run' });
  });
});
