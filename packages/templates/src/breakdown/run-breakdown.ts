// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * runBreakdown (P2-T4): the deterministic pipeline over the injected
 * analysers, in the `templates.breakdown` job (jobs process, gpu class). It
 * never calls a language or vision model; disputes go to the Analyst. Every
 * file it writes is inside the experiment and goes when the experiment is
 * discarded; the draft is also written there as breakdown.json.
 */
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  CancelledError,
  err,
  newId,
  ok,
  RationalTime,
  type AsyncResult,
  type BeatMap,
  type Canvas,
  type Clock,
  type JobProgress,
  type Result,
  type TextOverlayId,
  UnknownError,
} from '@taalcut/core';
import { NoVideo, ReferenceTooLong } from '../errors';
import { readReelSubjects } from './reel-subjects';
import type { ReferenceInputKind, ReferencePlatform } from '../types';
import { buildAudioProfile, envelopeWaveform } from './audio-profile';
import { measureCamera } from './camera';
import { BREAKDOWN_CONFIG, BREAKDOWN_PIPELINE_VERSION, type BreakdownConfig } from './config';
import { reelDoubts, tempoDoubt } from './doubts';
import { BREAKDOWN_FILE, breakdownDraftSchema, type BreakdownDraft } from './draft';
import { fileSha256 } from './fingerprint';
import { makeGraphicSheets } from './graphic-sheets';
import { shotChange, shotMotion } from './one-shot';
import { readOverlayDesigns } from './overlay-design';
import type { BreakdownAnalysers } from './ports';
import { transitionSignals, withoutFadeTails } from './signals';
import { gateSpeech } from './speech-gate';
import { findCuts, makeFrames, readText, type StepContext } from './steps';
import { judgeReadText } from './text-judge';
import { listenToReel } from './listening-stage';
import { classifyTransition, detectSpeedRamp } from './transitions';

export const BREAKDOWN_STAGE_KEYS = {
  preparing: 'jobs.stage.preparingReference',
  cuts: 'jobs.stage.findingCuts',
  beats: 'jobs.stage.trackingBeats',
  text: 'jobs.stage.readingText',
  speech: 'jobs.stage.transcribing',
  audio: 'jobs.stage.measuringAudio',
  listening: 'jobs.stage.listening',
  transitions: 'jobs.stage.findingTransitions',
  sheet: 'jobs.stage.makingContactSheet',
} as const;
type Stage = keyof typeof BREAKDOWN_STAGE_KEYS;
const STAGE_START: Record<Stage, number> = {
  preparing: 0,
  cuts: 0.15,
  beats: 0.45,
  text: 0.55,
  speech: 0.7,
  audio: 0.8,
  listening: 0.83,
  transitions: 0.86,
  sheet: 0.9,
};

/** The width the analysis copy is normalised to: 1280 px on the long side of a 9:16 reel, enough for OCR. */
const ANALYSIS_WIDTH = 720;

export interface BreakdownInput {
  /** The experiment's id: one breakdown per experiment. */
  readonly breakdownId: string;
  /** A download inside the experiment, or the user's own file, read in place and never changed. */
  readonly referencePath: string;
  readonly input: ReferenceInputKind;
  readonly platform: ReferencePlatform | null;
  readonly url: string | null;
  readonly sound?: { readonly title: string | null; readonly artist: string | null } | null;
  readonly fingerprint?: string;
}

export interface BreakdownDeps extends BreakdownAnalysers {
  /** The experiment folder (absolute): every file the pipeline writes goes here. */
  readonly experimentDir: string;
  readonly clock: Clock;
  readonly config?: BreakdownConfig;
  readonly newOverlayId?: () => TextOverlayId;
  readonly log?: (message: string) => void;
}

const even = (value: number) => Math.max(16, Math.min(8192, Math.round(value / 2) * 2));

