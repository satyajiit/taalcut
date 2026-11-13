// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** runQa end to end on the pass recipe: every post-render check, a report, re-runs and failures to measure. */
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { qaReportSchema, type QaCheckId } from '@taalcut/core';
import type { MediaContext } from '@taalcut/media';
import { checkResult } from '../../src/qa/result';
import { runQa, type QaContext } from '../../src/qa/run-qa';
import type { ProbedTextBox } from '../../src/types';
import { findTestMedia, mediaContext, tempDir } from '../support/media';
import { captions, clock, passFixture, qaPlan, runInput } from './support';

const media = await findTestMedia('qa runQa');
const plan = qaPlan({ cues: [{ id: 'cue-1', span: { start: 0, end: 30 }, probeFrames: [15] }] });
const track = captions([{ id: 'cue-1', start: 0, frames: 30, text: 'Watch this before you post' }]);
const inside: ProbedTextBox = {
  kind: 'caption',
  id: 'cue-1',
  frame: 15,
  box: { x: 200, y: 950, width: 560, height: 180 },
  lines: 2,
  overflow: false,
  fontsReady: true,
  color: '#ffffff',
};

describe.skipIf(!media.binaries)('runQa', () => {
  let ctx: QaContext;
  let mediaCtx: MediaContext;
  let work: Awaited<ReturnType<typeof tempDir>>;
  let file: string;
  const statuses = (checks: readonly { id: QaCheckId; status: string }[]) =>
    Object.fromEntries(checks.map((check) => [check.id, check.status]));

  beforeAll(async () => {
    mediaCtx = mediaContext(media.binaries!);
    ctx = { media: mediaCtx, clock };
    work = await tempDir('qa-run');
    file = join(work.dir, 'render.mp4');
    // The tone measures −21.8 LUFS as encoded; 7.8 dB brings it to the −14 LUFS target, as the mixer would.
    await passFixture(mediaCtx, file, { extra: ['-af', 'volume=7.8dB'] });
  });
  afterAll(() => work.dispose());

  it('passes the pass recipe on every check, with a report the schema accepts', async () => {
    const started = performance.now();
    const result = await runQa(runInput(file, plan, { captions: track, probe: async () => [inside] }), ctx);
    if (!result.ok) throw new Error(result.error.code);
    const report = result.value;
    expect(qaReportSchema.safeParse(report).success).toBe(true);
    expect(statuses(report.checks)).toEqual({
      rightsReferenceAudio: 'pass',
      container: 'pass',
      codec: 'pass',
      resolution: 'pass',
      aspectRatio: 'pass',
      frameRate: 'pass',
      duration: 'pass',
      bitrate: 'pass',
      blackFrames: 'pass',
      frozenFrames: 'pass',
      blackBars: 'pass',
      avSync: 'pass',
      beatSync: 'skipped',
      loudness: 'pass',
      silence: 'pass',
      captionSafeZone: 'pass',
      captionOverflow: 'pass',
      captionGlyphs: 'pass',
      captionReadability: 'pass',
      // Phase 3: nothing reframed, no graphics, no Style; credentials off and none in the file.
      subjectInFrame: 'skipped',
      voiceOverMusic: 'skipped',
      cropJitter: 'skipped',
      captionCoversFace: 'skipped',
      graphicsSafeZone: 'skipped',
      graphicsOverlap: 'skipped',
      graphicsReadability: 'skipped',
      contentCredentials: 'pass',
      brandAssets: 'skipped',
      // LRN1-STY: the project follows no set of references.
      stylePacing: 'skipped',
      // FRM1-OVL: no graphic and no text item on screen.
      graphicCoversFace: 'skipped',
      // AGT2-MATCH: the timeline follows no template.
      slotNeeds: 'skipped',
      slotFace: 'skipped',
      slotFraming: 'skipped',
      slotMotion: 'skipped',
      slotTiming: 'skipped',
      slotGraphics: 'skipped',
      // EAR1-A2: no listener in this QA run.
      soundOnCuts: 'skipped',
      soundClean: 'skipped',
      soundCritique: 'skipped',
    });
    expect(report.verdict).toBe('passed');
    expect(report.round).toBe(1);
    expect(report.createdAt).toBe(clock.now());
    // Time per check is recorded and adds up to no more than the run.
    const total = report.checks.reduce((sum, check) => sum + check.durationMs, 0);
    expect(total).toBeLessThanOrEqual(performance.now() - started + report.checks.length);
  });

  it('keeps the preflight results in the report, in catalogue order', async () => {
    const preflight = [
      checkResult('preflightMedia', 'pass', {}, 3),
      checkResult('preflightFonts', 'pass', {}, 2),
    ];
    const result = await runQa(
      runInput(file, plan, { captions: track, probe: async () => [inside], preflight }),
      ctx,
    );
    if (!result.ok) throw new Error(result.error.code);
    expect(result.value.checks.slice(0, 2).map((check) => check.id)).toEqual([
      'preflightMedia',
      'preflightFonts',
    ]);
  });

  it('fails the caption checks when text is on screen and nothing probed it', async () => {
    const result = await runQa(
      runInput(file, plan, { captions: track, only: ['captionSafeZone', 'captionOverflow'] }),
      ctx,
    );
    if (!result.ok) throw new Error(result.error.code);
    for (const check of result.value.checks) {
      expect(check.status).toBe('fail');
      expect(check.findings[0]?.target).toEqual({ kind: 'file', id: 'domProbe' });
    }
    const thrown = await runQa(
      runInput(file, plan, {
        captions: track,
        only: ['captionSafeZone'],
        probe: () => Promise.reject(new Error('page crashed')),
      }),
      ctx,
    );
    expect(thrown.ok && thrown.value.checks[0]?.status).toBe('fail');
  });

  it('re-runs only the listed checks and marks a fixed one', async () => {
    const before = await runQa(runInput(file, plan, { captions: track, probe: async () => [inside] }), ctx);
    if (!before.ok) throw new Error(before.error.code);
    const previous = {
      ...before.value,
      checks: before.value.checks.map((check) =>
        check.id === 'loudness' ? { ...check, status: 'fail' as const } : check,
      ),
      verdict: 'needsAttention' as const,
    };
    const after = await runQa(runInput(file, plan, { captions: track, only: ['loudness'], previous }), ctx);
    if (!after.ok) throw new Error(after.error.code);
    expect(statuses(after.value.checks).loudness).toBe('fixed');
    expect(after.value.checks).toHaveLength(previous.checks.length);
    expect(after.value.verdict).toBe('passed');
  });

  it('fails what it could not measure on a missing file, without throwing', async () => {
    const result = await runQa(runInput(join(work.dir, 'missing.mp4'), qaPlan()), ctx);
    if (!result.ok) throw new Error(result.error.code);
    const report = result.value;
    expect(report.verdict).toBe('needsAttention');
    for (const id of [
      'container',
      'blackFrames',
      'avSync',
      'loudness',
      'silence',
      'contentCredentials',
    ] as const)
      expect(report.checks.find((check) => check.id === id)?.fixes).toEqual([
        { kind: 'auto', action: 'rerender' },
      ]);
  });

  it('stops with core.cancelled when the render is cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await runQa(runInput(file, plan), { ...ctx, signal: controller.signal });
    expect(result.ok ? undefined : result.error.code).toBe('core.cancelled');
  });
});
