// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { batchStyleResultSchema, callRpc, newId, styleSchema, type StyleId } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { createFakeBackend } from '../src/backend/fake/fake-backend';
import { GOLDEN_PROJECT, GOLDEN_TIMELINES, TRIP_PROJECT, TRIP_TIMELINE } from '../src/backend/fake/make/ids';
import { seededStyles, STYLE_IDS } from '../src/backend/fake/phase3/styles/style-seed';
import { GOLDEN_HOUR, templateIdOf } from '../src/backend/fake/templates/template-data';

function setup(styles: { empty?: boolean; uncaptioned?: boolean } = {}) {
  const { client, controls } = createFakeBackend({
    phase2: { library: { tickMs: 0 } },
    make: { renderTickMs: 0 },
    phase3: { styles },
  });
  const dispatch = (name: string, payload: unknown) =>
    callRpc(client.commands.dispatch({ name, payload, source: 'ui' }));
  const undo = (projectId: typeof GOLDEN_PROJECT | null = null) =>
    callRpc(client.commands.undo({ projectId, source: 'ui' }));
  const style = (styleId: StyleId) => client.styles.get({ styleId });
  return { client, controls, dispatch, undo, style };
}

const chai = STYLE_IDS.chai;
const golden = GOLDEN_TIMELINES.map((timelineId) => ({ projectId: GOLDEN_PROJECT, timelineId }));

