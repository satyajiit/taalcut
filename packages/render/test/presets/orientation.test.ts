// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * BRK1-ACC: a landscape template's video exports landscape unless the person picks a vertical preset. The preset an
 * export uses without a choice follows the timeline's canvas, which assembly takes from the template.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMemorySettingsStore, FrameRate, newId, type Timeline } from '@taalcut/core';
import { canvasPreset } from '../../src/presets/canvas-preset';
import { defaultPresetFor, presetFor } from '../../src/presets/presets.v1';
import { exportOptions } from '../../src/router/export-options';
import { exportSettingFor, readExportSettings, DEFAULT_EXPORT_SETTINGS } from '../../src/settings';
import { fakeWorld, type FakeWorld } from '../router/fixtures';
import { tempDir } from '../support/media';
import { makeTimeline } from '../support/timeline';

const rate = FrameRate.of(30);

describe('defaultPresetFor', () => {
  it('keeps a landscape canvas landscape: 16:9 and wider, then 4:3', () => {
    expect(defaultPresetFor({ width: 1080, height: 608 })).toBe('landscape');
    expect(defaultPresetFor({ width: 1920, height: 1080 })).toBe('landscape');
    expect(defaultPresetFor({ width: 2560, height: 1080 })).toBe('landscape');
    expect(defaultPresetFor({ width: 1440, height: 1080 })).toBe('standard');
  });

  it('is the vertical default for a portrait or square canvas', () => {
    expect(defaultPresetFor({ width: 1080, height: 1920 })).toBe('device');
    expect(defaultPresetFor({ width: 1080, height: 1080 })).toBe('device');
  });
});

describe('readExportSettings with a canvas', () => {
  const projectId = newId<'Project'>();
  const landscape = { width: 1080, height: 608 };

  it('answers the canvas’s preset while the person has chosen none', async () => {
    const store = createMemorySettingsStore();
    const read = await readExportSettings(store, projectId, landscape);
    expect(read.ok && read.value.presetId).toBe('landscape');
    const none = await readExportSettings(undefined, projectId, landscape);
    expect(none.ok && none.value.presetId).toBe('landscape');
  });

  it('keeps the person’s choice, a vertical preset included', async () => {
    const store = createMemorySettingsStore();
    await store.set(exportSettingFor(projectId), { ...DEFAULT_EXPORT_SETTINGS, presetId: 'device' });
    const read = await readExportSettings(store, projectId, landscape);
    expect(read.ok && read.value.presetId).toBe('device');
  });

  it('without a canvas is the stored settings, as before', async () => {
    const read = await readExportSettings(createMemorySettingsStore(), projectId);
    expect(read.ok && read.value.presetId).toBe('device');
  });
});

describe('renders.exportOptions for a landscape timeline', () => {
  let work: Awaited<ReturnType<typeof tempDir>>;
  let world: FakeWorld;

  beforeAll(async () => {
    work = await tempDir('export-options-orientation');
    world = await fakeWorld(work.dir);
  });
  afterAll(async () => work?.dispose());

  const landscapeTimeline = (): Timeline => {
    const made = makeTimeline({ rate, items: [{ frames: 300 }] });
    const timeline = { ...made, canvas: { width: 1080, height: 608, rate } };
    world.timelines.set(timeline.id, timeline);
    return timeline;
  };

  it('defaults to the landscape preset when nothing is chosen', async () => {
    const timeline = landscapeTimeline();
    const options = await exportOptions(world.deps, {
      projectId: timeline.projectId,
      timelineId: timeline.id,
    });
    expect(options.ok && options.value.defaultPresetId).toBe('landscape');
  });

  it('keeps a vertical preset the person picked', async () => {
    const timeline = landscapeTimeline();
    const options = await exportOptions(
      world.deps,
      { projectId: timeline.projectId, timelineId: timeline.id },
      { defaultPresetId: async () => ({ ok: true, value: 'reels' }) },
    );
    expect(options.ok && options.value.defaultPresetId).toBe('reels');
  });
});

it('adapts an odd legacy canvas once for preview, frame capture and export without changing its document', () => {
  const canvas = { width: 1081, height: 1921 };
  const output = canvasPreset(presetFor('device'), canvas);
  expect({ width: output.width, height: output.height }).toEqual({ width: 1082, height: 1922 });
  expect(canvas).toEqual({ width: 1081, height: 1921 });
});
