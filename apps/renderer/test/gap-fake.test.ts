// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { callRpc, stockSearchPageSchema, type Timeline, type TimelineItemId } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { createFakeBackend } from '../src/backend/fake/fake-backend';
import { GOLDEN_PROJECT, GOLDEN_TIMELINES } from '../src/backend/fake/make/ids';
import { stockAssetId } from '../src/backend/fake/phase3/stock/stock-data';
import { fillGapWithStock } from '../src/features/timeline/gaps/stock-use';

const VIDEO = GOLDEN_TIMELINES[1]!;
const projectId = GOLDEN_PROJECT;

function setup() {
  const { client, controls } = createFakeBackend({
    phase2: { library: { tickMs: 0 } },
    make: { renderTickMs: 0, areas: { gaps: { punch: 'golden' } } },
  });
  const dispatch = (name: string, payload: unknown, source: 'ui' | 'agent' = 'ui') =>
    source === 'agent'
      ? controls.bus.dispatch(name, payload, { source, actor: 'agent:test' })
      : callRpc(client.commands.dispatch({ name, payload, source }));
  const undo = () => callRpc(client.commands.undo({ projectId, source: 'ui' }));
  const code = (result: { ok: boolean; error?: { code: string } }) => (result.ok ? 'ok' : result.error?.code);
  const timeline = () => controls.make.timelines.get(VIDEO) as Timeline;
  const v1 = () => timeline().tracks[0]!.items.filter((item) => item.type !== 'transition');
  const gaps = async () => {
    const found = await callRpc(client.timelines.gaps({ timelineId: VIDEO }));
    if (!found.ok) throw new Error(found.error.code);
    return found.value;
  };
  return { client, controls, dispatch, undo, code, timeline, v1, gaps };
}

describe('the fake gaps (P3-B8)', () => {
  it('lists the punched slots with their intents, and the phone shot list', async () => {
    const { client, gaps } = setup();
    const found = await gaps();
    expect(found.map((gap) => gap.number)).toEqual([3, 7]);
    expect(found[0]!.intent?.text).toBe('Waves washing over feet, slow motion');
    expect(found[0]!.note).toBe('noCandidates');
    const list = await callRpc(client.timelines.shotList({ timelineId: VIDEO }));
    expect(list.ok && list.value.map((item) => [item.number, item.orientation])).toEqual([
      [3, 'portrait'],
      [7, 'portrait'],
    ]);
  });

  it('fills a gap with a still (one undo step) and refuses what the real handler refuses', async () => {
    const { dispatch, undo, code, gaps, v1, timeline } = setup();
    const [first] = await gaps();
    const clip = v1().find((item) => item.type === 'clip')!;
    const fill = (gapId: string, media: unknown) =>
      dispatch('timeline.fillGap', { projectId, timelineId: VIDEO, gapId, media });
    const image = { kind: 'image', assetId: clip.type === 'clip' ? clip.media.assetId : '' };
    expect(code(await fill(clip.id, image))).toBe('timeline.not_a_gap');
    expect(code(await fill('01K7C5M6Q8N0000000000000ZZ', image))).toBe('timeline.gap_not_found');
    expect(
      code(await fill(first!.gapId, { kind: 'video', assetId: '01K7C5M6Q81000000000ZZZZZZ', shotId: null })),
    ).toBe('timeline.media_missing');

    expect(code(await fill(first!.gapId, image))).toBe('ok');
    const filled = v1().find((item) => item.id === first!.gapId);
    expect(filled?.type === 'clip' && filled.media.kind).toBe('image');
    expect(filled?.type === 'clip' && filled.stillMotion).toBe('pushIn');
    expect(timeline().cast?.slots.find((slot) => slot.slotId === first!.slotId)?.note).toBe('gapFilled');
    expect((await gaps()).map((gap) => gap.number)).toEqual([7]);
    expect(code(await undo())).toBe('ok');
    expect((await gaps()).map((gap) => gap.number)).toEqual([3, 7]);
  });

  it('drops a slot with a ripple: the video gets shorter, text after it moves earlier, undo puts it back', async () => {
    const { dispatch, undo, code, gaps, v1, timeline, controls } = setup();
    const [, second] = await gaps();
    const length = () => v1().reduce((sum, item) => sum + item.duration.value, 0);
    const texts = () => {
      const track = timeline().tracks[1];
      return track?.kind === 'text' ? track.items.map((item) => item.start.value) : [];
    };
    const before = { count: v1().length, length: length(), texts: texts() };
    const at = second!.start.value;
    expect(
      code(
        await dispatch('timeline.dropSlot', {
          projectId,
          timelineId: VIDEO,
          itemId: second!.gapId,
          mode: 'ripple',
        }),
      ),
    ).toBe('ok');
    expect(v1()).toHaveLength(before.count - 1);
    expect(length()).toBe(before.length - second!.duration.value);
    expect(texts()).toEqual(
      before.texts
        .filter((start) => start < at || start >= at + second!.duration.value)
        .map((start) => (start >= at ? start - second!.duration.value : start)),
    );
    expect(timeline().cast?.slots.find((slot) => slot.slotId === second!.slotId)?.note).toBe('dropped');
    expect(code(await undo())).toBe('ok');
    expect(v1()).toHaveLength(before.count);
    // A locked clip is the person's: the agent can't drop it.
    const clip = v1().find((item) => item.type === 'clip')!;
    // (Locked in the document itself: the Phase 2 fake's timeline.lockClip rebuilds V1 from its clips alone.)
    const doc = timeline();
    controls.make.timelines.replace(projectId, {
      ...doc,
      tracks: doc.tracks.map((track, index) =>
        index === 0 && track.kind === 'video'
          ? {
              ...track,
              items: track.items.map((item) => (item.id === clip.id ? { ...item, locked: true } : item)),
            }
          : track,
      ),
    });
    expect(
      code(await dispatch('timeline.dropSlot', { projectId, timelineId: VIDEO, itemId: clip.id }, 'agent')),
    ).toBe('timeline.clip_locked');
    expect(controls.dispatched.some((entry) => entry.name === 'timeline.dropSlot')).toBe(true);
  });

  it('marks slots for filming, onto the shot list, and back', async () => {
    const { client, dispatch, code, timeline } = setup();
    const slot = timeline().cast!.slots[0]!;
    const mark = (on: boolean, slotIds = [slot.slotId]) =>
      dispatch('timeline.markForFilming', { projectId, timelineId: VIDEO, slotIds, on });
    expect(code(await mark(true, ['01K7C5M6Q8X0000000000000ZZ' as never]))).toBe('timeline.item_not_found');
    expect(code(await mark(true))).toBe('ok');
    const list = await callRpc(client.timelines.shotList({ timelineId: VIDEO }));
    expect(list.ok && list.value.map((item) => item.number)).toEqual([1, 3, 7]);
    expect(code(await mark(false))).toBe('ok');
    expect(timeline().cast!.slots[0]!.note).toBe(slot.note);
  });
});

