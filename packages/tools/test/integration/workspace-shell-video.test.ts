// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SHELL_DIRS } from '../../src/shell/folder';
import { findFfmpeg, skipMessage } from '../helpers/sandbox';
import { confined, shellFolder, shellSkipReason } from '../helpers/shell';

const ffmpeg = findFfmpeg();
const skip = shellSkipReason() || ('skip' in ffmpeg ? ffmpeg.skip : '');
skipMessage('workspace shell software video encoding', skip);

let shell: Awaited<ReturnType<typeof shellFolder>>;
beforeEach(async () => {
  shell = await shellFolder();
});
afterEach(() => shell.cleanup());

describe.skipIf(skip !== '')('workspace shell software video encoding', () => {
  it('encodes an H.264 MP4 through Apple software VideoToolbox inside the profile', async () => {
    if ('skip' in ffmpeg) throw new Error(ffmpeg.skip);
    const result = await confined(
      shell.folder,
      [
        'ffmpeg -hide_banner -loglevel error -f lavfi -i color=c=red:s=320x180:r=10:d=1',
        '-c:v h264_videotoolbox -require_sw 1 -b:v 512k -pix_fmt yuv420p ../out/probe.mp4',
        '&& ffprobe -v error -show_entries stream=codec_name,width,height,nb_frames -of json ../out/probe.mp4',
      ].join(' '),
      {
        toolchain: { roots: [ffmpeg.dir], bin: [ffmpeg.dir], env: {}, programs: [] },
      },
    );
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;
    expect({ exitCode: result.value.exitCode, stopped: result.value.stopped }, result.value.stderr).toEqual({
      exitCode: 0,
      stopped: null,
    });
    expect(JSON.parse(result.value.stdout)).toMatchObject({
      streams: [{ codec_name: 'h264', width: 320, height: 180, nb_frames: '10' }],
    });
    const output = join(shell.folder, SHELL_DIRS.out, 'probe.mp4');
    expect(statSync(output).size).toBeGreaterThan(1000);
    expect(readFileSync(output).subarray(4, 8).toString('latin1')).toBe('ftyp');
  }, 90_000);
});
