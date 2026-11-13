// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * LNX1-AV1, the presets and their codecs: the two AV1 presets, the platform presets' HEVC choice (H.264 the
 * default), which codecs a machine can encode (media's working hardware encoders), the export options that gate
 * the AV1 presets on it (an RTX 40 host, a Mac, a CPU-only machine), the request's codec, and the saved setting.
 */
import { describe, expect, it } from 'vitest';
import {
  createCommandBus,
  createManualClock,
  createMemoryAuditLogStore,
  createMemorySettingsStore,
  exportRequestSchema,
  unwrap,
} from '@taalcut/core';
import type { MediaContext } from '@taalcut/media';
import { createRenderCommands } from '../../src/commands/render-commands';
import { exportRequestKey, resolveExportRequest } from '../../src/commands/request';
import { checkExportCodec, codecAvailability, presetCodecAvailability } from '../../src/presets/codecs';
import {
  AGENT_PRESET_IDS,
  BUILT_PRESET_IDS,
  EXPORT_PRESETS,
  OVERLAY_PRESET_IDS,
  presetCodecs,
  presetFor,
  presetInCodec,
} from '../../src/presets/presets.v1';
import { exportOptions } from '../../src/router/export-options';
import { exportSettingFor, settingsCodec } from '../../src/settings';
import { knownEncoders } from '../support/host-video';
import { makeTimeline } from '../support/timeline';
import { fakeWorld } from '../router/fixtures';
import { tempDir } from '../support/media';
import { memoryRenderStore } from '../support/render-store';
import { memoryTimelines, recordingEnqueuer, UI } from '../commands/support';

const binaries = { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe', source: 'sidecar' } as const;
/** The RTX 4090 host: NVENC for all three. */
const NVIDIA: MediaContext = {
  binaries,
  platform: 'linux',
  encoders: knownEncoders({ h264: 'h264_nvenc', hevc: 'hevc_nvenc', av1: 'av1_nvenc' }),
};
/** An Apple silicon Mac: VideoToolbox H.264 and HEVC, no AV1 encoder. */
const MAC: MediaContext = {
  binaries,
  platform: 'darwin',
  encoders: knownEncoders({ h264: 'h264_videotoolbox', hevc: 'hevc_videotoolbox' }),
};
/** No usable GPU: OpenH264 only. */
const CPU: MediaContext = { binaries, platform: 'linux', encoders: knownEncoders({ h264: 'libopenh264' }) };

describe('the AV1 presets and the platform presets’ codecs', () => {
  it('builds YouTube Shorts and the device copy in AV1, outside the portable agent catalogue', () => {
    expect(
      EXPORT_PRESETS.filter((preset) => preset.video.codec === 'av1').map((preset) => preset.id),
    ).toEqual(['youtubeAv1', 'deviceAv1']);
    expect(presetFor('youtubeAv1')).toMatchObject({
      platform: 'shorts',
      width: 1080,
      height: 1920,
      video: { codec: 'av1', bitrateKbps: 8_000, bitrateKbpsHighRate: 12_000 },
      duration: { minSeconds: 1, maxSeconds: 179 },
      safe: presetFor('shorts').safe,
      overlays: presetFor('shorts').overlays,
    });
    expect(presetFor('deviceAv1')).toMatchObject({
      platform: null,
      video: { codec: 'av1' },
      duration: { maxSeconds: 600 },
      safe: presetFor('device').safe,
    });
    expect(BUILT_PRESET_IDS).toEqual(expect.arrayContaining(['youtubeAv1', 'deviceAv1']));
    // The agent's tools offer what every machine renders (the recorded sessions' catalogue); the person picks AV1.
    expect(AGENT_PRESET_IDS).toEqual([
      'shorts',
      'reels',
      'tiktok',
      'device',
      'deviceHevc',
      'landscape',
      'standard',
      'square',
      'portrait',
      'square2160',
      'portrait2160',
      'master4k',
      'landscape4k',
    ]);
    for (const id of AGENT_PRESET_IDS) expect(BUILT_PRESET_IDS).toContain(id);
    expect(OVERLAY_PRESET_IDS).not.toContain('youtubeAv1');
  });

  it('offers HEVC on Shorts, Reels and TikTok with H.264 the default and keeps the device codecs fixed', () => {
    for (const id of ['shorts', 'reels', 'tiktok'] as const) {
      expect(presetFor(id).video.codec).toBe('h264');
      expect(presetCodecs(presetFor(id))).toEqual(['h264', 'hevc']);
    }
    expect(presetCodecs(presetFor('device'))).toEqual(['h264']);
    expect(presetCodecs(presetFor('deviceAv1'))).toEqual(['av1']);
    expect(presetInCodec(presetFor('reels'), 'hevc')?.video.codec).toBe('hevc');
    expect(presetInCodec(presetFor('reels'), undefined)).toBe(presetFor('reels'));
    expect(presetInCodec(presetFor('device'), 'hevc')).toBeUndefined();
  });
});

describe('which codecs a machine encodes', () => {
  it('H.264 always; HEVC and AV1 only on a working hardware encoder, with the picker’s reason', () => {
    expect(codecAvailability('h264', {})).toEqual({ codec: 'h264', available: true });
    expect(codecAvailability('av1', { av1: 'av1_nvenc' })).toEqual({ codec: 'av1', available: true });
    expect(codecAvailability('av1', { hevc: 'hevc_videotoolbox' })).toEqual({
      codec: 'av1',
      available: false,
      reasonKey: 'render.unavailable.noAv1Encoder',
    });
    expect(presetCodecAvailability(presetFor('reels'), {})).toEqual([
      { codec: 'h264', available: true },
      { codec: 'hevc', available: false, reasonKey: 'render.unavailable.noHevcEncoder' },
    ]);
  });

  it('refuses an export in a codec the machine can’t encode before anything renders', async () => {
    expect((await checkExportCodec(NVIDIA, 'av1')).ok).toBe(true);
    const mac = await checkExportCodec(MAC, 'av1');
    expect(mac.ok ? null : mac.error.code).toBe('render.codec_unavailable');
    expect((await checkExportCodec(MAC, 'hevc')).ok).toBe(true);
    expect((await checkExportCodec(CPU, 'hevc')).ok).toBe(false);
    expect((await checkExportCodec(CPU, 'h264')).ok).toBe(true);
  });
});

describe('export options on three machines', () => {
  async function optionsOn(ctx: MediaContext) {
    const work = await tempDir('codec-options');
    const world = await fakeWorld(work.dir, { ctx });
    const timeline = makeTimeline({ items: [{ frames: 300 }] });
    world.timelines.set(timeline.id, timeline);
    const options = unwrap(
      await exportOptions(world.deps, { projectId: timeline.projectId, timelineId: timeline.id }),
    );
    await work.dispose();
    return (id: string) => options.presets.find((entry) => entry.preset.id === id)!;
  }

  it('the RTX 40 host: the AV1 presets and every HEVC choice are available, with no codec notes', async () => {
    const entry = await optionsOn(NVIDIA);
    for (const id of ['youtubeAv1', 'deviceAv1', 'reels', 'deviceHevc']) {
      expect(entry(id).available).toBe(true);
      expect(entry(id).codecs).toBeUndefined();
    }
  });

  it('a Mac: the AV1 presets dimmed with the reason; HEVC still offered', async () => {
    const entry = await optionsOn(MAC);
    for (const id of ['youtubeAv1', 'deviceAv1'])
      expect(entry(id)).toMatchObject({
        available: false,
        reasonKey: 'render.unavailable.noAv1Encoder',
        codecs: [{ codec: 'av1', available: false, reasonKey: 'render.unavailable.noAv1Encoder' }],
      });
    expect(entry('reels')).toMatchObject({ available: true });
    expect(entry('reels').codecs).toBeUndefined();
  });

  it('a CPU-only machine: Reels in H.264 only, HEVC and AV1 presets dimmed', async () => {
    const entry = await optionsOn(CPU);
    expect(entry('reels')).toMatchObject({
      available: true,
      codecs: [
        { codec: 'h264', available: true },
        { codec: 'hevc', available: false, reasonKey: 'render.unavailable.noHevcEncoder' },
      ],
    });
    expect(entry('deviceHevc')).toMatchObject({
      available: false,
      reasonKey: 'render.unavailable.noHevcEncoder',
    });
    expect(entry('deviceAv1')).toMatchObject({
      available: false,
      reasonKey: 'render.unavailable.noAv1Encoder',
    });
  });
});

describe('the request’s codec', () => {
  const timeline = makeTimeline({ items: [{ frames: 300 }] });
  const request = exportRequestSchema.parse({
    projectId: timeline.projectId,
    timelineId: timeline.id,
    presetId: 'reels',
    captions: { burnIn: true, sidecars: [] },
  });

  it('is one of the preset’s codecs, and HEVC is another file than H.264', () => {
    expect(resolveExportRequest({ ...request, codec: 'hevc' }, timeline).ok).toBe(true);
    const refused = resolveExportRequest({ ...request, codec: 'av1' }, timeline);
    expect(refused.ok ? null : refused.error.code).toBe('render.codec_unavailable');
    expect(exportRequestKey({ ...request, codec: 'hevc' })).not.toBe(exportRequestKey(request));
    // Naming the default codec is the same export as naming none.
    expect(exportRequestKey({ ...request, codec: 'h264' })).toBe(exportRequestKey(request));
  });

  it('is saved with the preset, dropped for a preset without it, and undone with it', async () => {
    const settings = createMemorySettingsStore();
    const clock = createManualClock(1_000);
    const commands = createRenderCommands({
      store: memoryRenderStore(),
      enqueuer: recordingEnqueuer(),
      timelines: memoryTimelines(timeline),
      settings,
      clock,
    });
    const bus = createCommandBus({ store: createMemoryAuditLogStore(), clock });
    bus.register(...commands.all);
    const projectId = timeline.projectId;
    const setting = exportSettingFor(projectId);
    unwrap(
      await bus.dispatch(commands.setExportPreset, { projectId, presetId: 'tiktok', codec: 'hevc' }, UI),
    );
    expect(unwrap(await settings.get(setting))).toMatchObject({ presetId: 'tiktok', codec: 'hevc' });
    expect(settingsCodec(unwrap(await settings.get(setting)))).toEqual({ codec: 'hevc' });
    // Another platform preset keeps the choice; a preset without HEVC drops it.
    unwrap(await bus.dispatch(commands.setExportPreset, { projectId, presetId: 'reels' }, UI));
    expect(unwrap(await settings.get(setting)).codec).toBe('hevc');
    unwrap(await bus.dispatch(commands.setExportPreset, { projectId, presetId: 'device' }, UI));
    expect(unwrap(await settings.get(setting)).codec).toBeUndefined();
    unwrap(await bus.undo(projectId, UI));
    expect(unwrap(await settings.get(setting))).toMatchObject({ presetId: 'reels', codec: 'hevc' });
    const refused = await bus.dispatch(
      commands.setExportPreset,
      { projectId, presetId: 'device', codec: 'av1' },
      UI,
    );
    expect(refused.ok ? null : refused.error.code).toBe('render.codec_unavailable');
  });
});
