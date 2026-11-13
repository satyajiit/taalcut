// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * REF1 end to end through the tools: a template keeps its reel's video and music. A fetched link moves out of
 * scratch into the template's media folder; a dropped file or screen recording is copied in and the person's file
 * left untouched; a reel only the Instagram session could get says so; and an older template fetches its reel
 * again with templates.fetchMedia.
 */
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { RationalTime, type TemplateId } from '@taalcut/core';
import { templatesFetchMedia } from '../../src/index';
import { runProcess, SYNTHETIC_REELS, syntheticReelArgs } from '../../src/test-support';
import { fakeYtDlp } from '../helpers/fake-fetcher';
import { findFfmpeg } from '../helpers/ffmpeg';
import { finaliseBreakdown, type BreakdownStart } from '../helpers/finalise-flow';
import { setupTools, type ToolSetup } from '../helpers/tool-setup';

const { bins, skip } = findFfmpeg('keep media');
const work = mkdtempSync(join(tmpdir(), 'taalcut-keep-'));
const reel = join(work, 'hard-cuts.mp4');
const SHORT = 'https://www.youtube.com/shorts/abcDEF12345';
const REEL = 'https://www.instagram.com/reel/EXAMPLE123/';
const COOKIES = '# Netscape HTTP Cookie File\n.instagram.com\tTRUE\t/\tTRUE\t0\tsessionid\tEXAMPLE\n';
const sha = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
let setup: ToolSetup | undefined;

beforeAll(async () => {
  if (!bins) return;
  const made = await runProcess(bins.ffmpeg, syntheticReelArgs(SYNTHETIC_REELS[0]!, reel));
  if (!made.ok) throw new Error(made.error.detail);
});
afterEach(() => setup?.cleanup());
afterAll(() => rmSync(work, { recursive: true, force: true }));

/** Fetches the link and breaks it down. */
async function fromLink(tools: ToolSetup, url: string): Promise<BreakdownStart> {
  const fetched = await tools.value<{ experimentId: string }>('templates.fetchReference', {
    projectId: tools.projectA,
    url,
  });
  return tools.value<BreakdownStart>('templates.breakdown', {
    projectId: tools.projectA,
    experimentId: fetched.experimentId,
  });
}

describe.skipIf(!bins)('a template keeps its reel', () => {
  it('moves a fetched reel out of scratch into the media store, with its music', async () => {
    setup = setupTools({ bins: bins!, run: fakeYtDlp(reel, { exitCode: 101 }) });
    const breakdown = await fromLink(setup, SHORT);
    const finalised = await finaliseBreakdown(setup, breakdown);
    const templateId = finalised.templateId as TemplateId;
    const kept = await setup.media.get(templateId);
    expect(kept.ok && kept.value).toBeTruthy();
    if (!kept.ok || !kept.value) return;
    const { media, path } = kept.value;
    expect(media).toMatchObject({
      file: 'reference.mp4',
      hasAudio: true,
      source: 'anonymous',
      sha256: sha(reel),
    });
    expect(media.bytes).toBe(readFileSync(reel).length);
    expect(path).toBe(join(setup.media.root, templateId, 'reference.mp4'));
    expect(finalised.media).toEqual({ bytes: media.bytes, hasAudio: true });
    // The template's fingerprint is the kept file's: the beat map was measured from it.
    const stored = await setup.service.get({ templateId });
    const origin = stored.ok ? stored.value.template.origin : null;
    if (origin?.kind !== 'reference') throw new Error('not a reference template');
    expect(origin.fingerprint).toBe(media.sha256);
    expect(media.durationMs).toBe(Math.round(RationalTime.toSeconds(origin.source.duration) * 1000));
    // Scratch is gone; the reel is not.
    expect(existsSync(join(setup.sandbox.root, breakdown.breakdownId))).toBe(false);
    expect(await setup.value('templates.referenceStatus', { breakdownId: breakdown.breakdownId })).toEqual({
      status: 'kept',
    });
  });

  it("records a reel only the Instagram session could get as the session's", async () => {
    const linksSeen: string[] = [];
    setup = setupTools({
      bins: bins!,
      run: fakeYtDlp(reel, { loginUnlessCookies: true, linksSeen }),
      instagramCookies: COOKIES,
    });
    // Shared with the sharer's tokens (made up): both tries, and the template, get the bare reel link.
    const shared = `${REEL}?utm_source=ig_web_copy_link&igsh=ZmFrZXRva2Vu&rpxt=FAKE&srtk=FAKE`;
    const finalised = await finaliseBreakdown(setup, await fromLink(setup, shared));
    const kept = await setup.media.get(finalised.templateId as TemplateId);
    expect(kept.ok && kept.value?.media.source).toBe('session');
    expect(linksSeen).toEqual([REEL, REEL]);
    const stored = await setup.service.get({ templateId: finalised.templateId as TemplateId });
    const origin = stored.ok ? stored.value.template.origin : null;
    expect(origin?.kind === 'reference' && origin.url).toBe(REEL);
  });

  it('copies a dropped file and a screen recording in, and leaves the person’s file as it was', async () => {
    setup = setupTools({ bins: bins! });
    for (const screenRecording of [false, true]) {
      const mine = join(setup.root, `my reel ${screenRecording}.mp4`);
      copyFileSync(reel, mine);
      const before = sha(mine);
      const breakdown = await setup.value<BreakdownStart>('templates.breakdown', {
        projectId: setup.projectA,
        path: mine,
        ...(screenRecording ? { screenRecording } : {}),
      });
      const finalised = await finaliseBreakdown(setup, breakdown);
      const kept = await setup.media.get(finalised.templateId as TemplateId);
      if (!kept.ok || !kept.value) throw new Error('no media kept');
      // The original, whole: a screen recording's crop is for the analysis only.
      expect(kept.value.media).toMatchObject({ source: 'file', sha256: before });
      expect(existsSync(mine) && sha(mine)).toBe(before);
      expect(await setup.value('templates.referenceStatus', { breakdownId: breakdown.breakdownId })).toEqual({
        status: 'kept',
      });
    }
  });

  it('keeps nothing without a media store, and the template is saved all the same', async () => {
    setup = setupTools({ bins: bins!, run: fakeYtDlp(reel), media: false });
    const finalised = await finaliseBreakdown(setup, await fromLink(setup, SHORT));
    expect(finalised.media).toBeNull();
    expect((await setup.service.get({ templateId: finalised.templateId as TemplateId })).ok).toBe(true);
    // Still offered, so every composition offers one catalogue; it says it has nowhere to keep a reel.
    const fetched = await setup.call('templates.fetchMedia', {
      projectId: setup.projectA,
      templateId: finalised.templateId,
    });
    expect(!fetched.ok && fetched.error.code).toBe('core.not_implemented');
  });
});

