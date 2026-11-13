// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { execFile } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

/** A trusted generated fixture through the independently packed CLI, including its final capture-mode report. */
export async function captureWithCli(input: {
  toolchain: string;
  dir: string;
  out: string;
  debugDir: string;
  chromePath: string;
  binaries: { readonly ffmpeg: string; readonly ffprobe: string };
}) {
  const cli = join(input.toolchain, 'hyperframes-cli');
  const { stdout, stderr } = await promisify(execFile)(
    join(input.toolchain, 'workspace-node/bin/node'),
    [
      '--require',
      join(cli, 'lib/taalcut-loopback.cjs'),
      join(cli, 'node_modules/hyperframes/bin/hyperframes.mjs'),
      'render',
      input.dir,
      '--output',
      input.out,
      '--fps',
      '30',
      '--quality',
      'high',
      '--gpu',
      '--browser-gpu',
      '--debug',
    ],
    {
      env: {
        ...process.env,
        HYPERFRAMES_BROWSER_PATH: input.chromePath,
        HYPERFRAMES_FFMPEG_PATH: input.binaries.ffmpeg,
        HYPERFRAMES_FFPROBE_PATH: input.binaries.ffprobe,
        HYPERFRAMES_NO_TELEMETRY: '1',
        HYPERFRAMES_NO_UPDATE_CHECK: '1',
        HYPERFRAMES_NO_AUTO_INSTALL: '1',
        HYPERFRAMES_NO_OPTIONAL_INSTALL: '1',
        DO_NOT_TRACK: '1',
        PRODUCER_RENDERS_DIR: join(input.debugDir, 'renders'),
      },
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      signal: AbortSignal.timeout(480_000),
    },
  );
  const debug = join(input.debugDir, '.debug');
  const jobs = await readdir(debug);
  if (jobs.length !== 1) throw new Error(`Expected one CLI render report, found ${jobs.length}`);
  const report = JSON.parse(await readFile(join(debug, jobs[0]!, 'perf-summary.json'), 'utf8')) as {
    drawElement?: { mode?: string };
  };
  return { captureMode: report.drawElement?.mode, lines: `${stdout}\n${stderr}`.split('\n') };
}
