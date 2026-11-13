// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { createMemorySettingsStore, newId, unwrap } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { canvasPreset } from '../../src/presets/canvas-preset';
import { presetFor } from '../../src/presets/presets.v1';
import {
  DEFAULT_EXPORT_SETTINGS,
  exportSettingFor,
  readExportSettings,
  settingsCodec,
  type ExportSettings,
} from '../../src/settings';

const square = { width: 1080, height: 1080 };
const landscape = { width: 1920, height: 1080 };

function world() {
  return {
    store: createMemorySettingsStore(),
    projectId: newId<'Project'>(),
    original: newId<'Timeline'>(),
    firstCopy: newId<'Timeline'>(),
    secondCopy: newId<'Timeline'>(),
  };
}

describe('independent size copies’ export settings', () => {
  it.each([{ width: 1080, height: 1920 }, { width: 1080, height: 1350 }, square, landscape])(
    'starts a $width × $height copy at its canvas without the original’s preset or codec',
    async (canvas) => {
      const { store, projectId, original, firstCopy } = world();
      const project: ExportSettings = {
        ...DEFAULT_EXPORT_SETTINGS,
        presetId: 'reels',
        codec: 'hevc',
        captions: { burnIn: false, sidecars: ['srt'] },
        includeBumpers: false,
        contentCredentials: { add: true },
      };
      const chosen: ExportSettings = { ...project, presetId: 'shorts' };
      unwrap(await store.set(exportSettingFor(projectId), project));
      unwrap(await store.set(exportSettingFor(projectId, original), chosen));

      const copy = unwrap(
        await readExportSettings(store, projectId, canvas, {
          timelineId: firstCopy,
          preferCanvas: true,
        }),
      );
      expect(copy).toEqual({ ...project, presetId: 'device', codec: undefined });
      expect(settingsCodec(copy)).toEqual({});
      expect(canvasPreset(presetFor(copy.presetId), canvas)).toMatchObject(canvas);
      expect(unwrap(await readExportSettings(store, projectId, landscape, { timelineId: original }))).toEqual(
        chosen,
      );
      expect(unwrap(await store.get(exportSettingFor(projectId)))).toEqual(project);
      // Reading defaults must not materialize a choice that later blocks the copy's own canvas.
      const local = exportSettingFor(projectId, firstCopy);
      expect(unwrap(await store.get(local))).toBe(local.defaultValue);
    },
  );

  it('keeps each copy’s later choices independent of the original and the other copy', async () => {
    const { store, projectId, original, firstCopy, secondCopy } = world();
    const project: ExportSettings = {
      ...DEFAULT_EXPORT_SETTINGS,
      presetId: 'landscape',
      captions: { burnIn: false, sidecars: ['srt'] },
      includeBumpers: false,
    };
    const first: ExportSettings = {
      ...DEFAULT_EXPORT_SETTINGS,
      presetId: 'tiktok',
      codec: 'hevc',
      captions: { burnIn: false, sidecars: ['vtt'] },
      includeBumpers: false,
    };
    // An explicit choice equal to the default still counts as a choice, unlike an untouched setting.
    const second: ExportSettings = { ...DEFAULT_EXPORT_SETTINGS };
    unwrap(await store.set(exportSettingFor(projectId), project));
    unwrap(await store.set(exportSettingFor(projectId, firstCopy), first));
    unwrap(await store.set(exportSettingFor(projectId, secondCopy), second));
    const read = async (timelineId: typeof original) =>
      unwrap(
        await readExportSettings(store, projectId, square, {
          timelineId,
          preferCanvas: timelineId !== original,
        }),
      );

    expect(await read(firstCopy)).toEqual(first);
    expect(await read(secondCopy)).toEqual(second);
    expect(await read(original)).toEqual(project);
    unwrap(
      await store.set(exportSettingFor(projectId, firstCopy), {
        ...first,
        presetId: 'deviceAv1',
        codec: undefined,
      }),
    );
    expect(await read(firstCopy)).toEqual({ ...first, presetId: 'deviceAv1', codec: undefined });
    expect(await read(secondCopy)).toEqual(second);
    expect(await read(original)).toEqual(project);
  });

  it.each([false, true])('always inherits project Content Credentials, initially add=%s', async (add) => {
    const { store, projectId, original, firstCopy, secondCopy } = world();
    const project: ExportSettings = { ...DEFAULT_EXPORT_SETTINGS, contentCredentials: { add } };
    unwrap(await store.set(exportSettingFor(projectId), project));
    for (const timelineId of [original, firstCopy]) {
      unwrap(
        await store.set(exportSettingFor(projectId, timelineId), {
          ...DEFAULT_EXPORT_SETTINGS,
          presetId: 'reels',
          contentCredentials: { add: !add },
        }),
      );
    }
    const readAll = () =>
      Promise.all(
        [original, firstCopy, secondCopy].map(async (timelineId) =>
          unwrap(
            await readExportSettings(store, projectId, square, {
              timelineId,
              preferCanvas: timelineId !== original,
            }),
          ),
        ),
      );
    expect((await readAll()).map((settings) => settings.contentCredentials)).toEqual([
      { add },
      { add },
      { add },
    ]);
    unwrap(await store.set(exportSettingFor(projectId), { ...project, contentCredentials: { add: !add } }));
    expect((await readAll()).map((settings) => settings.contentCredentials)).toEqual([
      { add: !add },
      { add: !add },
      { add: !add },
    ]);
    expect((await readAll()).map((settings) => settings.presetId)).toEqual(['reels', 'reels', 'device']);
  });

  it('uses canvas-sized device defaults without a settings store', async () => {
    const { projectId, firstCopy } = world();
    const read = unwrap(
      await readExportSettings(undefined, projectId, landscape, {
        timelineId: firstCopy,
        preferCanvas: true,
      }),
    );
    expect(read).toEqual({ ...DEFAULT_EXPORT_SETTINGS, presetId: 'device', codec: undefined });
    expect(canvasPreset(presetFor(read.presetId), landscape)).toMatchObject(landscape);
  });
});