describe.skipIf(!bins)('templates.fetchMedia', () => {
  it('fetches an older template’s reel again from its link and keeps it', async () => {
    setup = setupTools({ bins: bins!, run: fakeYtDlp(reel) });
    const finalised = await finaliseBreakdown(setup, await fromLink(setup, SHORT));
    const templateId = finalised.templateId as TemplateId;
    // As a template made before REF1: no media.
    await setup.media.remove(templateId);
    expect((await setup.media.get(templateId)).ok && (await setup.media.get(templateId))).toEqual({
      ok: true,
      value: null,
    });
    const fetched = await setup.value('templates.fetchMedia', { projectId: setup.projectA, templateId });
    expect(fetched).toMatchObject({ templateId, hasAudio: true, source: 'anonymous', sameFile: true });
    expect(setup.sandbox.openIds().filter((id) => existsSync(join(setup!.sandbox.root, id)))).toEqual([]);
    // The router's templates.fetchMedia answers the summary with the media set.
    await setup.media.remove(templateId);
    const summary = await templatesFetchMedia({ ...setup.deps, media: setup.media })({ id: templateId });
    expect(summary.ok && summary.value.media).toMatchObject({ sha256: sha(reel), source: 'anonymous' });
  });

  it('says a template with no link has nothing to fetch', async () => {
    setup = setupTools({ bins: bins! });
    const breakdown = await setup.value<BreakdownStart>('templates.breakdown', {
      projectId: setup.projectA,
      path: reel,
    });
    const { templateId } = await finaliseBreakdown(setup, breakdown);
    const result = await setup.call('templates.fetchMedia', { projectId: setup.projectA, templateId });
    expect(!result.ok && result.error.code).toBe('templates.no_origin_link');
    expect(setup.sandbox.runs).toEqual([]);
  });

  it('a failed fetch keeps nothing and leaves no scratch', async () => {
    setup = setupTools({ bins: bins!, run: fakeYtDlp(reel) });
    const { templateId } = await finaliseBreakdown(setup, await fromLink(setup, SHORT));
    await setup.media.remove(templateId as TemplateId);
    setup.sandbox.setRun(fakeYtDlp(null));
    const result = await setup.call('templates.fetchMedia', { projectId: setup.projectA, templateId });
    expect(!result.ok && result.error.code).toBe('templates.fetch_failed');
    expect((await setup.media.get(templateId as TemplateId)).ok).toBe(true);
    expect(setup.media.rows.has(templateId as TemplateId)).toBe(false);
    expect(setup.sandbox.openIds().filter((id) => existsSync(join(setup!.sandbox.root, id)))).toEqual([]);
  });
});

if (skip) it.skip(skip, () => undefined);