export async function runBreakdown(
  input: BreakdownInput,
  deps: BreakdownDeps,
  options: { readonly signal: AbortSignal; readonly progress?: (progress: JobProgress) => void },
): AsyncResult<BreakdownDraft> {
  const config = deps.config ?? BREAKDOWN_CONFIG;
  const { signal } = options;
  const warnings: string[] = [];
  const warn = (warning: string) => {
    warnings.push(warning);
    deps.log?.(`[breakdown] ${warning}`);
  };
  const stage = (name: Stage) => {
    options.progress?.({ fraction: STAGE_START[name], stageKey: BREAKDOWN_STAGE_KEYS[name] });
    return signal.aborted ? err(CancelledError()) : ok(undefined);
  };
  /** Optional steps: a failure is a warning, the breakdown goes on without that part. */
  const optional = <T>(name: string, result: Result<T>): T | null => {
    if (result.ok) return result.value;
    warn(`${name}_failed: ${result.error.code}`);
    return null;
  };

  let step: Result<undefined> = stage('preparing');
  if (!step.ok) return step;
  const fingerprint = input.fingerprint
    ? ok(input.fingerprint)
    : await fileSha256(input.referencePath, signal);
  if (!fingerprint.ok) return fingerprint;
  const probe = await deps.media.probe(input.referencePath, { signal });
  if (!probe.ok) return probe;
  const source = probe.value;
  if (!source.hasVideo) return err(NoVideo());
  const seconds = RationalTime.toSeconds(source.duration);
  if (seconds > config.reference.maxSeconds) return err(ReferenceTooLong({ seconds: Math.round(seconds) }));
  const crop =
    input.input === 'screenRecording' && deps.media.detectCrop
      ? optional('crop', await deps.media.detectCrop(input.referencePath, { signal }))
      : null;
  const frameWidth = crop?.width ?? source.width;
  const frameHeight = crop?.height ?? source.height;
  const canvasWidth = config.reference.canvasWidth;
  const canvas: Canvas = {
    width: canvasWidth,
    height: even((canvasWidth * frameHeight) / frameWidth),
    rate: source.rate,
  };
  const rate = source.rate;
  const normalised = await deps.media.normalise(input.referencePath, {
    outPath: join(deps.experimentDir, 'normalised.mp4'),
    rate,
    width: Math.min(ANALYSIS_WIDTH, canvasWidth),
    crop,
    signal,
  });
  if (!normalised.ok) return normalised;
  const total = Math.max(1, normalised.value.frames);
  const ctx: StepContext = {
    path: normalised.value.path,
    dir: deps.experimentDir,
    rate,
    total,
    analysers: deps,
    config,
    signal,
  };

  step = stage('cuts');
  if (!step.ok) return step;
  const cuts = await findCuts(ctx);
  if (!cuts.ok) return cuts;
  const confirmed = cuts.value.findings.filter((finding) => finding.status === 'confirmed');
  // BRK1: a fade's tail is the shot before it, not a shot (one-shot.ts).
  const { kept: disputed, fades } = await withoutFadeTails(
    ctx,
    confirmed,
    cuts.value.findings.filter((finding) => finding.status === 'disputed'),
  );
  const shotBounds = [
    0,
    ...[...confirmed, ...disputed.filter((d) => d.ruleKeeps)].map((f) => f.frame).sort((a, b) => a - b),
    total,
  ];
  const shots = shotBounds
    .slice(0, -1)
    .map((start, i) => ({ start, end: shotBounds[i + 1]! }))
    .filter((s) => s.end > s.start);
  // EAR1-C1: the reel's sound against every candidate cut, heard beside the subjects, beats, text and speech, which
  // wait on other processes; its beat offsets are from earshot's own grid (listening-stage.ts).
  const listening = listenToReel(deps.audio, {
    path: input.referencePath,
    cuts: [...confirmed, ...disputed].map((finding) => finding.frame),
    rate,
    beatMap: null,
    hasAudio: source.hasAudio,
    signal,
    ...(deps.log ? { log: deps.log } : {}),
  });
  // FRM1-SUB: where people are in the reel, for placing graphics as the reel did (reel-subjects.ts).
  const subjects = optional('subjects', await readReelSubjects(ctx));

  step = stage('beats');
  if (!step.ok) return step;
  const beats = source.hasAudio ? optional('beats', await deps.audio.beats(ctx.path, { signal })) : null;
  const beatMap: BeatMap | null = beats?.beatMap && beats.beatMap.beats.length > 0 ? beats.beatMap : null;
  if (beatMap && beatMap.confidence < config.beats.minConfidence) warn('low_beat_confidence');

  step = stage('text');
  if (!step.ok) return step;
  const read = optional(
    'text',
    await readText(ctx, {
      screenRecording: input.input === 'screenRecording',
      newId: deps.newOverlayId ?? (() => newId<'TextOverlay'>()),
    }),
  );
  for (const warning of read?.warnings ?? []) warn(warning);
  // FIX-SIGN: only text added in editing is an overlay; each reading is weighed composited or scene (text-judge.ts).
  const sceneText =
    read &&
    (await judgeReadText(ctx, read, {
      cuts: shotBounds.slice(1, -1),
      aspect: canvas.width / canvas.height,
      subjects: null,
    }));
  for (const warning of sceneText?.warnings ?? []) warn(warning);
  const judged = sceneText && { overlays: sceneText.overlays, warnings: [] };
  // BRK1-GFX: how each kept overlay is drawn, read from the reel's frames (overlay-design.ts).
  const text =
    judged && (optional('overlay_design', await readOverlayDesigns(ctx, judged.overlays)) ?? judged);
  if (text !== judged) for (const warning of text?.warnings ?? []) warn(warning);
  const overlays = text?.overlays ?? [];
  // DSG1-READ: a picture of each kept overlay's life, for the brief the breakdown tool writes after the job.
  const leads = text && 'leads' in text ? text.leads : {};
  const sheets = optional('graphic_sheets', await makeGraphicSheets(ctx, overlays, leads));
  for (const warning of sheets?.warnings ?? []) warn(warning);
  // FRM1-MOT: the camera's move between every candidate cut, measured; each slot's is read from it (camera.ts).
  const measuring = measureCamera(ctx, {
    cuts: [...confirmed, ...disputed].map((finding) => finding.frame),
    fades,
    overlays,
    subjects: null,
  }).catch((cause: unknown) => err(UnknownError(undefined, { detail: String(cause) })));

  step = stage('speech');
  if (!step.ok) return step;
  const heard =
    source.hasAudio && deps.audio.transcribe
      ? optional('speech', await deps.audio.transcribe(ctx.path, { signal }))
      : null;
  // BRK1: the speech gate rejects what Whisper wrote over music that nobody said (speech-gate.ts).
  const voice =
    heard && heard.segments.length > 0 && deps.audio.voiceActivity
      ? optional('voice', await deps.audio.voiceActivity(ctx.path, { signal }))
      : null;
  const music = beatMap !== null && beatMap.confidence >= config.audio.musicBeatConfidence;
  const gated = gateSpeech(heard?.segments ?? [], { music, voice }, config.speech);
  if (gated.rejected > 0) warn(`speech_rejected: ${gated.rejected}`);
  const speech = heard && gated.kept.length > 0 ? { language: heard.language, segments: gated.kept } : null;

  step = stage('audio');
  if (!step.ok) return step;
  const [loudnessResult, waveformResult] = source.hasAudio
    ? await Promise.all([
        deps.audio.loudness(ctx.path, { signal }),
        beats?.envelope?.peaks
          ? Promise.resolve(null)
          : deps.audio.waveformPeaks
            ? deps.audio.waveformPeaks(ctx.path, { rate: { num: 50, den: 1 }, signal })
            : Promise.resolve(null),
      ])
    : [null, null];
  const loudness = loudnessResult ? optional('loudness', loudnessResult) : null;
  // The tracker's envelope is onset strength in its own units: scaled to its loudest frame, not clamped flat.
  const peaks = beats?.envelope?.peaks
    ? envelopeWaveform(beats.envelope.peaks)
    : waveformResult
      ? optional('waveform', waveformResult)
      : null;

  step = stage('listening');
  if (!step.ok) return step;
  const listened = await listening;
  if (listened.warning) warn(listened.warning);

  step = stage('transitions');
  if (!step.ok) return step;
  const signals = await transitionSignals(ctx, disputed, shots, cuts.value.scores);
  // FRM1-MOT: started beside speech and audio, which wait on other processes.
  const camera = optional('camera', await measuring);

  step = stage('sheet');
  if (!step.ok) return step;
  const frames = await makeFrames(ctx, { shots, disputes: disputed.map((d) => d.frame), canvas });
  if (!frames.ok) return frames;

  const fps = RationalTime.toFrames(RationalTime.fromSeconds(1, rate), rate);
  const ramps = shots.flatMap((shot) => {
    const ramp = detectSpeedRamp(shot, signals.motion, signals.diff, fps, config.ramp);
    return ramp
      ? [{ start: shot.start, end: shot.end, points: [...ramp.points], confidence: ramp.confidence }]
      : [];
  });
  const durationMs = (total * rate.den * 1000) / rate.num;
  const segments = speech?.segments ?? [];
  const draft = breakdownDraftSchema.parse({
    breakdownId: input.breakdownId,
    pipelineVersion: BREAKDOWN_PIPELINE_VERSION,
    configVersion: config.version,
    fingerprint: fingerprint.value,
    analysedAt: deps.clock.now(),
    reference: {
      input: input.input,
      platform: input.platform,
      url: input.url,
      sound: input.sound ?? null,
      source: {
        duration: source.duration,
        rate: source.rate,
        width: source.width,
        height: source.height,
        hasAudio: source.hasAudio,
      },
      crop,
    },
    canvas,
    duration: RationalTime.of(total, rate),
    cuts: confirmed.map((finding) => ({
      frame: finding.frame,
      method: finding.method,
      score: finding.score,
      distance: finding.distance,
      transition: null,
    })),
    disputes: disputed.map((finding) => ({
      frame: finding.frame,
      method: finding.method,
      score: finding.score,
      distance: finding.distance,
      transition: finding.ramp
        ? classifyTransition(
            { frame: finding.frame, ...finding.ramp, distance: finding.distance ?? 0 },
            { luma: signals.luma, motion: signals.motion },
            config,
          )
        : null,
      ramp: finding.ramp,
      ruleKeeps: finding.ruleKeeps,
      ...frames.value.disputeFrames.get(finding.frame)!,
    })),
    beatMap,
    text: overlays,
    ...(sceneText ? { textRegions: sceneText.regions } : {}),
    audio: buildAudioProfile({
      integratedLufs: loudness?.integratedLufs ?? null,
      beatMap,
      speech: speech ? { language: speech.language, segments } : null,
      peaks,
      sound: input.sound ?? null,
      durationMs,
      config: config.audio,
      listening: listened.listening,
    }),
    language: speech?.language ?? overlays.find((overlay) => overlay.language)?.language ?? null,
    ramps,
    // BRK1 moves: how fast the camera moves through each provisional slot and how far its picture travels, before
    // any fade it ends in.
    slotFrames: frames.value.slotFrames.map((slot) => {
      const fadeFrom = fades.find((frame) => frame > slot.start && frame < slot.end);
      const change = shotChange(cuts.value.vectors, slot, fadeFrom);
      const motion = shotMotion(signals.motion, slot, fadeFrom);
      return {
        ...slot,
        ...(change === null ? {} : { change: Math.min(2, Math.max(0, change)) }),
        ...(motion === null ? {} : { motion: Math.min(100, Math.max(0, motion)) }),
      };
    }),
    ...(camera ? { camera } : {}),
    ...(sheets && sheets.sheets.length > 0 ? { graphicSheets: sheets.sheets } : {}),
    contactSheet: frames.value.sheet ? { ...frames.value.sheet, mediaType: 'image/jpeg' } : null,
    warnings: warnings.slice(0, 50),
    ...(subjects ? { subjects } : {}),
    doubts: reelDoubts({
      tempo: tempoDoubt(beatMap, beats?.envelope ?? null, config),
      speech: gated.doubt,
      linked: input.input === 'link',
      hasAudio: source.hasAudio,
      sound: input.sound ?? null,
    }),
  });
  await writeFile(join(deps.experimentDir, BREAKDOWN_FILE), JSON.stringify(draft));
  options.progress?.({ fraction: 1, stageKey: BREAKDOWN_STAGE_KEYS.sheet });
  return ok(draft);
}
