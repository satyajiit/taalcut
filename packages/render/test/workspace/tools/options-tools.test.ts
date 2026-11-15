// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * DSG2: a job's three designs as one set. `workspace.placeOptions` places three compositions, the first in the
 * video at once (no proposal, so the export's plan draws it) and the others beside it; `graphics.chooseOption` swaps
 * another in and undo puts the first back; asking again replaces the set on the same graphic; the plan draws the
 * chosen one. The tool refuses a set that is one design recoloured, designs that carry other words, fewer than
 * three without a reason, and an option that was never drawn; each option's still is kept with the workspace.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  GRAPHICS_COMMANDS,
  motionGraphicCardSchema,
  newId,
  ok,
  optionInUse,
  type GraphicItem,
  type Timeline,
  type WorkspaceFramesInput,
} from '@taalcut/core';
import { planCompositions } from '../../../src/workspace/fold/plan-compositions';
import { facetsOf, sameDesignProblem, sharedFacets } from '../../../src/workspace/tools/options-differ';
import type { WorkspaceToolDeps } from '../../../src/workspace/tools/deps';
import { rate, spokenTimeline } from '../../compositions/support';
import { workspaceWorld } from './support';

const fixture = (name: string) => readFile(join(import.meta.dirname, 'fixtures', name), 'utf8');
const ui = { source: 'ui', actor: 'user' } as const;
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64');
const frames = async (input: WorkspaceFramesInput) =>
  ok({
    frames: input.seconds.map((seconds) => ({
      seconds,
      mimeType: 'image/jpeg' as const,
      dataBase64: JPEG,
      width: 432,
      height: 768,
      box: { x: 0.1, y: 0.4, width: 0.8, height: 0.1 },
    })),
    checks: [{ id: 'bounds', status: 'pass' as const }],
    ms: 5,
  });

const value = <T>(result: { ok: boolean; value?: unknown; error?: unknown }): T => {
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value as T;
};
const detail = (result: { ok: boolean; error?: { detail?: string } }) =>
  result.ok ? '' : (result.error?.detail ?? '');
const graphicsOf = (timeline: Timeline) =>
  timeline.tracks.flatMap((track) =>
    track.kind === 'text' ? track.items.filter((item) => item.type === 'graphic') : [],
  ) as GraphicItem[];

const NAMES = ['title-a', 'title-b', 'title-c'] as const;
const IDEAS = [
  'A poster: condensed capitals off the left edge, led by a short rule',
  'A whisper: light type in the middle that settles into place',
  'A tag: a rounded label that drops in from the top corner',
];
const optionsFor = (names: readonly string[] = NAMES) =>
  names.map((name, at) => ({ entry: `${name}/index.html`, name: `Title ${at + 1}`, idea: IDEAS[at]! }));

interface Placed {
  itemIds: string[];
  revision: number;
  compositionId: string;
  options: { compositionId: string; name: string; idea: string; posterArtifactId?: string }[];
}

/** A timeline, and the three fixture designs written into its workspace. */
async function threeDesigns(extra: Partial<WorkspaceToolDeps> = {}) {
  const timeline = spokenTimeline([[10, 60, 'see you at the lake']]);
  const world = workspaceWorld(timeline, extra);
  for (const name of NAMES)
    value(
      await world.call('workspace.write', {
        projectId: world.projectId,
        path: `${name}/index.html`,
        text: await fixture(`${name}.html`),
      }),
    );
  const latest = async () => value<Timeline>(await world.store.get(timeline.id));
  /** `run`: a later run's id (a "try again" is another run; the same run's calls are the same job's). */
  const place = async (input: Record<string, unknown> = {}, run?: string) =>
    world.call(
      'workspace.placeOptions',
      {
        projectId: world.projectId,
        timelineId: timeline.id,
        options: optionsFor(),
        request: 'a title that says Leave',
        at: 0.5,
        params: { title: 'Leave' },
        ...input,
      },
      run,
    );
  return { timeline, world, latest, place };
}

