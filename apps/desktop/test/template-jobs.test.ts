// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The templates lane's jobs in the jobs process: the kinds are registered,
 * the sandbox finds its Seatbelt profiles, scratch is under userData, a
 * fetch asks for no acknowledgement (REF1), and the test-build beat stand-in
 * reads onsets.
 */
import { existsSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createDirectJobRunner, newId, RationalTime, type ExperimentId } from '@taalcut/core';
import { createMediaService } from '@taalcut/media';
import { templatesFetchReferenceJob } from '@taalcut/templates';
import { createUtilityContainer } from '../src/utility/roots/base';
import { mediaBinaries } from '../src/utility/roots/media-jobs';
import { templateJobs } from '../src/utility/roots/template-jobs';
import { createJobsSandbox, sandboxProfilesDir, scratchRoot } from '../src/utility/roots/template-sandbox';
import { onsetBeatMap } from '../src/utility/roots/template-standins';
import { composeVision } from '../src/utility/roots/vision';
import { ComponentManagerToken } from '../src/shared/tokens';
import { noComponents } from './helpers/breakdown-fakes';
import { testConfig } from './helpers/roots';

function compose() {
  const config = testConfig('jobs');
  const container = createUtilityContainer(config);
  container.value(ComponentManagerToken, noComponents as never);
  const media = createMediaService({ resolver: mediaBinaries(config) });
  const vision = composeVision(container, config, media, () => noComponents as never);
  return { config, container, media, jobs: templateJobs(config, container, media, vision) };
}

describe('template jobs in the jobs process', () => {
  it('registers the fetch, the breakdown and sandbox.run', () => {
    const kinds = compose().jobs.map((job) => job.kind.kind);
    expect(kinds).toEqual(
      expect.arrayContaining(['templates.fetchReference', 'templates.breakdown', 'sandbox.run']),
    );
  });

  it('finds the Seatbelt profiles in a checkout, and Resources/sandbox/profiles when packaged', () => {
    const config = testConfig('jobs');
    expect(existsSync(join(sandboxProfilesDir(config), 'offline.sb'))).toBe(true);
    expect(existsSync(join(sandboxProfilesDir(config), 'fetcher.sb'))).toBe(true);
    expect(sandboxProfilesDir({ ...config, packaged: true })).toBe(
      join(config.resourcesPath, 'sandbox', 'profiles'),
    );
  });

  it('opens experiments under <userData>/scratch', async () => {
    const { config, media } = compose();
    const sandbox = createJobsSandbox({ config, media, components: () => noComponents });
    const id = newId<'Experiment'>() as ExperimentId;
    const opened = await sandbox.open({ id, projectId: null, purpose: 'breakdown' });
    if (!opened.ok) throw new Error(opened.error.code);
    // The sandbox works on real paths (/var is /private/var).
    expect(opened.value.dir.startsWith(realpathSync(scratchRoot(config.userData)))).toBe(true);
    expect((await sandbox.discard(id)).ok).toBe(true);
  });

  it('fetches a link with nothing acknowledged: no warning stands before it', async () => {
    const { jobs } = compose();
    const runner = createDirectJobRunner(jobs);
    const input = { experimentId: newId<'Experiment'>(), url: 'https://www.youtube.com/shorts/abc123' };
    // Straight past where the check was, to the experiment (which this test never opened).
    const result = await runner.run(templatesFetchReferenceJob, input);
    expect(!result.ok && result.error.code).toBe('templates.experiment_gone');
  });
});

describe("the test build's beat stand-in", () => {
  it('reads click onsets from silencedetect', () => {
    const log = [0.5, 1, 1.5, 2]
      .map((t) => `[silencedetect] silence_start: ${t - 0.45}\n[silencedetect] silence_end: ${t}`)
      .join('\n');
    const map = onsetBeatMap(`[silencedetect] silence_start: 0.01\n${log}`);
    expect(map?.beats.map((beat) => RationalTime.toSeconds(beat))).toEqual([0, 0.5, 1, 1.5, 2]);
    expect(map?.bpm).toBe(120);
    expect(onsetBeatMap('nothing here')).toBeNull();
  });
});
