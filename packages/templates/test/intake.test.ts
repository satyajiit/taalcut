// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P2-T3 without FFmpeg: link checks, yt-dlp's arguments and progress, the
 * component installing once, and a failed fetch leaving nothing in scratch.
 * REF1: no acknowledgement is asked, and a fetch goes without an account
 * first, the Instagram session only for a reel that needs a login.
 */
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { newId, toolModuleProblems } from '@taalcut/core';
import {
  needsLogin,
  parseFetchProgress,
  parseReferenceLink,
  REFERENCE_FETCHER_COMPONENT,
  referenceFetchArgs,
} from '../src/index';
import { fakeYtDlp, INSTAGRAM_LOGIN_ERROR } from './helpers/fake-fetcher';
import { setupTools, type ToolSetup } from './helpers/tool-setup';

const SHORT = 'https://www.youtube.com/shorts/abcDEF12345';
const REEL = 'https://www.instagram.com/reel/EXAMPLE123/';
const COOKIES = '# Netscape HTTP Cookie File\n.instagram.com\tTRUE\t/\tTRUE\t0\tsessionid\tEXAMPLE\n';
const cookieArgs = (setup: ToolSetup) => setup.sandbox.runs.map((run) => run.args.includes('--cookies'));
let setup: ToolSetup | undefined;
afterEach(() => setup?.cleanup());

describe('reference links', () => {
  it.each([
    [SHORT, 'shorts'],
    ['https://youtu.be/abcDEF12345', 'shorts'],
    ['https://www.instagram.com/reel/C1x2y3z4/', 'reels'],
    ['https://vm.tiktok.com/ZMabc123/', 'tiktok'],
    ['https://www.tiktok.com/@someone/video/7300000000000000000', 'tiktok'],
    ['https://www.youtube.com/watch?v=abcDEF12345', 'other'],
  ])('accepts %s as %s', (url, platform) => {
    const link = parseReferenceLink(`  ${url}#t=3 `);
    expect(link.ok && link.value).toEqual({ url, platform });
  });

  // REF1 (gate finding 8): made-up ids and tokens in each platform's share-link shape.
  it.each([
    [
      'https://www.instagram.com/reel/EXAMPLE123/?utm_source=ig_web_copy_link&igsh=ZmFrZXRva2Vu&rpxt=FAKE&srtk=FAKE',
      'https://www.instagram.com/reel/EXAMPLE123/',
    ],
    ['https://instagram.com/reels/EXAMPLE123?igsh=ZmFrZQ==', 'https://www.instagram.com/reel/EXAMPLE123/'],
    [
      'https://www.instagram.com/some.creator/reel/EXAMPLE123/?igsh=ZmFrZQ',
      'https://www.instagram.com/reel/EXAMPLE123/',
    ],
    [
      'https://www.instagram.com/p/EXAMPLE123/?img_index=1&utm_medium=share',
      'https://www.instagram.com/p/EXAMPLE123/',
    ],
    [
      'https://www.instagram.com/share/reel/FAKESHARE1/?igsh=ZmFrZQ',
      'https://www.instagram.com/share/reel/FAKESHARE1/',
    ],
    [
      'https://www.youtube.com/shorts/EXAMPLE1234?si=FAKEtoken123&feature=share',
      'https://www.youtube.com/shorts/EXAMPLE1234',
    ],
    ['https://youtu.be/EXAMPLE1234?si=FAKEtoken123&t=4', 'https://youtu.be/EXAMPLE1234'],
    [
      'https://www.youtube.com/watch?pp=FAKEpp&v=EXAMPLE1234&list=FAKELIST&si=FAKE&feature=youtu.be',
      'https://www.youtube.com/watch?v=EXAMPLE1234',
    ],
    [
      'https://www.tiktok.com/@someone/video/7300000000000000000?_r=1&_t=FAKE&is_from_webapp=1&sender_device=pc&web_id=1',
      'https://www.tiktok.com/@someone/video/7300000000000000000',
    ],
    ['https://vm.tiktok.com/ZMFAKE123/?_r=1&_t=FAKE', 'https://vm.tiktok.com/ZMFAKE123/'],
  ])('keeps only what identifies the video of %s', (shared, kept) => {
    const link = parseReferenceLink(shared);
    expect(link.ok && link.value.url).toBe(kept);
    // Cleaning is stable: the kept link parses to itself.
    const again = parseReferenceLink(kept);
    expect(again.ok && again.value.url).toBe(kept);
  });

  it.each([
    'http://www.youtube.com/shorts/abc',
    'https://user:pass@www.instagram.com/reel/abc/',
    'https://www.tiktok.com:8443/@a/video/1',
    'https://example.com/reel.mp4',
    'file:///Users/me/reel.mp4',
    'not a link',
    '',
    `https://www.tiktok.com/${'a'.repeat(2100)}`,
  ])('refuses %s, without the link in params', (url) => {
    const link = parseReferenceLink(url);
    expect(link.ok).toBe(false);
    if (!link.ok) {
      expect(link.error.code).toBe('templates.unsupported_link');
      expect(JSON.stringify(link.error.params ?? {})).not.toContain('pass');
    }
  });
});