describe('three designs for a job (DSG2)', () => {
  it('places three, the first in the video with no proposal, and its card names the options', async () => {
    const { world, latest, place } = await threeDesigns();
    expect(world.tool('workspace.placeOptions').command).toBe(GRAPHICS_COMMANDS.placeOptions);
    const placed = value<Placed>(await place());
    const after = await latest();
    const [graphic] = graphicsOf(after);
    expect(graphicsOf(after)).toHaveLength(1);
    expect(graphic?.proposal).toBeUndefined();
    expect(graphic?.options?.designs).toHaveLength(3);
    expect(graphic?.options?.designs.map((design) => design.idea)).toEqual(IDEAS);
    expect(graphic?.composition.id).toBe(placed.options[0]?.compositionId);
    expect(optionInUse(graphic!)?.idea).toBe(IDEAS[0]);
    expect(graphic?.composition.params).toEqual({ title: 'Leave' });
    // Every design's copy is kept, so choosing needs no new write.
    expect(new Set((after.graphicCompositions ?? []).map((copy) => copy.id)).size).toBe(3);
    const card = value<unknown>(
      await world.tool('workspace.placeOptions').resultCard!(
        placed as never,
        { runId: world.runId } as never,
      ),
    );
    const parsed = motionGraphicCardSchema.parse(card);
    expect(parsed.composition.id).toBe(placed.compositionId);
    expect(parsed.options?.map((option) => option.name)).toEqual(['Title 1', 'Title 2', 'Title 3']);
    expect(parsed.options?.map((option) => option.idea)).toEqual(IDEAS);
  });

  it('the export’s plan draws the first design, and the chosen one after a choice; undo puts the first back', async () => {
    const { world, timeline, latest, place } = await threeDesigns();
    const placed = value<Placed>(await place());
    const drawn = async () =>
      planCompositions(await latest(), rate).planned.map((entry) => entry.composition.id);
    expect(await drawn()).toEqual([placed.options[0]!.compositionId]);
    const target = { projectId: timeline.projectId, timelineId: timeline.id, itemId: placed.itemIds[0] };
    const chosen = await world.bus.dispatch(
      GRAPHICS_COMMANDS.chooseOption,
      { ...target, compositionId: placed.options[2]!.compositionId },
      ui,
    );
    expect(chosen.ok, JSON.stringify(chosen)).toBe(true);
    const after = graphicsOf(await latest())[0]!;
    expect(after.composition.id).toBe(placed.options[2]!.compositionId);
    // The words are carried; the first design's colour has no place in the third.
    expect(after.composition.params).toEqual({ title: 'Leave' });
    expect(after.options?.designs).toHaveLength(3);
    expect(after.origin).toBe('agent');
    expect(await drawn()).toEqual([placed.options[2]!.compositionId]);
    value(await world.bus.undo(timeline.projectId, ui));
    expect(graphicsOf(await latest())[0]?.composition.id).toBe(placed.options[0]!.compositionId);
    expect(await drawn()).toEqual([placed.options[0]!.compositionId]);
    const stranger = await world.bus.dispatch(
      GRAPHICS_COMMANDS.chooseOption,
      // A design the set never offered (a fresh id: one made from the item's own could be a neighbour's).
      { ...target, compositionId: newId<'GraphicComposition'>() },
      ui,
    );
    expect(stranger.ok).toBe(false);
  });

  it('asking again replaces the set on the same graphic, keeping its words and time', async () => {
    const { world, latest, place } = await threeDesigns();
    const placed = value<Placed>(await place());
    const before = graphicsOf(await latest())[0]!;
    // Three new designs: the same fixtures in new folders, as the Designer would write new ones.
    const again = ['second-a', 'second-b', 'second-c'];
    for (const [at, name] of again.entries())
      value(
        await world.call('workspace.write', {
          projectId: world.projectId,
          path: `${name}/index.html`,
          text: (await fixture(`${NAMES[at]}.html`)).replaceAll(NAMES[at]!, name),
        }),
      );
    const retried = value<Placed>(
      await place(
        { options: optionsFor(again), itemIds: placed.itemIds, at: undefined, params: undefined },
        'a-later-run',
      ),
    );
    const after = graphicsOf(await latest());
    expect(after).toHaveLength(1);
    expect(retried.itemIds).toEqual(placed.itemIds);
    expect(after[0]?.id).toBe(before.id);
    expect(after[0]?.start).toEqual(before.start);
    expect(after[0]?.composition.params).toEqual({ title: 'Leave' });
    expect(after[0]?.options?.set).not.toBe(before.options?.set);
    expect(after[0]?.composition.id).toBe(retried.options[0]?.compositionId);
    const offered = new Set(after[0]?.options?.designs.map((design) => design.compositionId));
    for (const option of placed.options) expect(offered.has(option.compositionId as never)).toBe(false);
    // Undo brings the first set back whole.
    value(await world.bus.undo(world.projectId, ui));
    expect(graphicsOf(await latest())[0]?.options?.set).toBe(before.options?.set);
  });

  it('refuses one design recoloured, other words and one idea stated twice; fewer are a smaller choice', async () => {
    const { world, latest, place } = await threeDesigns();
    const recoloured = (await fixture('title-a.html'))
      .replaceAll('title-a', 'title-d')
      .replace('#fdf8ee', '#ffe9a8')
      .replace('#f4b63f', '#3f7af4');
    value(
      await world.call('workspace.write', {
        projectId: world.projectId,
        path: 'title-d/index.html',
        text: recoloured,
      }),
    );
    const alike = await place({ options: optionsFor(['title-a', 'title-d', 'title-c']) });
    expect(detail(alike)).toContain('Options 1 and 2');
    expect(detail(alike)).toContain('only their colours differ');
    const reworded = (await fixture('title-b.html'))
      .replaceAll('title-b', 'title-e')
      .replace('"id":"title"', '"id":"headline"')
      .replace('data-var-text="title"', 'data-var-text="headline"');
    value(
      await world.call('workspace.write', {
        projectId: world.projectId,
        path: 'title-e/index.html',
        text: reworded,
      }),
    );
    const words = await place({ options: optionsFor(['title-a', 'title-e', 'title-c']) });
    expect(detail(words)).toContain('same text variables');
    const same = await place({ options: optionsFor().map((option) => ({ ...option, idea: IDEAS[0]! })) });
    expect(detail(same)).toContain('same idea');
    expect(graphicsOf(await latest())).toHaveLength(0);
    // Two are a choice of two; another job's one design is in the video with a set of one, nothing to choose yet.
    const fewer = value<Placed>(await place({ options: optionsFor().slice(0, 2) }));
    expect(fewer.options).toHaveLength(2);
    expect(graphicsOf(await latest())[0]?.options?.designs).toHaveLength(2);
    const alone = value<Placed>(
      await place({ options: optionsFor().slice(2), request: 'a tag in the corner', at: 3 }),
    );
    const lone = graphicsOf(await latest()).find((graphic) => graphic.id === alone.itemIds[0]);
    expect(lone?.options?.designs).toHaveLength(1);
    expect(lone?.composition.id).toBe(alone.compositionId);
    expect(lone?.proposal).toBeUndefined();
  });

  it('keeps each still with the workspace (the tool’s own draw is in options-grow.test.ts)', async () => {
    const { world, timeline, latest, place } = await threeDesigns({ frames });
    for (const name of NAMES)
      value(
        await world.call('workspace.renderOver', {
          projectId: world.projectId,
          entry: `${name}/index.html`,
          seconds: [1.5],
          over: 'footage',
          timelineId: timeline.id,
          at: 0.5,
        }),
      );
    const placed = value<Placed>(await place());
    expect(placed.options.every((option) => typeof option.posterArtifactId === 'string')).toBe(true);
    const designs = graphicsOf(await latest())[0]!.options!.designs;
    for (const design of designs) {
      expect(design.still).toMatchObject({ mimeType: 'image/jpeg', bytes: 4 });
      const blob = await world.workspace.store.readBlob(world.projectId, design.still!.sha256);
      expect(blob.ok).toBe(true);
    }
  });

  it('draws a tile-sized still itself when the Designer’s render is too large to keep, outside the run’s renders', async () => {
    // A still at the size the model looks at is larger than a workspace file; smaller ones fit from 256 px.
    const asked: WorkspaceFramesInput[] = [];
    const sized = async (input: WorkspaceFramesInput) => {
      asked.push(input);
      const bytes = (input.maxDimension ?? 768) > 256 ? 70_000 : 20_000;
      const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(bytes - 4, 7)]);
      return ok({
        frames: input.seconds.map((seconds) => ({
          seconds,
          mimeType: 'image/jpeg' as const,
          dataBase64: jpeg.toString('base64'),
          width: 432,
          height: 768,
          box: { x: 0.1, y: 0.4, width: 0.8, height: 0.1 },
        })),
        checks: [{ id: 'bounds', status: 'pass' as const }],
        ms: 5,
      });
    };
    const { world, timeline, latest, place } = await threeDesigns({ frames: sized });
    const look = (name: string) =>
      world.call('workspace.renderOver', {
        projectId: world.projectId,
        entry: `${name}/index.html`,
        seconds: [0.4, 1.5, 2.8],
        over: 'footage',
        timelineId: timeline.id,
        at: 0.5,
      });
    for (const name of NAMES) value(await look(name));
    asked.length = 0;
    const placed = value<Placed>(await place());
    // Each option: 384 px (too large here), then 256 px, one second each, over the video where the title starts.
    expect(asked.map((input) => input.maxDimension)).toEqual([384, 256, 384, 256, 384, 256]);
    for (const input of asked) {
      expect(input.seconds).toEqual([1.5]);
      expect(input.over).toMatchObject({ kind: 'footage', timelineId: timeline.id, start: 0.5 });
      expect(input.params).toEqual({ title: 'Leave' });
    }
    const designs = graphicsOf(await latest())[0]!.options!.designs;
    expect(designs.map((design) => design.still?.bytes)).toEqual([20_000, 20_000, 20_000]);
    // The person's stills are not the run's renders: three looks so far, and the fourth leaves 21 of 25.
    const fourth = value<{ rendersLeft: number }>(await look('title-a'));
    expect(fourth.rendersLeft).toBe(21);
    // A redesign's stills leave out what it replaces and carry its own words.
    asked.length = 0;
    value(
      await world.call('workspace.write', {
        projectId: world.projectId,
        path: 'title-a/index.html',
        text: (await fixture('title-a.html')).replace('width: 96px', 'width: 120px'),
      }),
    );
    value(await look('title-a'));
    asked.length = 0;
    value(
      await place(
        { options: optionsFor().slice(0, 1), itemIds: placed.itemIds, at: undefined, params: undefined },
        'a-later-run',
      ),
    );
    expect(asked[0]?.over).toMatchObject({ kind: 'footage', leaveOut: placed.itemIds });
    expect(asked[0]?.params).toMatchObject({ title: 'Leave' });
  });

  it('graphics of one job share one set: the second placed with the same designs joins it', async () => {
    const { timeline, world, latest, place } = await threeDesigns();
    const first = value<Placed>(await place());
    const second = value<Placed>(await place({ at: 3, params: { title: 'Return' } }));
    const graphics = graphicsOf(await latest());
    expect(graphics).toHaveLength(2);
    expect(second.options.map((option) => option.compositionId)).toEqual(
      first.options.map((option) => option.compositionId),
    );
    expect(graphics[0]?.options?.set).toBe(graphics[1]?.options?.set);
    // One choice is one look for the whole set, each graphic keeping its own words.
    value(
      await world.bus.dispatch(
        GRAPHICS_COMMANDS.chooseOption,
        {
          projectId: timeline.projectId,
          timelineId: timeline.id,
          itemId: first.itemIds[0],
          compositionId: first.options[1]!.compositionId,
        },
        ui,
      ),
    );
    const after = graphicsOf(await latest());
    expect(after.map((graphic) => graphic.composition.id)).toEqual([
      first.options[1]!.compositionId,
      first.options[1]!.compositionId,
    ]);
    expect(after.map((graphic) => graphic.composition.params.title).sort()).toEqual(['Leave', 'Return']);
  });
});