describe('the fake stock service (P3-V18)', () => {
  it('searches as the library does: previews under app://media/stock, no key is a page, Local only refuses', async () => {
    const { client, controls } = setup();
    const page = await callRpc(client.library.stockSearch({ query: 'waves feet', kind: 'video', page: 1 }));
    expect(page.ok && stockSearchPageSchema.safeParse(page.value).success).toBe(true);
    expect(page.ok && page.value.items.length).toBeGreaterThan(0);
    controls.phase3.stock.setScenario('noKey');
    const none = await callRpc(client.library.stockSearch({ query: 'waves', kind: 'video', page: 1 }));
    expect(none.ok && none.value).toEqual({ items: [], providersOff: ['pexels'] });
    controls.phase3.stock.setScenario('localOnly');
    const refused = await callRpc(client.library.stockSearch({ query: 'waves', kind: 'video', page: 1 }));
    expect(!refused.ok && refused.error.code).toBe('core.local_only');
  });

  it('Use it: imports, waits for the job, fills the gap with the new asset; an unsearched item is refused', async () => {
    const { client, controls, gaps, v1, dispatch, code } = setup();
    expect(
      code(
        await dispatch('library.importStock', {
          importId: '01K7C5M6Q8Y000000000000001',
          item: { provider: 'pexels', providerId: '1918465', kind: 'video', renditionKey: 'hd-portrait' },
          projectId,
        }),
      ),
    ).toBe('library.stock_unavailable');
    const page = await callRpc(client.library.stockSearch({ query: 'waves feet', kind: 'video', page: 1 }));
    const item = page.ok ? page.value.items[0]! : null;
    const [first] = await gaps();
    const used = await fillGapWithStock(client, {
      item: item!,
      projectId,
      timelineId: VIDEO,
      gapId: first!.gapId,
    });
    expect(used.ok && used.value.assetId).toBe(stockAssetId(item!.providerId));
    const clip = v1().find((entry) => entry.id === (first!.gapId as TimelineItemId));
    expect(clip?.type === 'clip' && clip.media.assetId).toBe(stockAssetId(item!.providerId));
    const names = controls.dispatched.map((entry) => entry.name);
    expect(names.slice(-3)).toEqual(['library.importStock', 'library.importStock', 'timeline.fillGap']);
    // The export's credits know where it came from (P3-V18): Pexels asks for nothing, so it's a courtesy line.
    const credits = await callRpc(client.library.credits({ assetIds: [stockAssetId(item!.providerId)] }));
    expect(credits.ok && credits.value.required).toEqual([]);
    expect(credits.ok && credits.value.courtesy[0]).toMatch(/^Video by .+ on Pexels$/);
  });

  it('a failed import sends no timeline.fillGap', async () => {
    const { client, controls, gaps } = setup();
    controls.phase3.stock.setScenario('failing');
    const page = await callRpc(
      client.library.stockSearch({ query: 'fabric colours', kind: 'video', page: 1 }),
    );
    const item = page.ok ? page.value.items[0]! : null;
    const [, second] = await gaps();
    const used = await fillGapWithStock(client, {
      item: item!,
      projectId,
      timelineId: VIDEO,
      gapId: second!.gapId,
    });
    expect(!used.ok && used.error.code).toBe('library.stock_download_failed');
    expect(controls.dispatched.map((entry) => entry.name)).not.toContain('timeline.fillGap');
    expect((await gaps()).map((gap) => gap.number)).toEqual([3, 7]);
  });
});