describe('yt-dlp arguments and progress', () => {
  it('asks for one short at most 720p into the experiment, the link after --', () => {
    const args = referenceFetchArgs(SHORT);
    expect(args.slice(-2)).toEqual(['--', SHORT]);
    expect(args).toContain('scratch:reference.%(ext)s');
    // BRK1: 720p either way up. A short is 720x1280, so a height cap of 720 took its 360p (360x640).
    const format = args[args.indexOf('-f') + 1];
    expect(format).toBe('bv*[height<=1280][width<=1280]+ba/b[height<=1280][width<=1280]/wv*+ba/w');
    expect(args).toEqual(expect.arrayContaining(['--ignore-config', '--no-playlist', '--no-update']));
  });

  it('reads progress lines and ignores the rest', () => {
    const line = '{"status":"downloading","downloaded":250,"total":1000,"totalEstimate":null,"eta":3}';
    expect(parseFetchProgress(line)).toMatchObject({ fraction: 0.25, etaMs: 3000 });
    expect(parseFetchProgress('[youtube] abc: Downloading webpage')).toBeNull();
  });
});

describe('templates.fetchReference', () => {
  it('declares a valid tool module', () => {
    setup = setupTools();
    expect(toolModuleProblems(setup.module)).toEqual([]);
    expect(setup.module.tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(['templates.planFromFormat', 'templates.referenceStatus', 'templates.finalise']),
    );
  });

  it('refuses an unsupported link before opening anything', async () => {
    setup = setupTools();
    const result = await setup.call('templates.fetchReference', {
      projectId: setup.projectA,
      url: 'https://example.com/a.mp4',
    });
    expect(!result.ok && result.error.code).toBe('templates.unsupported_link');
    expect(setup.sandbox.openIds()).toEqual([]);
  });

  it('fetches at once: no acknowledgement asked, no account sent', async () => {
    setup = setupTools({ run: fakeYtDlp(null), instagramCookies: COOKIES });
    const result = await setup.call('templates.fetchReference', { projectId: setup.projectA, url: REEL });
    expect(!result.ok && result.error.code).toBe('templates.fetch_failed');
    expect(setup.installs).toEqual([REFERENCE_FETCHER_COMPONENT]);
    // "Video unavailable" is no login problem: the session is never tried.
    expect(cookieArgs(setup)).toEqual([false]);
  });

  it('installs the fetcher on the first link only, and a failed fetch leaves no experiment', async () => {
    setup = setupTools({ run: fakeYtDlp(null, { exitCode: 1 }) });
    for (const attempt of [1, 2]) {
      const result = await setup.call('templates.fetchReference', { projectId: setup.projectA, url: SHORT });
      expect(!result.ok && result.error.code, `attempt ${attempt}`).toBe('templates.fetch_failed');
      expect(!result.ok && result.error.detail).toContain('Video unavailable');
    }
    expect(setup.installs).toEqual([REFERENCE_FETCHER_COMPONENT]);
    expect(setup.sandbox.runs.map((run) => [run.program, run.network])).toEqual([
      ['ytDlp', 'outbound'],
      ['ytDlp', 'outbound'],
    ]);
    expect(existsSync(setup.sandbox.root) ? readdirSync(setup.sandbox.root) : []).toEqual([]);
  });

  it('says the fetcher is unavailable when the component will not install', async () => {
    setup = setupTools({ run: fakeYtDlp(null), installFails: true });
    const result = await setup.call('templates.fetchReference', { projectId: setup.projectA, url: SHORT });
    expect(!result.ok && result.error.code).toBe('templates.fetch_unavailable');
    expect(setup.sandbox.runs).toEqual([]);
    expect(setup.sandbox.openIds()).toEqual([]);
  });
});

