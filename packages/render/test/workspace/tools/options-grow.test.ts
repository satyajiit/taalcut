// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * DSG2: a job's designs are placed one at a time. The first is in the video at once and starts the graphic's set;
 * each later one of the same job (the same request, in the same run) joins it as another option and the one in use
 * stays. A step that ends early is settled from what it placed: one design in use is a success with fewer options.
 * Made-up designs only.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  err,
  ok,
  timelineSchema,
  ValidationError,
  type GraphicItem,
  type TextItem,
  type Timeline,
  type WorkspaceFramesInput,
} from '@taalcut/core';
import type { WorkspaceToolDeps } from '../../../src/workspace/tools/deps';
import { checkDesigns, designerInputSchema } from '../../../src/skills/designer-checks';
import { SETTLED_FEWER, SETTLED_NONE, settledDesigns } from '../../../src/skills/designer-settle';
import { makeTimeline } from '../../support/timeline';
import { spokenTimeline } from '../../compositions/support';
import { workspaceWorld } from './support';

const fixture = (name: string) => readFile(join(import.meta.dirname, 'fixtures', name), 'utf8');
const ui = { source: 'ui', actor: 'user' } as const;
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
const REQUEST = 'a title that says Leave';

interface Placed {
  itemIds: string[];
  compositionId: string;
  options: { compositionId: string; name: string }[];
  note: string;
}

/** The three fixture designs in a workspace, and a call that places one of them. */
async function world(timeline: Timeline, extra: Partial<WorkspaceToolDeps> = {}) {
  const made = workspaceWorld(timeline, extra);
  for (const name of NAMES)
    value(
      await made.call('workspace.write', {
        projectId: made.projectId,
        path: `${name}/index.html`,
        text: await fixture(`${name}.html`),
      }),
    );
  const latest = async () => value<Timeline>(await made.store.get(timeline.id));
  const calls: { tool: string; input: unknown; output: unknown }[] = [];
  const place = async (name: string, input: Record<string, unknown> = {}, run?: string) => {
    const sent = {
      projectId: made.projectId,
      timelineId: timeline.id,
      options: [{ entry: `${name}/index.html`, name: `Title ${name.slice(-1)}`, idea: `Idea ${name}` }],
      request: REQUEST,
      ...input,
    };
    const done = await made.call('workspace.placeOptions', sent, run);
    if (done.ok) calls.push({ tool: 'workspace.placeOptions', input: sent, output: done.value });
    return done;
  };
  return { made, latest, place, calls };
}

