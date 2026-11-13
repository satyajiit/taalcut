// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P2-T3, P2-T4 end to end through the tools: a link fetched by a stand-in
 * yt-dlp, broken down by the real pipeline (FFmpeg stand-ins for the
 * analysers), resolved, finalised with one undo entry, and nothing left in
 * scratch afterwards (REF1: the reel itself is kept with the template,
 * keep-media.test.ts). A dropped file is read in place and never touched,
 * whatever happens to its breakdown.
 */
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { ok, templateSchema, type TemplateId } from '@taalcut/core';
import type { z } from 'zod';
import { slotPageFor } from '../../src/breakdown/slot-context-pages';
import type { resolveCutsOutputSchema } from '../../src/tools/schemas';
import { DEFAULT_REEL_ENCODER, runProcess, SYNTHETIC_REELS, syntheticReelArgs } from '../../src/test-support';
import { fakeYtDlp } from '../helpers/fake-fetcher';
import { findFfmpeg } from '../helpers/ffmpeg';
import { UI } from '../helpers/setup';
import { setupTools, type ToolSetup } from '../helpers/tool-setup';

const { bins, skip } = findFfmpeg('intake flow');
const work = mkdtempSync(join(tmpdir(), 'taalcut-intake-'));
const reel = join(work, 'hard-cuts.mp4');
const SHORT = 'https://www.youtube.com/shorts/abcDEF12345';
const sha = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
let setup: ToolSetup | undefined;

beforeAll(async () => {
  if (!bins) return;
  const made = await runProcess(bins.ffmpeg, syntheticReelArgs(SYNTHETIC_REELS[0]!, reel));
  if (!made.ok) throw new Error(made.error.detail);
});
afterEach(() => setup?.cleanup());
afterAll(() => rmSync(work, { recursive: true, force: true }));

type Page = z.output<typeof resolveCutsOutputSchema>;

interface Dispute {
  at: number;
  ruleKeeps: boolean;
  before: string;
  after: string;
}
interface BreakdownOut {
  breakdownId: string;
  disputes: number;
  toJudge: number;
  next: Dispute | null;
  draft?: { id: string };
}

