// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What the clip page's facts column says, worked out from the library's detail before any words are chosen:
 * the frame rate as a number, the camera's name, where it was filmed, the sound, and how far Taalcut has got
 * looking at it. Words and number formats are the components' (Lingui and Intl); this file only decides.
 */
import type { AssetDetail, MediaFacts } from '@taalcut/core';
import { MODEL_MISSING_REASON } from '../../downloads/stage-models';

type Stage = AssetDetail['stages'][number];

/** Frames per second, to two decimals at most: 30000/1001 is 29.97. */
export function framesPerSecond(rate: { num: number; den: number }): number {
  return Math.round((rate.num / rate.den) * 100) / 100;
}

/** "Apple iPhone 16 Pro"; the model alone when it already names its maker ("Pixel 9" made by Google stays). */
export function cameraName(device: MediaFacts['device']): string | null {
  const make = device?.make?.trim() ?? '';
  const model = device?.model?.trim() ?? '';
  if (!model) return make || null;
  if (!make || model.toLowerCase().startsWith(make.toLowerCase())) return model;
  return `${make} ${model}`;
}

export interface Coordinates {
  readonly latitude: number;
  readonly longitude: number;
  readonly north: boolean;
  readonly east: boolean;
}

/** Degrees without their sign, and which side of the equator and meridian. */
export function coordinatesOf(location: MediaFacts['location']): Coordinates | null {
  if (!location) return null;
  return {
    latitude: Math.abs(location.latitude),
    longitude: Math.abs(location.longitude),
    north: location.latitude >= 0,
    east: location.longitude >= 0,
  };
}

export type SoundKind = 'speech' | 'sound' | 'silent' | 'unknown';

/**
 * What can be heard: speech in a language, sound without speech, nothing at all; unknown until the clip was
 * prepared (no facts yet) or while its speech is still to be listened to.
 */
export function soundOf(detail: AssetDetail): SoundKind {
  // LIB1-LANG: speech whose language Taalcut couldn't place is still speech, and so is a clip it heard before whose
  // language it is deciding again.
  if (detail.asset.language || detail.asset.speech || detail.asset.languagePending) return 'speech';
  if (detail.facts && !detail.facts.hasAudio) return 'silent';
  const listening = detail.stages.some(
    (stage) => stage.stage.startsWith('audio.') && stage.state !== 'done' && stage.state !== 'skipped',
  );
  if (!detail.facts || listening) return 'unknown';
  return 'sound';
}

export type AnalysisPhase = 'complete' | 'running' | 'waiting' | 'waitingForModels' | 'failed';

export interface ModelWait {
  /** The stages held for a model. */
  readonly held: readonly Stage[];
  /** The stages that start after them: waiting with no reason of their own. */
  readonly behind: readonly Stage[];
  /** A listening step waits (the speech model). */
  readonly speech: boolean;
  /** Reading the text on screen waits (the on-screen text model, PP-OCR; UX3-IDX). */
  readonly text: boolean;
  /** A looking step waits (the search model: search, and a description held with it). */
  readonly search: boolean;
  /**
   * Only the description waits for its model (LIB1-FIX: Qwen3.5 4B and its runtime): no embedding step is held, so the
   * search model is here. Never with `search`.
   */
  readonly describe: boolean;
}

/** The steps that embed for search: held, they wait for the search model, and a held description with them. */
const EMBED_STAGES: ReadonlySet<string> = new Set(['vision.embed', 'vision.embedText', 'vision.embedOcr']);

const DESCRIBE_STAGE = 'vision.describe';
/** A looking step: not a listening one, nor reading the text on screen. */
const looking = (stage: Stage) => !stage.stage.startsWith('audio.') && stage.stage !== 'vision.ocr';

/** What waits for an on-device model, if anything does. */
export function modelWaitOf(stages: AssetDetail['stages']): ModelWait | null {
  const held = stages.filter(
    (stage) => stage.state === 'waiting' && stage.reasonKey === MODEL_MISSING_REASON,
  );
  if (held.length === 0) return null;
  const embedding = held.some((stage) => EMBED_STAGES.has(stage.stage));
  return {
    held,
    behind: stages.filter(
      (stage) => (stage.state === 'waiting' || stage.state === 'queued') && !stage.reasonKey,
    ),
    speech: held.some((stage) => stage.stage.startsWith('audio.')),
    text: held.some((stage) => stage.stage === 'vision.ocr'),
    // A held description waits for the search model while an embedding step waits too (stage-models.ts names the
    // same model); alone, for the model that describes.
    search: embedding || held.some((stage) => looking(stage) && stage.stage !== DESCRIBE_STAGE),
    describe: !embedding && held.some((stage) => stage.stage === DESCRIBE_STAGE),
  };
}

export interface Analysis {
  readonly phase: AnalysisPhase;
  /** Stages finished, skipped ones included: they needed nothing more. */
  readonly settled: number;
  readonly total: number;
  /** Search already finds the clip while deeper analysis carries on (round IX). */
  readonly searchable: boolean;
  /** The stage that runs now, if one does. */
  readonly now: Stage | null;
  /** The stage that failed, if one did. */
  readonly failed: Stage | null;
  /** Why the next stage waits (an i18n key), when the library says. */
  readonly waitingFor: string | null;
  /** The steps held for on-device models, whatever else runs. */
  readonly models: ModelWait | null;
}

/** How far Taalcut has got looking at a clip, from its stage rows (falling back on the summary's counts). */
export function analysisOf(detail: AssetDetail): Analysis {
  const { stages, asset } = detail;
  const failed = stages.find((stage) => stage.state === 'failed') ?? null;
  const now = stages.find((stage) => stage.state === 'running') ?? null;
  const settled = stages.filter((stage) => stage.state === 'done' || stage.state === 'skipped').length;
  const total = stages.length > 0 ? stages.length : asset.index.total;
  const waiting = stages.find((stage) => stage.state === 'waiting' || stage.state === 'queued') ?? null;
  const searchable = (asset.index.searchableAt ?? null) !== null;
  const models = modelWaitOf(stages);
  const phase: AnalysisPhase = failed
    ? 'failed'
    : stages.length > 0
      ? settled === stages.length
        ? 'complete'
        : now
          ? 'running'
          : models
            ? 'waitingForModels'
            : 'waiting'
      : asset.index.state === 'done'
        ? 'complete'
        : asset.index.state === 'failed'
          ? 'failed'
          : 'running';
  return {
    phase,
    settled: stages.length > 0 ? settled : asset.index.done,
    total,
    searchable,
    now,
    failed,
    waitingFor: phase === 'waiting' ? (waiting?.reasonKey ?? null) : null,
    models,
  };
}

/** Is a stage still to finish (not done, not skipped)? Used to say "not yet" rather than "none". */
export function pending(detail: AssetDetail, prefix: string): boolean {
  return detail.stages.some(
    (stage) => stage.stage.startsWith(prefix) && stage.state !== 'done' && stage.state !== 'skipped',
  );
}

/** Why a part of the clip is empty, when the library skipped the stage that makes it (an i18n key). */
export function skipReason(detail: AssetDetail, stage: string): string | null {
  const row = detail.stages.find((candidate) => candidate.stage === stage);
  return row?.state === 'skipped' ? (row.reasonKey ?? null) : null;
}