describe('a job’s designs, placed one at a time (DSG2)', () => {
  it('the first is in the video at once; each later one of the job joins its set and the first stays in use', async () => {
    const timeline = spokenTimeline([[10, 60, 'see you at the lake']]);
    const { made, latest, place } = await world(timeline);
    const first = value<Placed>(await place('title-a', { at: 0.5, params: { title: 'Leave' } }));
    const [alone] = graphicsOf(await latest());
    expect(alone?.proposal).toBeUndefined();
    expect(alone?.composition.id).toBe(first.compositionId);
    expect(alone?.options?.designs).toHaveLength(1);
    expect(first.note).toContain('1 of 3');
    // One design is nothing to choose between yet: the card names no options.
    const card = (run: Placed) =>
      made.tool('workspace.placeOptions').resultCard!(run as never, { runId: made.runId } as never);
    expect(value<{ options?: unknown[] }>(await card(first)).options).toBeUndefined();

    // The second names the graphic the first made; the third only repeats the job: both join.
    const second = value<Placed>(await place('title-b', { itemIds: first.itemIds }));
    expect(second.itemIds).toEqual(first.itemIds);
    expect(second.compositionId).toBe(first.compositionId);
    expect(value<{ options?: unknown[] }>(await card(second)).options).toHaveLength(2);
    const third = value<Placed>(await place('title-c', { at: 0.5, params: { title: 'Leave' } }));
    expect(third.note).toContain('hand off');
    const after = await latest();
    expect(graphicsOf(after)).toHaveLength(1);
    const [graphic] = graphicsOf(after);
    expect(graphic?.id).toBe(alone?.id);
    expect(graphic?.composition).toEqual(alone?.composition);
    expect(graphic?.options?.set).toBe(alone?.options?.set);
    expect(graphic?.options?.designs.map((design) => design.idea)).toEqual(
      NAMES.map((name) => `Idea ${name}`),
    );
    expect(new Set((after.graphicCompositions ?? []).map((copy) => copy.id)).size).toBe(3);
    // The person can choose any of them; undo of the last placement leaves two.
    const chosen = await made.bus.dispatch(
      'graphics.chooseOption',
      {
        projectId: made.projectId,
        timelineId: timeline.id,
        itemId: graphic!.id,
        compositionId: third.options[2]!.compositionId,
      },
      ui,
    );
    expect(chosen.ok, JSON.stringify(chosen)).toBe(true);
    value(await made.bus.undo(made.projectId, ui));
    value(await made.bus.undo(made.projectId, ui));
    expect(graphicsOf(await latest())[0]?.options?.designs).toHaveLength(2);
  });

  it('holds a growing set to the same rules: its own folder, a real difference, the same words, three at most', async () => {
    const timeline = spokenTimeline([[10, 60, 'see you at the lake']]);
    const { made, latest, place } = await world(timeline);
    const first = value<Placed>(await place('title-a', { at: 0.5, params: { title: 'Leave' } }));
    // A placed design is not placed again, as it was or rewritten.
    expect(detail(await place('title-a', { itemIds: first.itemIds }))).toContain('in the video already');
    const write = async (path: string, text: string) =>
      value(await made.call('workspace.write', { projectId: made.projectId, path, text }));
    await write('title-a/index.html', (await fixture('title-a.html')).replace('width: 96px', 'width: 120px'));
    expect(detail(await place('title-a', { itemIds: first.itemIds }))).toContain('not rewritten');
    // The first design in a new coat is not a second idea.
    await write(
      'title-d/index.html',
      (await fixture('title-a.html'))
        .replaceAll('title-a', 'title-d')
        .replace('#fdf8ee', '#ffe9a8')
        .replace('#f4b63f', '#3f7af4'),
    );
    expect(detail(await place('title-d', { itemIds: first.itemIds }))).toContain('only their colours differ');
    // Other words than the design in use carries.
    await write(
      'title-e/index.html',
      (await fixture('title-b.html'))
        .replaceAll('title-b', 'title-e')
        .replace('"id":"title"', '"id":"headline"')
        .replace('data-var-text="title"', 'data-var-text="headline"'),
    );
    expect(detail(await place('title-e', { itemIds: first.itemIds }))).toContain('same text variables');
    expect(graphicsOf(await latest())[0]?.options?.designs).toHaveLength(1);
    value(await place('title-b', { itemIds: first.itemIds }));
    value(await place('title-c', { itemIds: first.itemIds }));
    await write('title-f/index.html', (await fixture('title-b.html')).replaceAll('title-b', 'title-f'));
    expect(detail(await place('title-f', { itemIds: first.itemIds }))).toContain(
      '3 designs in the video already',
    );
    expect(graphicsOf(await latest())).toHaveLength(1);
  });

  it('draws a design the Designer did not draw, where it plays; one it cannot draw is refused', async () => {
    const timeline = spokenTimeline([[10, 60, 'see you at the lake']]);
    const asked: WorkspaceFramesInput[] = [];
    const frames = async (input: WorkspaceFramesInput) => {
      asked.push(input);
      return ok({
        frames: input.seconds.map((seconds) => ({
          seconds,
          mimeType: 'image/jpeg' as const,
          dataBase64: Buffer.from([0xff, 0xd8, 0xff, 0xe0]).toString('base64'),
          width: 216,
          height: 384,
          box: { x: 0.1, y: 0.4, width: 0.8, height: 0.1 },
        })),
        checks: [{ id: 'bounds', status: 'pass' as const }],
        ms: 5,
      });
    };
    // Written and placed with no render of its own: the tool's still for the person is the draw.
    const drawing = await world(timeline, { frames });
    value<Placed>(await drawing.place('title-a', { at: 0.5, params: { title: 'Leave' } }));
    expect(asked[0]?.over).toMatchObject({ kind: 'footage', timelineId: timeline.id, start: 0.5 });
    expect(asked[0]?.params).toEqual({ title: 'Leave' });
    expect(graphicsOf(await drawing.latest())[0]?.options?.designs[0]?.still).toMatchObject({
      mimeType: 'image/jpeg',
    });
    const broken = async () => err(ValidationError({ field: 'entry' }, { detail: 'no stills here' }));
    const failing = await world(timeline, { frames: broken as never });
    expect(detail(await failing.place('title-a', { at: 0.5, params: { title: 'Leave' } }))).toContain(
      'could not be drawn where it plays',
    );
    expect(graphicsOf(await failing.latest())).toHaveLength(0);
  });

  it('another run on the same graphic starts over: its first design goes into use and the old set goes', async () => {
    const timeline = spokenTimeline([[10, 60, 'see you at the lake']]);
    const { latest, place } = await world(timeline);
    const first = value<Placed>(await place('title-a', { at: 0.5, params: { title: 'Leave' } }));
    value(await place('title-b', { itemIds: first.itemIds }));
    const before = graphicsOf(await latest())[0]!;
    const again = value<Placed>(await place('title-c', { itemIds: first.itemIds }, 'a-later-run'));
    const after = graphicsOf(await latest())[0]!;
    expect(after.id).toBe(before.id);
    expect(after.composition.id).toBe(again.compositionId);
    expect(after.composition.params).toEqual({ title: 'Leave' });
    expect(after.options?.set).not.toBe(before.options?.set);
    expect(after.options?.designs).toHaveLength(1);
    // Another request in the same run is another job too.
    const other = value<Placed>(
      await place(
        'title-b',
        { request: 'a tag in the corner', at: 4, params: { title: 'Back' } },
        'a-later-run',
      ),
    );
    expect(other.itemIds).not.toEqual(first.itemIds);
    expect(graphicsOf(await latest())).toHaveLength(2);
  });

  it('native text becomes its graphic with the first design, and later designs join without touching its words', async () => {
    const base = makeTimeline({
      items: [{ frames: 180 }],
      texts: [{ start: 0, frames: 90, text: 'That airport feeling' }],
    });
    const timeline = timelineSchema.parse(base);
    const [text] = timeline.tracks.flatMap((track) =>
      track.kind === 'text' ? track.items : [],
    ) as TextItem[];
    const { latest, place } = await world(timeline);
    const first = value<Placed>(await place('title-a', { itemIds: [text!.id] }));
    expect(first.itemIds).toEqual([text!.id]);
    const second = value<Placed>(await place('title-b', { itemIds: [text!.id] }));
    const [graphic] = graphicsOf(await latest());
    expect(graphic?.id).toBe(text!.id);
    expect(graphic?.start).toEqual(text!.start);
    expect(graphic?.composition.id).toBe(first.compositionId);
    expect(graphic?.composition.params).toEqual({ title: 'That airport feeling' });
    expect(second.options).toHaveLength(2);
  });
});