describe.skipIf(!bins)('a link, end to end', () => {
  it('fetches, breaks down, finalises as one undo entry and leaves nothing in scratch', async () => {
    setup = setupTools({ bins: bins!, run: fakeYtDlp(reel, { exitCode: 101 }) });
    const fetched = await setup.value<{ experimentId: string; platform: string; sound: unknown }>(
      'templates.fetchReference',
      { projectId: setup.projectA, url: SHORT },
    );
    expect(fetched.platform).toBe('shorts');
    expect(fetched.sound).toEqual({ title: 'Golden Hour', artist: 'Some Band' });

    const breakdown = await setup.value<BreakdownOut>('templates.breakdown', {
      projectId: setup.projectA,
      experimentId: fetched.experimentId,
    });
    expect(breakdown.breakdownId).toBe(fetched.experimentId);
    // The job runner's onEnqueued: the breakdown card can show the job.
    expect(setup.breakdownJobs.get(breakdown.breakdownId)).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(breakdown.draft && setup.artifacts.items.has(breakdown.draft.id as never)).toBe(true);
    expect(setup.progress.some((step) => step.note?.startsWith('jobs.stage.'))).toBe(true);

    // The disputed cuts one at a time: each verdict stored hands out the next, with its frames.
    const breakdownId = breakdown.breakdownId;
    const tools = setup;
    let judged = 0;
    for (let next = breakdown.next; next !== null; judged += 1) {
      expect(existsSync(next.before) && existsSync(next.after)).toBe(true);
      const verdict = { breakdownId, at: next.at, cut: next.ruleKeeps };
      next = (await tools.value<{ next: Dispute | null }>('templates.judgeCut', verdict)).next;
    }
    expect(judged).toBe(breakdown.toJudge);
    // A page at a time: the next slots without an intent, one frame each, until every slot has one.
    const resolve = () => tools.value<Page>('templates.resolveCuts', { breakdownId });
    const pages: number[][] = [];
    for (let page = await resolve(); page.slots.length > 0; page = await resolve()) {
      expect(page.total).toBe(8);
      expect(page.slots.every((slot) => slot.frame !== null && existsSync(slot.frame))).toBe(true);
      pages.push(page.slots.map((slot) => slot.index));
      await setup.value('templates.setIntents', {
        breakdownId,
        intents: page.slots.map((slot) => ({
          slotIndex: slot.index,
          intent: {
            text: `shot ${slot.index}`,
            shotType: 'medium',
            motion: 'static',
            subject: null,
            people: 0,
            place: null,
            energy: 0.6,
          },
        })),
      });
    }
    // An unknown window is taken as the smallest local one.
    const size = slotPageFor(undefined);
    expect(pages).toEqual(
      Array.from({ length: Math.ceil(8 / size) }, (_, page) =>
        Array.from({ length: Math.min(size, 8 - page * size) }, (_, i) => page * size + i),
      ),
    );
    const finalised = await setup.value<{ templateId: string; version: number }>('templates.finalise', {
      projectId: setup.projectA,
      breakdownId,
      name: 'Colour blocks',
    });
    expect(finalised.version).toBe(1);
    // BRK1's gate: no hash for the model to chase; the template keeps the sheet.
    expect(finalised).not.toHaveProperty('contactSheet');

    const stored = await setup.service.get({ templateId: finalised.templateId as TemplateId });
    expect(stored.ok).toBe(true);
    if (!stored.ok) return;
    const template = templateSchema.parse(stored.value.template);
    expect(template.origin).toMatchObject({
      kind: 'reference',
      input: 'link',
      platform: 'shorts',
      url: SHORT,
    });
    expect(template.slots.every((slot) => slot.intent.source === 'analyst')).toBe(true);
    expect(stored.value.summary.contactSheet?.asset).toMatch(/^[0-9a-f]{64}$/);

    expect(await setup.value('templates.referenceStatus', { breakdownId: breakdown.breakdownId })).toEqual({
      status: 'kept',
    });
    expect(existsSync(join(setup.sandbox.root, breakdown.breakdownId))).toBe(false);

    // ⌘Z takes the whole template back in one step.
    const undone = await setup.bus.undo(setup.projectA, UI);
    expect(undone.ok && undone.value?.name).toBe('template.create');
    expect((await setup.service.get({ templateId: finalised.templateId as TemplateId })).ok).toBe(false);
  });

  it('finds a reel that is too long for a reference', async () => {
    setup = setupTools({ bins: bins!, run: fakeYtDlp(reel) });
    const long = join(setup.root, 'long.mp4');
    const made = await runProcess(bins!.ffmpeg, [
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'color=c=red:s=64x64:r=1:d=200',
      '-c:v',
      DEFAULT_REEL_ENCODER,
      '-b:v',
      '1M',
      '-y',
      long,
    ]);
    expect(made.ok).toBe(true);
    setup.sandbox.setRun(fakeYtDlp(long));
    const result = await setup.call('templates.fetchReference', { projectId: setup.projectA, url: SHORT });
    expect(!result.ok && result.error.code).toBe('templates.reference_too_long');
    expect(setup.sandbox.openIds().filter((id) => existsSync(join(setup!.sandbox.root, id)))).toEqual([]);
  });
});

