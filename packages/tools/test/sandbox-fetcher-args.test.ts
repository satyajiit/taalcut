// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The reference fetcher's yt-dlp arguments: exactly the research note's flag set, one https link. */
import { mkdirSync, realpathSync, symlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { err, ok, UnknownError } from '@taalcut/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prepareRun, type SandboxPrograms } from '../src/sandbox/validate';
import { fetchArgs, tempRoot } from './helpers/sandbox';

let root: { root: string; cleanup: () => void };
let dir: string;
const programs: SandboxPrograms = {
  ffmpeg: '/bin/echo',
  ffprobe: '/bin/echo',
  ytDlp: async () =>
    ok({ binary: '/bin/echo', deno: '/bin/cat', ffmpegDir: '/bin', componentDirs: ['/usr/bin', '/usr/lib'] }),
};
beforeEach(() => {
  root = tempRoot();
  dir = join(root.root, 'exp');
  mkdirSync(dir);
});
afterEach(() => root.cleanup());
// The fetcher passes real paths. Where /bin links to /usr/bin (Ubuntu's merged /usr) they are under /usr/bin.
const real = (path: string) => realpathSync(path);

const fetch = (args: string[], extra: Partial<SandboxPrograms> = {}) =>
  prepareRun(
    { program: 'ytDlp', args, network: 'outbound' },
    { dir, programs: { ...programs, ...extra }, threads: 4 },
  );

describe('yt-dlp arguments', () => {
  it('allows only the fixed long-source duration/live filter', async () => {
    const args = fetchArgs();
    args.splice(0, 0, '--match-filters', 'duration <= 14400 & !is_live');
    expect((await fetch(args)).ok).toBe(true);
    for (const value of ['duration <= 999999', '!is_live', '-', 'duration <= 14400 | is_live']) {
      args[1] = value;
      expect((await fetch(args)).ok).toBe(false);
    }
  });
  it('puts in the bundled Deno and FFmpeg and the experiment path', async () => {
    const result = await fetch(fetchArgs());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const args = result.value.args;
    expect(args[args.indexOf('--js-runtimes') + 1]).toBe(`deno:${real('/bin/cat')}`);
    expect(args[args.indexOf('--ffmpeg-location') + 1]).toBe(real('/bin'));
    expect(args[args.indexOf('-o') + 1]).toBe(join(dir, 'reference.%(ext)s'));
    expect(args.slice(-2)).toEqual(['--', 'https://www.youtube.com/shorts/abc']);
    expect(result.value.profile).toBe('fetcher');
    expect(result.value.fetcher?.componentDirs).toEqual(['/usr/bin', '/usr/lib']);
  });

  it('refuses anything else: cookies, updates, exec, plugins, configs, remote components', async () => {
    for (const extra of [
      ['--cookies-from-browser', 'safari'],
      ['-U'],
      ['--exec', 'rm -rf ~'],
      ['--plugin-dirs', '/tmp'],
      ['--config-locations', '/tmp/c'],
      ['--remote-components', 'ejs:npm'],
      ['--write-info-json'],
    ]) {
      const args = fetchArgs();
      args.splice(0, 0, ...extra);
      const result = await fetch(args);
      expect(!result.ok && result.error.params).toEqual({ index: 0, reason: 'option not allowed' });
    }
  });

  it('takes only the literal runtime names, so the caller cannot pick binaries', async () => {
    const args = fetchArgs();
    args[args.indexOf('--js-runtimes') + 1] = 'node:/usr/local/bin/node';
    expect((await fetch(args)).ok).toBe(false);
    const ff = fetchArgs();
    ff[ff.indexOf('--ffmpeg-location') + 1] = '/opt/homebrew/bin';
    expect((await fetch(ff)).ok).toBe(false);
  });

  it('needs exactly one https link, last, and the required flags', async () => {
    for (const url of [
      'http://youtu.be/x',
      'https://user:pass@youtu.be/x',
      'file:///etc/passwd',
      'not a url',
    ]) {
      const result = await fetch(fetchArgs(url));
      expect(!result.ok && result.error.params).toEqual({ index: 33, reason: 'link must be https' });
    }
    const two = [...fetchArgs(), 'https://youtu.be/y'];
    expect((await fetch(two)).ok).toBe(false);
    const noLink = fetchArgs().slice(0, -2);
    expect(!(await fetch(noLink)).ok).toBe(true);
    const noIgnore = fetchArgs().slice(1);
    const missing = await fetch(noIgnore);
    expect(!missing.ok && missing.error.params?.reason).toBe('missing --ignore-config');
    const outside = fetchArgs();
    outside[outside.indexOf('-o') + 1] = 'scratch:../x.%(ext)s';
    expect(!(await fetch(outside)).ok).toBe(true);
    const badValue = fetchArgs();
    badValue[badValue.indexOf('--retries') + 1] = '999';
    expect(!(await fetch(badValue)).ok).toBe(true);
  });

  it('follows a symlinked ffmpeg pair to the real directory', async () => {
    const linked = join(root.root, 'linked-ffmpeg');
    mkdirSync(linked);
    symlinkSync('/bin/echo', join(linked, 'ffmpeg'));
    symlinkSync('/bin/echo', join(linked, 'ffprobe'));
    const result = await fetch(fetchArgs(), {
      ytDlp: async () =>
        ok({ binary: '/bin/echo', deno: '/bin/cat', ffmpegDir: linked, componentDirs: ['/usr/bin'] }),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.args[result.value.args.indexOf('--ffmpeg-location') + 1]).toBe(
      dirname(real('/bin/echo')),
    );
    expect(result.value.fetcher?.ffmpegDir).toBe(dirname(real('/bin/echo')));
  });

  it('is unavailable when the components are not there', async () => {
    const failing = await fetch(fetchArgs(), { ytDlp: async () => err(UnknownError()) });
    expect(!failing.ok && failing.error.code).toBe('core.unknown');
    const missing = await fetch(fetchArgs(), {
      ytDlp: async () =>
        ok({ binary: '/nowhere/yt-dlp', deno: '/bin/cat', ffmpegDir: '/bin', componentDirs: [] }),
    });
    expect(!missing.ok && missing.error.code).toBe('sandbox.unavailable');
    const noDeno = await fetch(fetchArgs(), {
      ytDlp: async () =>
        ok({ binary: '/bin/echo', deno: '/nowhere/deno', ffmpegDir: '/bin', componentDirs: [] }),
    });
    expect(!noDeno.ok && noDeno.error.code).toBe('sandbox.unavailable');
    const noDir = await fetch(fetchArgs(), {
      ytDlp: async () =>
        ok({ binary: '/bin/echo', deno: '/bin/cat', ffmpegDir: '/nowhere', componentDirs: [] }),
    });
    expect(!noDir.ok && noDir.error.code).toBe('sandbox.unavailable');
    const noComponent = await fetch(fetchArgs(), {
      ytDlp: async () =>
        ok({ binary: '/bin/echo', deno: '/bin/cat', ffmpegDir: '/bin', componentDirs: ['/nowhere'] }),
    });
    expect(!noComponent.ok && noComponent.error.code).toBe('sandbox.unavailable');
  });
});
