// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * One export's stages (SPEC section 4, P3.11): preflight, reframing, conform (with the grade), compose,
 * capture and encode, mix, finish, signing, QA with its automatic fixes, then finalizeRender (QA passed or
 * overridden) or needsAttention. Each stage lives in engine/stages; this file runs them in order. The caller
 * (export-run.ts) owns cancellation, attempts and the final status events. Content Credentials are decided
 * before anything renders, so an export that must be signed and can't be stops before the long part.
 */
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CancelledError, err, type AsyncResult, type QaReport, type RenderRecord } from '@taalcut/core';
import { toSrt, toVtt } from '../captions/subtitles';
import { finalizeRender, markNeedsAttention } from '../qa/finalize';
import { preflightPassed } from '../qa/run-preflight';
import { DELIVERABLE_VERDICTS, verdictOf } from '../qa/verdict';
import { renderDestination, renderWorkFile, renderWorkSidecar } from '../store/paths';
import { workspaceOf } from '../workspace/fold/workspace-of';
import { gatherExport, type ExportInputs } from './export-inputs';
import { finishRender } from './finish';
import { checkRender, type Deliverable } from './stages/checking';
import type { StageContext } from './stages/context';
import { framedVisuals, planFraming, type PlannedFraming } from './stages/framing';
import { planExportHeads } from './stages/heads';
import { gradeAfterConform, hasGrade, planGrading } from './stages/grading';
import { renderPicture, type PictureExtras } from './stages/picture';
import { qaFacts } from './stages/qa-facts';
import { planSigning } from './stages/signing';
import { mixSound } from './stages/sound';
import type { ExportStage } from './progress';

export type { StageContext } from './stages/context';
export { mixTarget } from './stages/sound';

/** A report of the preflight checks alone: they failed, so nothing was rendered. */
export function preflightReport(
  record: RenderRecord,
  round: number,
  checks: ExportInputs['preflight'],
  at: number,
): QaReport {
  return {
    version: 1,
    renderId: record.id,
    round,
    verdict: verdictOf(checks, []),
    presetId: record.presetId,
    checks: [...checks],
    overrides: [],
    createdAt: at,
  };
}

async function sidecarFiles(stage: StageContext, inputs: ExportInputs) {
  const track = inputs.plan.captions;
  if (!track || stage.record.captions.sidecars.length === 0) return [];
  const files = [];
  for (const format of stage.record.captions.sidecars) {
    const from = renderWorkSidecar(stage.deps.folders, stage.record.id, format);
    await writeFile(from, format === 'srt' ? toSrt(track, inputs.plan.rate) : toVtt(track, inputs.plan.rate));
    files.push({
      from,
      to: renderDestination(stage.deps.folders, stage.record.projectId, stage.record.id, format),
    });
  }
  return files;
}

/** What the composition draws besides the timeline itself: the Style and its bumpers (P3-V10), the framing. */
function pictureExtras(
  inputs: ExportInputs,
  framing: PlannedFraming | null,
  workspaceRoot: string | undefined,
): PictureExtras {
  const { style, bumpers, brandAssets } = inputs.styled;
  return {
    compose: {
      style,
      bumpers,
      brandAssets: (sha256) => brandAssets.get(sha256),
      ...(framing ? framing.compose : {}),
      ...workspaceOf(workspaceRoot, inputs.timeline.projectId),
    },
    ...(framing ? { geometry: framing.geometry } : {}),
  };
}

/** The optional stages this export runs (the progress bar renormalises around the rest). */
function activeStages(inputs: ExportInputs, signs: boolean): ExportStage[] {
  return [
    ...(framedVisuals(inputs).length > 0 ? (['reframing'] as const) : []),
    ...(hasGrade(inputs) ? (['grading'] as const) : []),
    ...(signs ? (['signing'] as const) : []),
  ];
}

