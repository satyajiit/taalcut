// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * HFW1-UI: the preview's designed graphics and their files. With `designs`, Golden hour's first video has two
 * bubbles (one design, used) and a proposed price tag; its workspace lists revisions newest first and reads a
 * file's text (none for an image); writeFiles needs the head as its base and restore moves the head, ⌘Z taking
 * each back; placeComposition proposes a graphic and keeps its copy; setComposition gives the bubbles the next
 * version, keeping their own words; graphics.edit sets a designed graphic's variables. The files viewer's model
 * lists the designs in the order they play and groups files by folder. Made-up designs only.
 */
import {
  callRpc,
  GRAPHICS_COMMANDS,
  WORKSPACE_COMMANDS,
  type GraphicItem,
  type Timeline,
  type WorkspaceFile,
} from '@taalcut/core';
import { DESIGN_COMPOSITIONS, DESIGN_FILE_SHAS, DESIGN_FIXTURE_IDS } from '@taalcut/ui';
import { describe, expect, it } from 'vitest';
import { createFakeBackend } from '../src/backend/fake/fake-backend';
import { GOLDEN_PROJECT, GOLDEN_TIMELINES } from '../src/backend/fake/make/ids';
import {
  designOfItem,
  designsOn,
  fileGroups,
  firstFile,
  listedPaths,
} from '../src/features/timeline/workspace/files-model';

const projectId = GOLDEN_PROJECT;
const timelineId = GOLDEN_TIMELINES[0]!;
const where = { projectId, timelineId };
const ids = DESIGN_FIXTURE_IDS.graphics;

function setup() {
  const { client, controls } = createFakeBackend({
    phase2: { library: { tickMs: 0 } },
    phase3: { designs: { arranged: true } },
  });
  const dispatch = (name: string, payload: unknown, source: 'ui' | 'agent' = 'ui') =>
    source === 'agent'
      ? controls.bus.dispatch(name, payload, { source, actor: 'agent:run' })
      : callRpc(client.commands.dispatch({ name, payload, source }));
  const undo = () => callRpc(client.commands.undo({ projectId, source: 'ui' }));
  const timeline = () => client.timelines.get({ timelineId });
  return { client, dispatch, undo, timeline };
}

const graphics = (timeline: Timeline) =>
  timeline.tracks.flatMap((track) =>
    track.kind === 'text' ? track.items.filter((item): item is GraphicItem => item.type === 'graphic') : [],
  );
const byId = (timeline: Timeline, id: string) => graphics(timeline).find((item) => item.id === id);