describe('templates.breakdown, abandonBreakdown and referenceStatus', () => {
  it('reports an experiment that is gone', async () => {
    setup = setupTools();
    const result = await setup.call('templates.breakdown', {
      projectId: setup.projectA,
      experimentId: newId(),
    });
    expect(!result.ok && result.error.code).toBe('templates.experiment_gone');
  });

  it('wants exactly one of experimentId and path', async () => {
    setup = setupTools();
    const result = await setup.call('templates.breakdown', { projectId: setup.projectA });
    expect(!result.ok && result.error.code).toBe('core.validation');
  });

  it('abandoning an unknown breakdown frees nothing and says discarded', async () => {
    setup = setupTools();
    const id = newId();
    expect(await setup.value('templates.abandonBreakdown', { breakdownId: id })).toEqual({ freedBytes: 0 });
    expect(await setup.value('templates.referenceStatus', { breakdownId: id })).toEqual({
      status: 'discarded',
    });
  });
});

describe('anonymous first, the session only when a login is needed (REF1)', () => {
  it("reads yt-dlp's errors that need a login, and nothing else", () => {
    for (const line of [
      INSTAGRAM_LOGIN_ERROR,
      'ERROR: [Instagram] EXAMPLE123: Main webpage is locked behind the login page. Unable to extract data',
      // yt-dlp 2026.08.19's answer, without an account, for a reel Instagram won't show (a made-up link).
      'ERROR: [Instagram] EXAMPLE123: Instagram sent an empty media response. Check if this post is accessible in ' +
        'your browser without being logged-in. If it is not, then use --cookies-from-browser or --cookies for the ' +
        'authentication.',
      'ERROR: [Instagram] EXAMPLE123: This content isn’t available right now',
      'ERROR: [Instagram] EXAMPLE123: This account is private',
    ])
      expect(needsLogin(`WARNING: slow\n${line}`), line).toBe(true);
    for (const line of [
      'ERROR: [youtube] abc: Video unavailable',
      'ERROR: [Instagram] EXAMPLE123: Requested format is not available. Use --list-formats for a list',
      'WARNING: [Instagram] EXAMPLE123: login required',
      'ERROR: unable to download video data: HTTP Error 404: Not Found',
    ])
      expect(needsLogin(line), line).toBe(false);
  });

  it('asks for the Instagram sign-in when a reel needs a login and no one is signed in', async () => {
    setup = setupTools({ run: fakeYtDlp(null, { loginUnlessCookies: true }) });
    const result = await setup.call('templates.fetchReference', { projectId: setup.projectA, url: REEL });
    expect(!result.ok && result.error.code).toBe('templates.instagram_auth_required');
    expect(cookieArgs(setup)).toEqual([false]);
    expect(setup.sandbox.openIds().filter((id) => existsSync(join(setup!.sandbox.root, id)))).toEqual([]);
  });

  it('tries once more with the session, which yt-dlp reads from a file that then goes', async () => {
    const cookiesSeen: string[] = [];
    setup = setupTools({
      run: fakeYtDlp(null, { loginUnlessCookies: true, cookiesSeen }),
      instagramCookies: COOKIES,
    });
    const result = await setup.call('templates.fetchReference', { projectId: setup.projectA, url: REEL });
    // The stand-in has no reel to give even then: the failure names the session's try.
    expect(!result.ok && result.error.code).toBe('templates.fetch_failed');
    expect(!result.ok && result.error.detail).toMatch(/^session: exit 1/);
    expect(cookieArgs(setup)).toEqual([false, true]);
    expect(cookiesSeen).toEqual([COOKIES]);
    const left = existsSync(setup.sandbox.root) ? readdirSync(setup.sandbox.root, { recursive: true }) : [];
    expect(left.map(String).filter((path) => path.endsWith('ig-cookies.txt'))).toEqual([]);
  });

  it('never sends the session for another platform', async () => {
    setup = setupTools({
      run: fakeYtDlp(null, { stderr: INSTAGRAM_LOGIN_ERROR.replace('Instagram', 'youtube') }),
      instagramCookies: COOKIES,
    });
    const result = await setup.call('templates.fetchReference', { projectId: setup.projectA, url: SHORT });
    expect(!result.ok && result.error.code).toBe('templates.fetch_failed');
    expect(cookieArgs(setup)).toEqual([false]);
  });

  it("reports 'discarded' for a breakdown that is gone and no template kept", async () => {
    setup = setupTools();
    const status = await setup.value('templates.referenceStatus', {
      breakdownId: newId(),
      templateId: newId(),
    });
    expect(status).toEqual({ status: 'discarded' });
  });
});