export async function runStages(
  stage: StageContext,
  setStatus: (status: 'rendering' | 'checking' | 'fixing') => Promise<void>,
): AsyncResult<RenderRecord> {
  const { deps, record, tracker, signal, workDir } = stage;
  await setStatus('rendering');
  tracker.stage('preflight');
  const gathered = await gatherExport(deps, record);
  if (!gathered.ok) return gathered;
  const inputs = gathered.value;
  if (signal.aborted) return err(CancelledError());
  if (!preflightPassed(inputs.preflight))
    return markNeedsAttention(deps, {
      renderId: record.id,
      report: preflightReport(record, inputs.round, inputs.preflight, deps.clock.now()),
    });
  const chrome = await deps.shell();
  if (!chrome.ok) return chrome;

  const signing = await planSigning(stage, inputs);
  if (!signing.ok) return signing;
  tracker.plan(activeStages(inputs, signing.value.add));
  const framing = await planFraming(stage, inputs);
  if (!framing.ok) return framing;
  // FRM1-OVL: every clip's heads on the canvas, for graphics to keep out of and QA to check against.
  const heads = await planExportHeads(stage, inputs, framing.value);
  if (!heads.ok) return heads;
  const grading = await planGrading(stage, inputs);
  if (!grading.ok) return grading;
  for (const warning of [...(framing.value?.warnings ?? []), ...grading.value.warnings])
    deps.log?.(`[render] ${warning}`);
  const applier = grading.value.cubes.size > 0 ? ((await deps.cubeApplier?.()) ?? null) : null;
  const afterConform = gradeAfterConform(stage, inputs, grading.value, applier);
  const picture0 = pictureExtras(inputs, framing.value, deps.workspaceRoot);
  const extras: PictureExtras = {
    ...picture0,
    compose: { ...picture0.compose, keepOut: heads.value.keepOut },
    ...(afterConform ? { afterConform } : {}),
  };
  const picture = await renderPicture(stage, inputs, chrome.value, extras);
  if (!picture.ok) return picture;
  tracker.stage('mixingAudio');
  const mixPath = join(workDir, 'mix.m4a');
  const mixed = await mixSound(stage, inputs, picture.value, mixPath);
  if (!mixed.ok) return mixed;
  const deliverable: Deliverable = { picture: picture.value, mixPath };
  tracker.stage('finishing');
  const out = renderWorkFile(deps.folders, record.id);
  const finish = (reencode = false) =>
    finishRender({
      video: deliverable.picture.video,
      audio: deliverable.mixPath,
      out,
      preset: inputs.preset,
      rate: inputs.plan.rate,
      ctx: deps.media,
      reencode,
      signal,
      onFallback: stage.fallback,
    });
  const finished = await finish();
  if (!finished.ok) return finished;
  deps.log?.(`[render] finishing: picture ${finished.value.video}`);
  const signed = await signing.value.sign(out);
  if (!signed.ok) return signed;

  const report = await checkRender({
    stage,
    inputs,
    chromePath: chrome.value,
    out,
    deliverable,
    extras,
    rerender: () => renderPicture(stage, inputs, chrome.value, extras),
    finish,
    afterFile: () => signing.value.sign(out),
    qa: {
      facts: qaFacts({
        inputs,
        framing: framing.value,
        heads: heads.value,
        voiceOverMusic: mixed.value.voiceOverMusic,
        signing: signing.value,
        ...(deps.listener ? { listener: deps.listener, jobId: record.jobId, file: out, signal } : {}),
      }),
    },
    setStatus: (status) => void setStatus(status),
  });
  if (!report.ok) return report;
  if (!DELIVERABLE_VERDICTS.has(report.value.verdict))
    return markNeedsAttention(deps, { renderId: record.id, report: report.value });
  return finalizeRender(
    { store: deps.store, clock: deps.clock },
    {
      renderId: record.id,
      workFile: out,
      destination: renderDestination(deps.folders, record.projectId, record.id),
      report: report.value,
      sidecars: await sidecarFiles(stage, inputs),
    },
  );
}
