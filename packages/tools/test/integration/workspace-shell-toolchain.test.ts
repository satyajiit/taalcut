// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The toolchain components under workspace.sb (AGT2 sbx), opt-in: TAALCUT_SHELL_TOOLCHAIN_DIR names a folder with
 * workspace-node/, workspace-python/ and hyperframes-cli/ unpacked from their archives (tools/components/workspace
 * pack.mjs or dev-release.mjs), so no test downloads anything. With the repo's FFmpeg and a chrome-headless-shell,
 * the HyperFrames CLI renders a composition in the shell: Chrome over a pipe, no network, no loopback.
 */
import { existsSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SHELL_DIRS, type ShellToolchain } from '../../src/shell/folder';
import { assembleToolchain } from '../../src/shell/toolchain';
import { findFfmpeg, skipMessage } from '../helpers/sandbox';
import { confined, findHeadlessShell, shellFolder, shellSkipReason } from '../helpers/shell';

const dir = process.env.TAALCUT_SHELL_TOOLCHAIN_DIR;
const parts = ['workspace-node', 'workspace-python', 'hyperframes-cli'] as const;
const skip =
  shellSkipReason() ||
  (!dir
    ? 'TAALCUT_SHELL_TOOLCHAIN_DIR is not set'
    : parts.some((part) => !existsSync(join(dir, part)))
      ? `TAALCUT_SHELL_TOOLCHAIN_DIR lacks one of ${parts.join(', ')}`
      : '');
skipMessage('workspace shell toolchain', skip);

function toolchain(): ShellToolchain {
  const root = realpathSync(dir!);
  const ffmpeg = findFfmpeg();
  const shell = findHeadlessShell();
  return assembleToolchain({
    components: {
      node: { path: join(root, 'workspace-node'), version: '24.22.2' },
      python: { path: join(root, 'workspace-python'), version: '3.14.9-1' },
      hyperframes: { path: join(root, 'hyperframes-cli'), version: '0.8.209-1' },
    },
    ...('dir' in ffmpeg ? { ffmpegDir: ffmpeg.dir } : {}),
    ...(shell ? { headlessShell: join(shell, 'chrome-headless-shell') } : {}),
  });
}

let shell: Awaited<ReturnType<typeof shellFolder>>;
beforeEach(async () => {
  shell = await shellFolder();
});
afterEach(() => shell.cleanup());

describe.skipIf(skip !== '')('the toolchain, confined', { timeout: 180_000 }, () => {
  it("runs the components' Node and Python, with NumPy and Pillow, offline", async () => {
    const script = [
      'import numpy, PIL.Image',
      'a = numpy.zeros((90, 160, 3), numpy.uint8)',
      'a[:, :80] = (255, 128, 0)',
      "PIL.Image.fromarray(a).save('../out/half.png')",
      "b = numpy.asarray(PIL.Image.open('../out/half.png'))",
      'print(numpy.__version__, PIL.__version__, int(b[0, 0, 0]), int(b[0, 100, 0]))',
    ].join('\n');
    writeFileSync(join(shell.folder, SHELL_DIRS.work, 'probe.py'), script);
    const result = await confined(shell.folder, 'node --version && python3 probe.py', {
      toolchain: toolchain(),
    });
    expect(result.ok && result.value.stderr).toBe('');
    expect(result.ok && result.value.stdout.trim().split('\n')).toEqual(['v24.22.2', '2.5.4 13.0.0 255 0']);
    expect(existsSync(join(shell.folder, SHELL_DIRS.out, 'half.png'))).toBe(true);
  });

  it('keeps the toolchain read-only and its Python offline', async () => {
    const root = realpathSync(dir!);
    const result = await confined(
      shell.folder,
      [
        `touch ${join(root, 'workspace-python', 'python', 'x')} 2>/dev/null && echo wrote || echo refused`,
        'python3 -c "import socket; socket.create_connection((\'1.1.1.1\', 443), timeout=3)" 2>/dev/null && echo online || echo offline',
      ].join('; '),
      { toolchain: toolchain() },
    );
    expect(result.ok && result.value.stdout.trim().split('\n')).toEqual(['refused', 'offline']);
  });

  // The LGPL build has no libx264; the CLI renders frames and FFmpeg uses Apple's software H.264 encoder.
  it.skipIf(!findHeadlessShell() || 'skip' in findFfmpeg())(
    'renders a composition with the HyperFrames CLI, Chrome and FFmpeg inside the profile',
    async () => {
      const html = [
        '<!doctype html><html><head><meta charset="UTF-8"></head><body style="margin:0">',
        '<div id="root" data-composition-id="probe" data-width="320" data-height="180" data-duration="1" data-start="0"',
        ' style="position:relative;width:320px;height:180px;background:#2a6;color:#fff;font:48px sans-serif">Taalcut</div>',
        '</body></html>',
      ].join('');
      writeFileSync(join(shell.folder, SHELL_DIRS.work, 'index.html'), html);
      const result = await confined(
        shell.folder,
        [
          'hyperframes render . --format png-sequence --output ../out/frames --fps 10 --workers 1 --no-browser-gpu',
          "ffmpeg -hide_banner -loglevel error -framerate 10 -pattern_type glob -i '../out/frames/*.png' -c:v h264_videotoolbox -require_sw 1 -b:v 512k -pix_fmt yuv420p ../out/probe.mp4",
          'ls ../out/frames | wc -l',
        ].join(' && '),
        { toolchain: toolchain(), limits: { wallMs: 170_000 } },
      );
      expect(
        result.ok && { code: result.value.exitCode, stopped: result.value.stopped },
        readOutput(result),
      ).toEqual({ code: 0, stopped: null });
      expect(result.ok && Number(result.value.stdout.trim().split('\n').pop())).toBeGreaterThanOrEqual(10);
      const out = join(shell.folder, SHELL_DIRS.out, 'probe.mp4');
      expect(statSync(out).size).toBeGreaterThan(1000);
      expect(readFileSync(out).subarray(4, 8).toString('latin1')).toBe('ftyp');
    },
  );
});

function readOutput(result: Awaited<ReturnType<typeof confined>>): string {
  return result.ok ? `${result.value.stdout}\n${result.value.stderr}` : result.error.code;
}