describe.skipIf(!bins)('a dropped file', () => {
  it('is read in place and never touched, abandoned or finalised', async () => {
    setup = setupTools({ bins: bins! });
    const mine = join(setup.root, 'my reel.mp4');
    copyFileSync(reel, mine);
    const before = sha(mine);
    const breakdown = await setup.value<BreakdownOut>('templates.breakdown', {
      projectId: setup.projectA,
      path: mine,
    });
    expect(existsSync(join(setup.sandbox.root, breakdown.breakdownId))).toBe(true);
    const freed = await setup.value<{ freedBytes: number }>('templates.abandonBreakdown', {
      breakdownId: breakdown.breakdownId,
    });
    expect(freed.freedBytes).toBeGreaterThan(0);
    expect(existsSync(join(setup.sandbox.root, breakdown.breakdownId))).toBe(false);
    expect(sha(mine)).toBe(before);
    const late = await setup.call('templates.finalise', {
      projectId: setup.projectA,
      breakdownId: breakdown.breakdownId,
      name: 'Too late',
    });
    expect(!late.ok && late.error.code).toBe('templates.experiment_gone');
  });

  it('describes every strip on the way (BRK1 looks), so the page hands the model words, not frames', async () => {
    const asked: string[] = [];
    setup = setupTools({
      bins: bins!,
      describeStrip: async (path) => {
        asked.push(path);
        return ok('a street, the camera still on it');
      },
    });
    const mine = join(setup.root, 'my reel.mp4');
    copyFileSync(reel, mine);
    const breakdown = await setup.value<BreakdownOut>('templates.breakdown', {
      projectId: setup.projectA,
      path: mine,
    });
    expect(asked.length).toBeGreaterThan(0);
    expect(asked.every((path) => path.includes('strip-') && existsSync(path))).toBe(true);
    expect(setup.progress.some((step) => step.note === 'describing shots')).toBe(true);
    const page = await setup.value<Page>('templates.resolveCuts', { breakdownId: breakdown.breakdownId });
    expect(page.slots.length).toBeGreaterThan(0);
    expect(page.slots.every((slot) => slot.frame === null)).toBe(true);
    expect(page.slots.every((slot) => slot.context.looks === 'a street, the camera still on it')).toBe(true);
  });

  it('a failed breakdown discards its experiment and keeps the file', async () => {
    setup = setupTools({ bins: bins! });
    const notVideo = join(setup.root, 'notes.mp4');
    writeFileSync(notVideo, 'not a video at all');
    const result = await setup.call('templates.breakdown', { projectId: setup.projectA, path: notVideo });
    expect(result.ok).toBe(false);
    expect(readFileSync(notVideo, 'utf8')).toBe('not a video at all');
    expect(setup.sandbox.openIds().filter((id) => existsSync(join(setup!.sandbox.root, id)))).toEqual([]);
  });

  it('a cancelled breakdown discards its experiment', async () => {
    setup = setupTools({ bins: bins! });
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 150);
    const result = await setup.call(
      'templates.breakdown',
      { projectId: setup.projectA, path: reel },
      controller.signal,
    );
    expect(!result.ok && result.error.code).toBe('core.cancelled');
    expect(setup.sandbox.openIds().filter((id) => existsSync(join(setup!.sandbox.root, id)))).toEqual([]);
    expect(existsSync(reel)).toBe(true);
  });

  it('the same reel again reuses a draft whose experiment exists, else analyses anew', async () => {
    setup = setupTools({ bins: bins!, memoJobs: true });
    const first = await setup.value<BreakdownOut>('templates.breakdown', {
      projectId: setup.projectA,
      path: reel,
    });
    const again = await setup.value<BreakdownOut>('templates.breakdown', {
      projectId: setup.projectA,
      path: reel,
    });
    expect(again.breakdownId).toBe(first.breakdownId);
    expect(setup.sandbox.openIds().filter((id) => existsSync(join(setup!.sandbox.root, id)))).toEqual([
      first.breakdownId,
    ]);
    await setup.value('templates.abandonBreakdown', { breakdownId: first.breakdownId });
    const fresh = await setup.value<BreakdownOut>('templates.breakdown', {
      projectId: setup.projectA,
      path: reel,
    });
    expect(fresh.breakdownId).not.toBe(first.breakdownId);
    expect(existsSync(join(setup.sandbox.root, fresh.breakdownId))).toBe(true);
  });
});

if (skip) it.skip(skip, () => undefined);