describe('the preview’s designed graphics (HFW1-UI)', () => {
  it('Golden hour’s first video has the bubbles and a proposed price tag, drawn with their copies', async () => {
    const { timeline } = setup();
    const now = await timeline();
    expect(graphics(now).map((item) => item.id)).toEqual([ids.askBubble, ids.replyBubble, ids.priceTag]);
    expect(byId(now, ids.priceTag)?.proposal?.design).toBe('designed');
    expect(now.graphicCompositions?.map((copy) => copy.name)).toEqual(['Chat bubble', 'Price tag']);
  });

  it('lists the workspace newest first and reads a file’s text, an image as none', async () => {
    const { client } = setup();
    const listing = await client.workspace.list({ projectId });
    expect(listing.head).toBe(2);
    expect(listing.revisions.map((each) => each.revision)).toEqual([2, 1]);
    const html = await client.workspace.read({ projectId, sha256: DESIGN_FILE_SHAS.bubbleHtml });
    expect(html.text).toContain('data-composition-id="chat-bubble"');
    expect((await client.workspace.read({ projectId, sha256: DESIGN_FILE_SHAS.grain })).text).toBeNull();
    await expect(client.workspace.read({ projectId, sha256: 'f'.repeat(64) })).rejects.toBeTruthy();
  });

  it('writeFiles needs the head as its base; restore moves the head; ⌘Z takes each back', async () => {
    const { client, dispatch, undo } = setup();
    const files = DESIGN_COMPOSITIONS.headline.files.map((file) => ({ path: file.path, sha256: file.sha256 }));
    const stale = await dispatch(WORKSPACE_COMMANDS.writeFiles, { projectId, baseRevision: 1, files }, 'agent');
    expect(!stale.ok && stale.error.code).toBe('core.conflict');
    expect((await dispatch(WORKSPACE_COMMANDS.writeFiles, { projectId, baseRevision: 2, files }, 'agent')).ok).toBe(
      true,
    );
    expect((await client.workspace.list({ projectId })).head).toBe(3);
    expect((await dispatch(WORKSPACE_COMMANDS.restore, { projectId, revision: 1 })).ok).toBe(true);
    const restored = await client.workspace.list({ projectId });
    expect(restored.head).toBe(1);
    expect(restored.revisions.map((each) => each.revision)).toEqual([3, 2, 1]);
    expect((await undo()).ok).toBe(true);
    expect((await client.workspace.list({ projectId })).head).toBe(3);
    const missing = await dispatch(WORKSPACE_COMMANDS.restore, { projectId, revision: 9 });
    expect(!missing.ok && missing.error.code).toBe('core.not_found');
  });

  it('placeComposition proposes a graphic and keeps its copy; ⌘Z takes it off', async () => {
    const { dispatch, undo, timeline } = setup();
    const at = { value: 120, rate: (await timeline()).canvas.rate };
    const placed = await dispatch(
      GRAPHICS_COMMANDS.placeComposition,
      {
        ...where,
        composition: DESIGN_COMPOSITIONS.headline,
        anchor: { kind: 'time', at },
        proposal: { request: 'a headline at 0:04', design: 'designed', createdAt: 0 },
      },
      'agent',
    );
    expect(placed.ok).toBe(true);
    const now = await timeline();
    const headline = graphics(now).find((item) => item.composition?.id === DESIGN_COMPOSITIONS.headline.id);
    expect(headline).toMatchObject({ start: at, proposal: { design: 'designed' }, origin: 'agent' });
    expect(now.graphicCompositions?.some((copy) => copy.id === DESIGN_COMPOSITIONS.headline.id)).toBe(true);
    expect((await undo()).ok).toBe(true);
    expect(graphics(await timeline())).toHaveLength(3);
  });

  it('setComposition gives the bubbles the next version, each keeping its own words', async () => {
    const { dispatch, timeline } = setup();
    const next = DESIGN_COMPOSITIONS.bubbleV2;
    const done = await dispatch(
      GRAPHICS_COMMANDS.setComposition,
      { ...where, itemIds: [ids.askBubble, ids.replyBubble], composition: next },
      'agent',
    );
    expect(done.ok).toBe(true);
    const now = await timeline();
    expect(byId(now, ids.askBubble)?.composition).toMatchObject({ hash: next.hash, params: { side: 'left' } });
    expect(byId(now, ids.replyBubble)?.composition?.params).toMatchObject({ message: 'Almost there', ticks: true });
    expect(now.graphicCompositions?.filter((copy) => copy.id === next.id).map((copy) => copy.version)).toEqual([
      1, 2,
    ]);
  });

  it('graphics.edit sets a designed graphic’s words and its time', async () => {
    const { dispatch, undo, timeline } = setup();
    const done = await dispatch(GRAPHICS_COMMANDS.edit, {
      ...where,
      itemId: ids.priceTag,
      params: { price: '₹99 a dozen' },
    });
    expect(done.ok).toBe(true);
    expect(byId(await timeline(), ids.priceTag)?.composition?.params).toEqual({
      item: 'Mangoes',
      price: '₹99 a dozen',
    });
    expect(byId(await timeline(), ids.priceTag)?.origin).toBe('user');
    expect((await undo()).ok).toBe(true);
    expect(byId(await timeline(), ids.priceTag)?.composition?.params.price).toBe('₹120 a dozen');
  });
});

describe('the files viewer’s model (HFW1-UI)', () => {
  it('lists the designs in the order they first play, each once, and finds a graphic’s', async () => {
    const now = await setup().timeline();
    const designs = designsOn(now);
    expect(designs.map((design) => design.composition.name)).toEqual(['Chat bubble', 'Price tag']);
    expect(designs[0]!.itemIds).toEqual([ids.askBubble, ids.replyBubble]);
    expect(designOfItem(designs, ids.priceTag)?.composition.name).toBe('Price tag');
    expect(designOfItem(designs, null)).toBeNull();
  });

  it('groups files by folder, folders by name, the top’s files last', () => {
    const file = (path: string): WorkspaceFile => ({ path, sha256: 'a'.repeat(64), bytes: 10 });
    const groups = fileGroups([
      file('notes.txt'),
      file('headline/style.css'),
      file('bubble/style.css'),
      file('bubble/index.html'),
      file(`assets/${'b'.repeat(64)}`),
    ]);
    expect(groups.map((group) => group.folder)).toEqual(['assets', 'bubble', 'headline', '']);
    expect(listedPaths(groups).slice(1, 3)).toEqual(['bubble/index.html', 'bubble/style.css']);
    expect(firstFile(groups, 'headline/style.css')).toBe('headline/style.css');
    expect(firstFile(groups, 'gone.html')).toBe(`assets/${'b'.repeat(64)}`);
  });
});