describe('whether two designs differ in a real way', () => {
  it('reads type, layout and motion with the colours out', async () => {
    const [a, b, c] = await Promise.all(NAMES.map((name) => fixture(`${name}.html`)));
    expect(sharedFacets(facetsOf(a!), facetsOf(b!))).toEqual([]);
    expect(sharedFacets(facetsOf(a!), facetsOf(c!))).toEqual([]);
    const recoloured = a!
      .replace('#fdf8ee', '#101010')
      .replace('rgba(20, 14, 6, 0.6)', 'rgba(250, 240, 220, 0.6)');
    expect(sharedFacets(facetsOf(a!), facetsOf(recoloured))).toEqual(['type', 'layout', 'motion']);
    // Another face alone is one facet: still the same design.
    const refaced = a!.replace("'Anton'", "'Bebas Neue'");
    expect(sharedFacets(facetsOf(a!), facetsOf(refaced))).toEqual(['layout', 'motion']);
    expect(
      sameDesignProblem([
        { entry: 'a', html: a! },
        { entry: 'b', html: refaced },
      ]),
    ).toContain('only their type differs');
    // Another face and another arrival are two: a set.
    const moved = refaced.replace('x: -80, opacity: 0', 'y: 60, opacity: 0');
    expect(
      sameDesignProblem([
        { entry: 'a', html: a! },
        { entry: 'b', html: moved },
      ]),
    ).toBeNull();
    expect(
      sameDesignProblem([
        { entry: 'a', html: a! },
        { entry: 'b', html: b! },
        { entry: 'c', html: c! },
      ]),
    ).toBeNull();
  });
});
