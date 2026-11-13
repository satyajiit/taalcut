// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The checking stage (SPEC section 10): the DOM probe on a stills copy of the composition, every QA check on
 * the muxed file, and the automatic fixes (renormalise, remux, re-encode, re-render) with the checks they
 * touch run again. A fix that rewrites the file runs `afterFile` (signing, P3-V7) before the re-check, so QA
 * always checks the delivered bytes.
 */
import { join } from 'node:path';
import { FrameRate, ok, RationalTime, type AsyncResult, type QaReport } from '@taalcut/core';
import { renormaliseAudio } from '../../audio/mix';
import { MIX_SAMPLE_RATE } from '../../audio/mix-plan';
import { planQa } from '../../plan/qa-plan';
import { runQaWithFixes, type AutoAction } from '../../qa/fix-loop';
import { createGraphicMeasureCache } from '../../qa/graphic-measures';
import { graphicFrames } from '../../qa/modules/graphics';
import { runQa, type RunQaInput } from '../../qa/run-qa';
import { samplesForFrames } from '../../time/frames';
import type { ExportInputs } from '../export-inputs';
import { openTextProbe, segmentColourSampler, type TextProbe } from '../qa-probes';
import type { RenderedVideo } from '../render-video';
import type { StageContext } from './context';
import type { PictureExtras } from './picture';
import { audibleClips, mixTarget } from './sound';

/** What is being delivered; auto fixes replace its parts. */
export interface Deliverable {
  picture: RenderedVideo;
  mixPath: string;
}

export interface CheckingInput {
  readonly stage: StageContext;
  readonly inputs: ExportInputs;
  readonly chromePath: string;
  /** The muxed file in the work folder. */
  readonly out: string;
  readonly deliverable: Deliverable;
  readonly extras: PictureExtras;
  readonly rerender: () => AsyncResult<RenderedVideo>;
  readonly finish: (reencode: boolean) => AsyncResult<unknown>;
  /** Runs after any fix that rewrote `out` (signing). */
  readonly afterFile?: () => AsyncResult<void>;
  /** Phase 3 facts the new checks read (framing, graphics, the mix's voice report, credentials, brand). */
  readonly qa?: Partial<RunQaInput>;
  readonly setStatus: (status: 'checking' | 'fixing') => void;
}

/** HFW1: the graphics checks' measurements for this render process, so an unchanged graphic is drawn once. */
const GRAPHIC_MEASURES = createGraphicMeasureCache();

async function openProbe(input: CheckingInput): Promise<TextProbe | null> {
  const { stage, inputs } = input;
  const captions = stage.record.captions.burnIn ? inputs.plan.captions : null;
  const hasText = inputs.plan.texts.length > 0 || (captions?.cues.length ?? 0) > 0;
  // Reframed clips: subjectInFrame reads each crop as Chrome applied it.
  const reframed =
    (input.qa?.facts?.reframe?.clips.length ?? 0) > 0 || (input.qa?.facts?.reframe?.layouts?.length ?? 0) > 0;
  // Composition graphics: their boxes and type as the export's page draws them (qa/modules/graphics.ts).
  const graphics = graphicFrames(inputs.qaPlan, GRAPHIC_MEASURES).length > 0;
  if (!hasText && !reframed && !graphics) return null;
  const opened = await openTextProbe({
    timeline: inputs.timeline,
    options: {
      preset: inputs.preset,
      burnCaptions: stage.record.captions.burnIn,
      fonts: inputs.fonts,
      captionLayout: inputs.captionLayout,
      ...input.extras.compose,
    },
    dir: join(stage.workDir, 'probe'),
    ctx: stage.deps.media,
    chromePath: input.chromePath,
    browserGpu: 'hardware',
  });
  // Without a probe the caption checks fail as unmeasured: QA never passes text it couldn't see.
  if (opened.ok) return opened.value;
  stage.deps.log?.(`[render] text probe unavailable: ${opened.error.code}`);
  return null;
}

/**
 * A probe that didn't open while graphics wait to be measured: it fails, so their checks fail as unmeasured with a
 * re-render, as the captions' do, rather than say no Chrome was there (docs/qa-gate.md, rule 6).
 */
function unopened(plan: ExportInputs['qaPlan']): Partial<RunQaInput> {
  if (graphicFrames(plan, GRAPHIC_MEASURES).length === 0) return {};
  return { probeFrame: () => Promise.reject(new Error('the text probe did not open')) };
}