describe('a Designer step that ends early is settled from what it placed (DSG2)', () => {
  const jobs = (timeline: Timeline, list: object[]) =>
    designerInputSchema.parse({ projectId: timeline.projectId, timelineId: timeline.id, jobs: list });

  it('one design in the video is the job done with fewer options; nothing placed is not settled', async () => {
    const timeline = spokenTimeline([[10, 60, 'see you at the lake']]);
    const { latest, place, calls } = await world(timeline);
    const input = jobs(timeline, [{ jobId: 'title', request: REQUEST, at: 0.5 }]);
    expect(settledDesigns(input, calls, await latest())).toBeUndefined();
    const first = value<Placed>(await place('title-a', { at: 0.5, params: { title: 'Leave' } }));
    const one = settledDesigns(input, calls, await latest())!;
    expect(one.results).toEqual([
      { jobId: 'title', outcome: 'placed', itemIds: first.itemIds, fewerBecause: SETTLED_FEWER },
    ]);
    expect(checkDesigns(one, input, await latest())).toEqual({ verdict: 'pass' });
    // The model's own handoff with one design and no reason is still sent back while it has turns.
    const bare = {
      ...one,
      results: [{ jobId: 'title', outcome: 'placed' as const, itemIds: first.itemIds as never }],
    };
    expect(checkDesigns(bare, input, await latest())).toMatchObject({
      verdict: 'retry',
      reason: expect.stringContaining('1 of 3'),
    });
    value(await place('title-b', { itemIds: first.itemIds }));
    value(await place('title-c', { itemIds: first.itemIds }));
    const three = settledDesigns(input, calls, await latest())!;
    expect(three.results).toEqual([{ jobId: 'title', outcome: 'placed', itemIds: first.itemIds }]);
    expect(checkDesigns(three, input, await latest())).toEqual({ verdict: 'pass' });
  });

  it('settles each job by its own placements: a redesign as replaced, a job with nothing as notDone', async () => {
    const base = makeTimeline({
      items: [{ frames: 180 }],
      texts: [{ start: 0, frames: 90, text: 'That airport feeling' }],
    });
    const timeline = timelineSchema.parse(base);
    const [text] = timeline.tracks.flatMap((track) =>
      track.kind === 'text' ? track.items : [],
    ) as TextItem[];
    const { latest, place, calls } = await world(timeline);
    const input = jobs(timeline, [
      { jobId: 'restyle', request: REQUEST, itemIds: [text!.id] },
      { jobId: 'tag', request: 'a tag in the corner', at: 4 },
      { jobId: 'pin', request: 'a map pin', at: 5 },
    ]);
    value(await place('title-a', { itemIds: [text!.id] }));
    const tag = value<Placed>(
      await place('title-b', { request: 'a tag in the corner', at: 4, params: { title: 'Back' } }),
    );
    const settled = settledDesigns(input, calls, await latest())!;
    expect(settled.results).toEqual([
      { jobId: 'restyle', outcome: 'replaced', itemIds: [text!.id], fewerBecause: SETTLED_FEWER },
      { jobId: 'tag', outcome: 'placed', itemIds: tag.itemIds, fewerBecause: SETTLED_FEWER },
      { jobId: 'pin', outcome: 'notDone', reason: SETTLED_NONE },
    ]);
    expect(checkDesigns(settled, input, await latest())).toEqual({ verdict: 'pass' });
  });
});
