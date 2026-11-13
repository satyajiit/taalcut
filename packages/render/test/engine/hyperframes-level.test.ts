// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, it } from 'vitest';

const producerDir = realpathSync(
  join(import.meta.dirname, '..', '..', 'node_modules', '@hyperframes', 'producer'),
);
const engineDir = realpathSync(join(producerDir, '..', 'engine'));
interface Options {
  width: number;
  height: number;
  fps: { num: number; den: number };
  codec: 'h264' | 'h265';
  useGpu: boolean;
}
interface ChunkModule {
  buildEncoderArgs(options: Options, input: string[], output: string, encoder: string): string[];
}
interface StreamingModule {
  buildStreamingArgs(options: Options, output: string, encoder: string): string[];
}
const chunk = (await import(
  pathToFileURL(join(engineDir, 'dist/services/chunkEncoder.js')).href
)) as ChunkModule;
const streaming = (await import(
  pathToFileURL(join(engineDir, 'dist/services/streamingEncoder.js')).href
)) as StreamingModule;

for (const [name, build] of [
  ['chunk', (options: Options, encoder: string) => chunk.buildEncoderArgs(options, [], 'out.mp4', encoder)],
  [
    'streaming',
    (options: Options, encoder: string) => streaming.buildStreamingArgs(options, 'out.mp4', encoder),
  ],
] as const) {
  it(`${name} requests a compliant native VideoToolbox level for high-resolution 60 fps only`, () => {
    const base: Options = {
      width: 3840,
      height: 2160,
      fps: { num: 60, den: 1 },
      codec: 'h264',
      useGpu: true,
    };
    for (const [width, height] of [
      [3840, 2160],
      [2160, 3840],
      [2160, 2160],
      [2160, 2700],
    ] as const)
      expect(build({ ...base, width, height }, 'videotoolbox').join(' ')).toContain('-profile:v high -level:v 5.2');
    for (const options of [
      { ...base, width: 1920, height: 1080 },
      { ...base, fps: { num: 30, den: 1 } },
      { ...base, fps: { num: 120, den: 1 } },
      { ...base, width: 7680, height: 4320 },
      { ...base, codec: 'h265' as const },
    ])
      expect(build(options, 'videotoolbox')).not.toContain('-level:v');
    expect(build(base, 'nvenc')).not.toContain('-level:v');
  });
}
