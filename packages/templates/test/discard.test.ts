// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A breakdown's scratch goes on every path (P2-T3), without FFmpeg: a discard
 * that fails is reported, never taken for success; finalise can be called
 * again and still names the one template and its one kept reel (REF1); and
 * the fetch job discards its own experiment once its failure is final, so a
 * dead tool is not the only deleter.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  newId,
  ok,
  type ComponentInstallerPort,
  type ExperimentId,
  type JobContext,
  type JobId,
} from '@taalcut/core';
import { BREAKDOWN_FILE, createTemplateJobs, templatesFetchReferenceJob } from '../src/index';
import { createFfmpegAnalysers } from '../src/test-support';
import { createDirSandbox } from './helpers/dir-sandbox';
import { draftFixture } from './helpers/draft';
import { fakeYtDlp } from './helpers/fake-fetcher';
import { setupTools, type ToolSetup } from './helpers/tool-setup';

const SHORT = 'https://www.youtube.com/shorts/abcDEF12345';
let setup: ToolSetup | undefined;
afterEach(() => setup?.cleanup());

/** An experiment holding a finished breakdown, as templates.breakdown leaves it. */
async function breakdownInScratch(tools: ToolSetup): Promise<ExperimentId> {
  const id = newId<'Experiment'>() as ExperimentId;
  const opened = await tools.sandbox.open({ id, projectId: tools.projectA, purpose: 'breakdown' });
  if (!opened.ok) throw new Error('open failed');
  writeFileSync(join(opened.value.dir, 'reference.mp4'), 'reel');
  writeFileSync(
    join(opened.value.dir, BREAKDOWN_FILE),
    JSON.stringify({ ...draftFixture(), breakdownId: id }),
  );
  return id;
}

describe('a discard that fails', () => {
  it('fails finalise after the template is saved; calling again saves nothing new, keeps the reel, discards', async () => {
    setup = setupTools();
    const id = await breakdownInScratch(setup);
    // The rule's four slots, each with its intent (templates.finalise refuses an open slot).
    await setup.value('templates.setIntents', {
      breakdownId: id,
      intents: [0, 1, 2, 3].map((slotIndex) => ({
        slotIndex,
        intent: {
          text: `shot ${slotIndex}`,
          shotType: 'wide',
          motion: 'static',
          subject: null,
          people: 0,
          place: null,
          energy: 0.5,
        },
      })),
    });
    const input = { projectId: setup.projectA, breakdownId: id, name: 'Reel' };
    setup.sandbox.failDiscards(true);
    const failed = await setup.call('templates.finalise', input);
    expect(!failed.ok && failed.error.code).toBe('sandbox.discard_failed');
    expect(await setup.value('templates.referenceStatus', { breakdownId: id })).toEqual({
      status: 'present',
    });

    setup.sandbox.failDiscards(false);
    const again = await setup.value<{ templateId: string; media: unknown }>('templates.finalise', input);
    // The first call moved the reel into the template's media before its discard failed; the second reports it.
    expect(again.media).toEqual({ bytes: 4, hasAudio: true });
    expect(await setup.value('templates.referenceStatus', { breakdownId: id })).toEqual({ status: 'kept' });
    expect(setup.media.rows.size).toBe(1);
    const listed = await setup.store.list({ includeUnlisted: true, includeArchived: true, limit: 50 });
    expect(listed.ok && listed.value.items.map((template) => template.id)).toEqual([again.templateId]);
  });

  it('is the result of abandonBreakdown, not zero bytes freed', async () => {
    setup = setupTools();
    const id = await breakdownInScratch(setup);
    setup.sandbox.failDiscards(true);
    const abandoned = await setup.call('templates.abandonBreakdown', { breakdownId: id });
    expect(!abandoned.ok && abandoned.error.code).toBe('sandbox.discard_failed');
    setup.sandbox.failDiscards(false);
    const freed = await setup.value<{ freedBytes: number }>('templates.abandonBreakdown', {
      breakdownId: id,
    });
    expect(freed.freedBytes).toBeGreaterThan(0);
  });

  it('is named in a failed fetch, beside the fetch error', async () => {
    setup = setupTools({ run: fakeYtDlp(null, { exitCode: 1 }) });
    setup.sandbox.failDiscards(true);
    const result = await setup.call('templates.fetchReference', { projectId: setup.projectA, url: SHORT });
    expect(!result.ok && result.error.code).toBe('templates.fetch_failed');
    expect(!result.ok && result.error.detail).toContain('sandbox.discard_failed');
  });
});

describe('templates.fetchReference job', () => {
  const components: ComponentInstallerPort = {
    get: async (id) => ({ id, version: '1', path: `/components/${id}`, notice: `/components/${id}/NOTICE` }),
    install: async (id) =>
      ok({ id, version: '1', path: `/components/${id}`, notice: `/components/${id}/NOTICE` }),
  };
  const context = (attempt: number): JobContext => ({
    jobId: newId<'Job'>() as JobId,
    projectId: null,
    attempt,
    signal: new AbortController().signal,
    progress: () => undefined,
  });

  it('keeps the experiment for a retry, and discards it once the failure is final', async () => {
    const root = join(setupTools().root, 'jobs-scratch');
    mkdirSync(root, { recursive: true });
    const sandbox = createDirSandbox(root, fakeYtDlp(null, { exitCode: 1 }));
    const analysers = createFfmpegAnalysers({ ffmpeg: '/nonexistent', ffprobe: '/nonexistent' });
    const jobs = createTemplateJobs({ sandbox, components, analysers, clock: { now: () => 0 } });
    const fetch = jobs.find((job) => job.kind.kind === templatesFetchReferenceJob.kind)!;
    const last = templatesFetchReferenceJob.retry.maxAttempts;
    const id = newId<'Experiment'>() as ExperimentId;
    await sandbox.open({ id, projectId: null, purpose: 'breakdown' });

    const first = await fetch.handler({ experimentId: id, url: SHORT }, context(1));
    expect(!first.ok && first.error).toMatchObject({ code: 'templates.fetch_failed', retryable: true });
    expect((await sandbox.get(id)).ok).toBe(true); // the engine tries again in the same experiment

    const final = await fetch.handler({ experimentId: id, url: SHORT }, context(last));
    expect(final.ok).toBe(false);
    expect((await sandbox.get(id)).ok).toBe(false);
  });
});
