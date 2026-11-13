// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The indexing e2e's check for a stuck FFmpeg under the app before it closes it (e2e/indexing-stalls.ts), on
 * canned `ps` output: only FFmpeg processes in the app's tree, old enough, that gained no CPU time count.
 */
import { describe, expect, it } from 'vitest';
import { descendants, parsePsLines, psSeconds, stuckOf } from '../e2e/indexing-stalls';

const ps = (cpu: { encoder: string; young: string; helper: string }) =>
  [
    '  100     1  12:00   0:30.00 /Applications/Electron.app/Contents/MacOS/Electron --user-data-dir=/x',
    `  200   100  11:58   1:00.00 Electron Helper --type=utility --utility-sub-type=jobs`,
    `  300   200  09:40   ${cpu.encoder} /repo/tools/ffmpeg/dist/ffmpeg -hide_banner -i in.mov -c:v hevc_videotoolbox out.mov`,
    `  301   200  00:20   ${cpu.young} /repo/tools/ffmpeg/dist/ffmpeg -i b.mov -f null -`,
    `  302   200  05:00   ${cpu.helper} /repo/native/mac-helper/dist/taalcut-mac-helper`,
    '  400     1  01:00:00   0:05.00 /repo/tools/ffmpeg/dist/ffmpeg -i other-lane.mov out.mp4',
  ].join('\n');

describe('indexing-stalls', () => {
  it('reads ps times and lines', () => {
    expect(psSeconds('09:40')).toBe(580);
    expect(psSeconds('1-02:03:04')).toBe(86_400 + 7384);
    expect(psSeconds('0:30.50')).toBe(30.5);
    expect(parsePsLines(ps({ encoder: '0:01.00', young: '0:00.10', helper: '0:00.20' }))[2]).toMatchObject({
      pid: 300,
      ppid: 200,
      ageS: 580,
      cpuS: 1,
    });
  });

  it("walks the app's tree only", () => {
    const lines = parsePsLines(ps({ encoder: '0:01.00', young: '0:00.10', helper: '0:00.20' }));
    expect(descendants(lines, 100).map((line) => line.pid)).toEqual([200, 300, 301, 302]);
  });

  it('calls an old FFmpeg with no CPU gained stuck, not a young one, the idle helper or a busy one', () => {
    const before = parsePsLines(ps({ encoder: '0:01.00', young: '0:00.10', helper: '0:00.20' }));
    const quiet = parsePsLines(ps({ encoder: '0:01.00', young: '0:00.10', helper: '0:00.20' }));
    expect(stuckOf(before, quiet, 100).map((line) => line.pid)).toEqual([300]);
    const busy = parsePsLines(ps({ encoder: '0:03.50', young: '0:00.10', helper: '0:00.20' }));
    expect(stuckOf(before, busy, 100)).toEqual([]);
  });
});
