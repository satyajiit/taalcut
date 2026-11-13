// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** IX3-K4: render's hardware paths on media's software retry; which failures move a job to its software route. */
import { err, ok, type ComputeFallbackEvent, type Result } from '@taalcut/core';
import { FfmpegFailed, MediaCancelled } from '@taalcut/media';
import { describe, expect, it } from 'vitest';
import { onHardwareRoute, type HardwareRoute } from '../../src/engine/hardware-route';
import { DECODER_REFUSED, ENCODER_REFUSED, NVENC_REFUSED } from '../support/refusing';

type Route = 'hardware' | 'software';
const failed = (line: string) =>
  err(FfmpegFailed({ exitCode: 1 }, { detail: `ffmpeg exited with code 1\n${line}` }));

async function runOn(answers: readonly Result<string>[], extra: Partial<HardwareRoute<Route>> = {}) {
  const routes: Route[] = [];
  const events: ComputeFallbackEvent[] = [];
  const result = await onHardwareRoute<Route, string>(
    {
      first: 'hardware',
      software: 'software',
      operation: 'render.test',
      wanted: ['videotoolbox'],
      label: 'VideoToolbox',
      anyFfmpegFailure: false,
      onFallback: (event) => events.push(event),
      ...extra,
    },
    async (route) => {
      routes.push(route);
      return answers[routes.length - 1] ?? ok('more runs than answers');
    },
  );
  return { result, routes, events };
}

describe('onHardwareRoute', () => {
  it('runs a refused decoder or encoder once more in software, reported through computeFallbackEvent', async () => {
    for (const [line, detail] of [
      [DECODER_REFUSED, 'the videotoolbox_vld decoder would not start (hwaccel initialisation)'],
      [ENCODER_REFUSED, 'the VideoToolbox encoder would not start (-12902)'],
    ] as const) {
      const { result, routes, events } = await runOn([failed(line), ok('done')]);
      expect(result).toEqual(ok('done'));
      expect(routes).toEqual(['hardware', 'software']);
      expect(events).toEqual([
        { operation: 'render.test', wanted: ['videotoolbox'], reason: 'accelerator_failed', detail },
      ]);
    }
  });

  it('names the hardware the route asked for: NVDEC and NVENC on an NVIDIA route (LNX1-RND)', async () => {
    const nvidia = { wanted: ['cuda', 'nvenc'] as const, label: 'NVDEC/NVENC' };
    const refused = await runOn([failed(NVENC_REFUSED), ok('done')], {
      ...nvidia,
      wanted: [...nvidia.wanted],
    });
    expect(refused.events).toEqual([
      {
        operation: 'render.test',
        wanted: ['cuda', 'nvenc'],
        reason: 'accelerator_failed',
        detail: 'the NVENC encoder would not start (incompatible client key (21): (no details))',
      },
    ]);
    const wide = await runOn([failed('[mov,mp4 @ 0x1] moov atom not found'), ok('done')], {
      wanted: ['cuda', 'nvenc'],
      label: nvidia.label,
      anyFfmpegFailure: true,
    });
    expect(wide.events[0]?.detail).toMatch(/^NVDEC\/NVENC failed: .*moov atom not found$/s);
  });

  it('retries any other FFmpeg failure only on a path that asks for it', async () => {
    const narrow = await runOn([failed('[mov,mp4 @ 0x1] moov atom not found')]);
    expect(narrow.routes).toEqual(['hardware']);
    expect(narrow.events).toEqual([]);
    const wide = await runOn([failed('[mov,mp4 @ 0x1] moov atom not found'), ok('done')], {
      anyFfmpegFailure: true,
    });
    expect(wide.routes).toEqual(['hardware', 'software']);
    expect(wide.events[0]?.detail).toMatch(/^VideoToolbox failed: .*moov atom not found$/s);
  });

  it('never retries a cancel, an aborted run, or a job with no software route', async () => {
    const cancelled = await runOn([err(MediaCancelled())], { anyFfmpegFailure: true });
    expect(cancelled.routes).toEqual(['hardware']);
    const controller = new AbortController();
    controller.abort();
    const aborted = await runOn([failed(DECODER_REFUSED)], { signal: controller.signal });
    expect(aborted.routes).toEqual(['hardware']);
    const hevc = await runOn([failed(ENCODER_REFUSED)], { software: undefined });
    expect(hevc.routes).toEqual(['hardware']);
    expect([cancelled, aborted, hevc].flatMap((run) => run.events)).toEqual([]);
  });
});
