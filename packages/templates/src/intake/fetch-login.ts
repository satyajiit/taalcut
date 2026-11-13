// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Anonymous first (REF1, the owner's decision of 2026-10-29): a public reel is fetched without any account. Only
 * when yt-dlp says an Instagram reel needs a login (login required, a rate limit, private, not available) is it
 * tried once more with the person's session, as a Netscape cookie file in the experiment, and only when they are
 * signed in. The file is removed as soon as yt-dlp is done with it.
 */
import { rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AsyncResult, TemplateMediaSource } from '@taalcut/core';

export const INSTAGRAM_COOKIES_FILE = 'ig-cookies.txt';

/** How a fetch got its reel: without an account, or with the person's Instagram session. */
export type FetchSource = Exclude<TemplateMediaSource, 'file'>;

/**
 * yt-dlp's words when Instagram wants a login: "Requested content is not available, rate-limit reached or login
 * required. Use --cookies…", "Main webpage is locked behind the login page", "Instagram sent an empty media
 * response", a private account, an age gate.
 */
const NEEDS_LOGIN =
  /login required|log ?in\b|logged[ -]?in|rate[- ]?limit|--cookies|private|(?:content|post|reel|video|media)\b[^.]{0,30}(?:isn['’]t|is not|not) available|empty media response|registered users|18 years/i;

/** Whether yt-dlp's errors (its `ERROR:` lines; warnings don't count) say the reel needs a login. */
export function needsLogin(stderr: string): boolean {
  return stderr
    .split('\n')
    .filter((line) => line.startsWith('ERROR:'))
    .some((line) => NEEDS_LOGIN.test(line));
}

/** yt-dlp's last warning or error, for a failure's detail (developers only). */
export function lastWarning(stderr: string): string {
  const lines = stderr.split('\n').filter((line) => /^(WARNING|ERROR):/.test(line));
  return lines.at(-1)?.slice(0, 300) ?? '';
}

/**
 * The session's cookie file in the experiment, for the second try. Given `cookies` (the session, read in this
 * process), it is written now and owned by the caller, who removes it; without, a file the agent's tool wrote
 * before the job counts (the jobs process has no session). Null: not signed in.
 */
export async function sessionCookieFile(
  dir: string,
  cookies: (() => AsyncResult<string | null>) | undefined,
): Promise<{ readonly path: string; readonly owned: boolean } | null> {
  const path = join(dir, INSTAGRAM_COOKIES_FILE);
  if (cookies) {
    const read = await cookies();
    if (!read.ok || !read.value) return null;
    await writeFile(path, read.value, { encoding: 'utf8', mode: 0o600 });
    return { path, owned: true };
  }
  const existing = await stat(path).catch(() => null);
  return existing?.isFile() ? { path, owned: false } : null;
}

/** Removes a cookie file; a file already gone is fine. */
export async function removeCookieFile(path: string): Promise<void> {
  await rm(path, { force: true }).catch(() => undefined);
}
