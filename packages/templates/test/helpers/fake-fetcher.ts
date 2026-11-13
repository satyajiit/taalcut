// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** A stand-in for yt-dlp in the sandbox: "downloads" a local reel into the experiment and prints like yt-dlp. */
import { copyFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ok } from '@taalcut/core';
import type { FakeRun } from './dir-sandbox';

export interface FakeFetchOptions {
  readonly exitCode?: number;
  readonly stderr?: string;
  /** The --print sound line; default a credited track. */
  readonly sound?: string;
  /** REF1: Instagram's "login required" unless yt-dlp is given a cookie file (a reel only a session gets). */
  readonly loginUnlessCookies?: boolean;
  /** The cookie file's text as yt-dlp found it, one entry per run given `--cookies`. */
  readonly cookiesSeen?: string[];
  /** The link each run was given (after `--`). */
  readonly linksSeen?: string[];
}

/** yt-dlp's words for an Instagram reel it can't get without an account. */
export const INSTAGRAM_LOGIN_ERROR =
  'ERROR: [Instagram] EXAMPLE123: Requested content is not available, rate-limit reached or login required. ' +
  'Use --cookies, --cookies-from-browser, --username and --password, --netrc-cmd, or --netrc (instagram) to ' +
  'provide account credentials';

export function fakeYtDlp(reel: string | null, options: FakeFetchOptions = {}): FakeRun {
  return async (experiment, request, { onOutputLine }) => {
    if (request.program !== 'ytDlp')
      return ok({ exitCode: 2, stdout: '', stderrTail: 'not yt-dlp', durationMs: 1, written: [] });
    options.linksSeen?.push(request.args[request.args.indexOf('--') + 1] ?? '<none>');
    const cookies = request.args.indexOf('--cookies');
    if (cookies >= 0) {
      const file = request.args[cookies + 1]?.replace(/^scratch:/, '') ?? '';
      options.cookiesSeen?.push(await readFile(join(experiment.dir, file), 'utf8').catch(() => '<missing>'));
    } else if (options.loginUnlessCookies)
      return ok({ exitCode: 1, stdout: '', stderrTail: INSTAGRAM_LOGIN_ERROR, durationMs: 5, written: [] });
    const exitCode = options.exitCode ?? 0;
    onOutputLine?.(
      'stdout',
      '{"status":"downloading","downloaded":500,"total":1000,"totalEstimate":null,"eta":1}',
    );
    // 101: yt-dlp stopped at --max-downloads 1 after downloading the one file.
    if ((exitCode !== 0 && exitCode !== 101) || reel === null)
      return ok({
        exitCode: exitCode || 1,
        stdout: '',
        stderrTail: options.stderr ?? 'ERROR: [youtube] abc: Video unavailable',
        durationMs: 5,
        written: [],
      });
    const file = join(experiment.dir, 'reference.mp4');
    await copyFile(reel, file);
    const sound = options.sound ?? '{"track": "Golden Hour", "artist": "Some Band"}';
    return ok({
      exitCode,
      stdout: `${file}\n${sound}\n`,
      stderrTail: '',
      durationMs: 20,
      written: [{ path: 'reference.mp4', bytes: 1 }],
    });
  };
}