/** Each audible clip's original and the file time at render time zero (avSync's sources). */
function audioSources(inputs: ExportInputs, audible: ExportInputs['plan']['audio']) {
  return new Map(
    audible.flatMap((clip) => {
      const path = inputs.audioFiles.get(clip.assetId);
      if (!path) return [];
      const at =
        RationalTime.toSeconds(clip.sourceIn) -
        (clip.span.start * inputs.plan.rate.den) / inputs.plan.rate.num;
      return [
        [clip.id, { path, offset: RationalTime.fromSeconds(at, FrameRate.of(MIX_SAMPLE_RATE)) }] as const,
      ];
    }),
  );
}

export async function checkRender(input: CheckingInput): AsyncResult<QaReport> {
  const { stage, inputs, deliverable } = input;
  const { deps, record, signal, workDir } = stage;
  stage.tracker.stage('checking');
  let probe = await openProbe(input);
  const segments = () =>
    new Map(
      [...deliverable.picture.segments].map(([id, segment]) => {
        const visual = inputs.plan.visuals.find((candidate) => candidate.id === id);
        return [id, { path: segment.file, startFrame: visual?.visible.start ?? 0 }] as const;
      }),
    );
  const qaInput = (): RunQaInput => {
    // QA expects the sound the mix could play: a clip whose file has no audio stream is neither sound
    // (silence) nor a sync source (avSync), as the mix leaves it out.
    const audible = audibleClips(inputs.plan, deliverable.picture);
    const plan =
      audible.length === inputs.plan.audio.length
        ? inputs.qaPlan
        : { ...inputs.qaPlan, audio: planQa({ ...inputs.plan, audio: audible }, inputs.preset).audio };
    return {
      renderId: record.id,
      round: inputs.round,
      file: input.out,
      plan,
      preset: inputs.preset,
      target: { projectId: record.projectId, timelineId: record.timelineId },
      captions: record.captions.burnIn ? inputs.plan.captions : null,
      preflight: inputs.preflight,
      segments: segments(),
      audioSources: audioSources(inputs, audible),
      ...(probe ? { probe: probe.probe, probeFrame: probe.probeFrame } : unopened(plan)),
      graphicMeasures: GRAPHIC_MEASURES,
      ...(deps.onFaceBoxes
        ? { onFaceBoxes: (dump) => deps.onFaceBoxes?.({ renderId: record.id, round: inputs.round }, dump) }
        : {}),
      sampleUnderBox: segmentColourSampler(
        inputs.plan,
        deliverable.picture.segments,
        deps.media,
        input.extras.compose?.framing?.sourceSizes,
      ),
      ...input.qa,
    };
  };
  const qaContext = { media: deps.media, clock: deps.clock, signal, onFallback: stage.fallback };
  const applyAuto = async (action: AutoAction): AsyncResult<void> => {
    if (action === 'renormaliseAudio') {
      const again = join(workDir, `mix-${Date.now()}.m4a`);
      const samples = samplesForFrames(inputs.plan.durationFrames, inputs.plan.rate, MIX_SAMPLE_RATE);
      const renormalised = await renormaliseAudio(deliverable.mixPath, deps.media, {
        out: again,
        loudness: mixTarget(inputs),
        bitrateKbps: inputs.preset.audio.bitrateKbps,
        samples,
        signal,
      });
      if (!renormalised.ok) return renormalised;
      deliverable.mixPath = again;
    }
    if (action === 'rerender') {
      await probe?.close();
      probe = null;
      const picture = await input.rerender();
      if (!picture.ok) return picture;
      deliverable.picture = picture.value;
      probe = await openProbe(input);
    }
    const refinished = await input.finish(action === 'reencode');
    if (!refinished.ok) return refinished;
    return input.afterFile ? input.afterFile() : ok(undefined);
  };
  try {
    return await runQaWithFixes({
      runQa: (only, previous) =>
        runQa({ ...qaInput(), ...(only ? { only } : {}), ...(previous ? { previous } : {}) }, qaContext),
      applyAuto,
      onStage: (status) => {
        stage.tracker.stage(status);
        input.setStatus(status);
      },
    });
  } finally {
    await probe?.close();
  }
}