describe('the fake styles (P3-V10)', () => {
  it('seeds two brand kits and a look that parse, Chai & Co. the default', async () => {
    for (const style of seededStyles()) expect(styleSchema.safeParse(style).error?.issues ?? []).toEqual([]);
    const { client } = setup();
    const list = await client.styles.list();
    expect(list.map((item) => [item.name, item.kind, item.isDefault])).toEqual([
      ['Chai & Co.', 'brandKit', true],
      ['Monsoon Travels', 'brandKit', false],
      ['Warm film', 'look', false],
    ]);
    expect(await setup({ empty: true }).client.styles.list()).toEqual([]);
  });

  it('style.update writes one field on the revision it read; a stale one is core.conflict; undo restores', async () => {
    const { dispatch, undo, style } = setup();
    const before = await style(chai);
    const patch = { colours: { ...before.colours, primary: '#123456' } };
    const updated = await dispatch('style.update', { styleId: chai, baseRevision: 1, patch });
    expect(updated.ok).toBe(true);
    expect((await style(chai)).colours.primary).toBe('#123456');
    expect((await style(chai)).revision).toBe(2);
    const stale = await dispatch('style.update', { styleId: chai, baseRevision: 1, patch: { name: 'Late' } });
    expect(stale.ok ? null : stale.error.code).toBe('core.conflict');
    expect((await undo()).ok).toBe(true);
    expect(await style(chai)).toEqual(before);
  });

  it('refuses what the real handler refuses: a logo watermark without a logo, a bad colour', async () => {
    const { dispatch } = setup();
    const monsoon = STYLE_IDS.monsoon;
    const watermark = { kind: 'logo', placement: 'topLeft', opacity: 0.3 };
    const noLogo = await dispatch('style.update', {
      styleId: monsoon,
      baseRevision: 1,
      patch: { watermark },
    });
    expect(noLogo.ok ? null : noLogo.error.code).toBe('core.validation');
    const colour = await dispatch('style.update', {
      styleId: monsoon,
      baseRevision: 1,
      patch: { colours: { primary: 'red' } },
    });
    expect(colour.ok).toBe(false);
  });

  it('imports an image by its picked path, refusing type, size and pixels', async () => {
    const { client } = setup();
    const reason = async (path: string) => {
      const imported = await callRpc(client.styles.importImage({ path }));
      return imported.ok ? 'ok' : [imported.error.code, imported.error.params?.['reason']];
    };
    expect(await reason('/Users/me/logo.gif')).toEqual(['templates.style_image_invalid', 'type']);
    expect(await reason('/Users/me/huge-logo.png')).toEqual(['templates.style_image_invalid', 'size']);
    expect(await reason('/Users/me/giant-logo.png')).toEqual(['templates.style_image_invalid', 'pixels']);
    const fine = await client.styles.importImage({ path: '/Users/me/logo.png' });
    expect(fine).toMatchObject({ mediaType: 'image/png', width: 512, height: 512 });
    expect(fine.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('creates, makes default and deletes; delete is refused while a template names the kit', async () => {
    const { client, dispatch, style } = setup();
    const styleId = newId<'Style'>();
    const {
      schemaVersion: _v,
      id: _id,
      revision: _r,
      createdAt: _c,
      updatedAt: _u,
      ...input
    } = await style(chai);
    expect((await dispatch('style.create', { styleId, style: { ...input, name: 'Copy' } })).ok).toBe(true);
    expect((await dispatch('style.setDefault', { styleId })).ok).toBe(true);
    expect((await client.styles.list()).find((item) => item.isDefault)?.id).toBe(styleId);
    const templateId = templateIdOf(GOLDEN_HOUR);
    const set = await dispatch('template.setStyle', { projectId: null, templateId, baseVersion: 2, styleId });
    expect(set.ok).toBe(true);
    expect(await client.styles.usedBy({ styleId })).toEqual({ timelines: 0, templates: 1 });
    const refused = await dispatch('style.delete', { styleId });
    expect(refused.ok ? null : [refused.error.code, refused.error.params]).toEqual([
      'templates.style_in_use',
      { timelines: 0, templates: 1 },
    ]);
  });

  it('timeline.setStyle puts the kit and its caption look on a video; undo takes both back', async () => {
    const { client, dispatch, undo } = setup();
    const target = { projectId: TRIP_PROJECT, timelineId: TRIP_TIMELINE };
    const before = await client.timelines.get({ timelineId: TRIP_TIMELINE });
    expect((await dispatch('timeline.setStyle', { ...target, styleId: chai })).ok).toBe(true);
    const after = await client.timelines.get({ timelineId: TRIP_TIMELINE });
    expect(after.styleId).toBe(chai);
    expect(after.captions?.styleSource).toBe('preset');
    expect(after.captions?.style.highlightColor).toBe('#fde68a');
    expect((await undo(TRIP_PROJECT)).ok).toBe(true);
    const back = await client.timelines.get({ timelineId: TRIP_TIMELINE });
    expect([back.styleId, back.captions]).toEqual([before.styleId, before.captions]);
    const missing = await dispatch('timeline.setStyle', { ...target, styleId: newId<'Style'>() });
    expect(missing.ok ? null : missing.error.code).toBe('timeline.style_not_found');
  });

  it('batch.applyStyle skips videos without captions for a preset; undo lists what changed since', async () => {
    const { client, dispatch, undo } = setup({ uncaptioned: true });
    const applied = await dispatch('batch.applyStyle', {
      items: golden,
      apply: { kind: 'captionPreset', presetId: 'bold' },
    });
    expect(applied.ok).toBe(true);
    const receipt = applied.ok ? (applied.value as { result: unknown }).result : null;
    expect(batchStyleResultSchema.parse(receipt)).toEqual({
      applied: [GOLDEN_TIMELINES[0]],
      skipped: [
        { timelineId: GOLDEN_TIMELINES[1], reason: 'noCaptions' },
        { timelineId: GOLDEN_TIMELINES[2], reason: 'noCaptions' },
      ],
    });
    // Everything with a Style, then someone changes one video before the undo.
    const styled = await dispatch('batch.applyStyle', {
      items: golden,
      apply: { kind: 'style', styleId: chai },
    });
    expect(styled.ok).toBe(true);
    await dispatch('timeline.setStyle', { ...golden[1], styleId: STYLE_IDS.monsoon });
    const undone = await undo();
    expect(undone.ok && undone.value?.name).toBe('batch.applyStyle');
    const result = batchStyleResultSchema.parse(undone.ok ? undone.value?.result : null);
    expect(result.skipped).toEqual([{ timelineId: GOLDEN_TIMELINES[1], reason: 'changedSince' }]);
    expect((await client.timelines.get({ timelineId: GOLDEN_TIMELINES[0]! })).styleId).toBeNull();
    expect((await client.timelines.get({ timelineId: GOLDEN_TIMELINES[1]! })).styleId).toBe(
      STYLE_IDS.monsoon,
    );
  });

  it('a batch is all or nothing: a video listed twice or missing changes none', async () => {
    const { client, dispatch } = setup();
    const twice = await dispatch('batch.applyStyle', {
      items: [golden[0], golden[0]],
      apply: { kind: 'style', styleId: chai },
    });
    expect(twice.ok ? null : twice.error.code).toBe('core.validation');
    const wrongProject = await dispatch('batch.applyStyle', {
      items: [golden[0], { projectId: TRIP_PROJECT, timelineId: GOLDEN_TIMELINES[1] }],
      apply: { kind: 'style', styleId: chai },
    });
    expect(wrongProject.ok ? null : wrongProject.error.code).toBe('timeline.not_found');
    expect((await client.timelines.get({ timelineId: GOLDEN_TIMELINES[0]! })).styleId).toBeNull();
  });
});
