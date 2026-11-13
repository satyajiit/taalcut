// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What vision's stages share: their versions, and what a frame-reading stage passes its job about the file to
 * decode (IX-D3): normalise's plan, so the job doesn't probe again, and the proxy's key when the hardware profile
 * reads the proxy (frame-source-policy.ts). Every stage that reads frames passes the same, so their frames share the
 * asset's cache, and reads the same stages (`frameReads`).
 */
import type { AssetIndexView } from '@taalcut/core';
import { storedPlan, storedProxy } from '@taalcut/media';
import { VISION_CONFIG } from '../config';
import { frameInputFor, type FrameInput } from '../media/frame-source-policy';
import { MOTION_CONFIG } from '../motion/config';

/** The parts of the vision config that the stages' versions come from. */
export interface StageVersionConfig {
  readonly version: number;
  readonly shots: { readonly version: number };
  readonly profile: { readonly version: number };
  readonly ocr: { readonly version: number };
  readonly embed: { readonly version: number };
}

/**
 * What the coupling of round IX and IX2 added to the later stages' versions when dependent invalidation replaced it
 * (IX3-I3): the detector's version (`shotKeyed`, IX2-C5: analyse, embed, describe, embedOcr), the config's (embed,
 * describe) and the shots' and analysis's versions (`ocrVersion`, IX-O5: ocr), all at their values then. Kept in
 * the sums so that no version falls below what a library stored: the pipeline re-runs a stage whose version is
 * above the stored one, so a fall would hide the next rise. From here on these stages re-run when a stage they read
 * stores something else (their definitions' `reads`), not when that stage's version rises.
 */
const COUPLED_AT_IX3 = { analyse: 1, ocr: 6, embed: 2, describe: 1, embedOcr: 1 } as const;

/**
 * Each vision stage's version from the config. A rise in `VISION_CONFIG.version` (thresholds) re-runs shot
 * detection and the analysis; `shots.version` (the detector) re-runs detection; `profile.version` the analysis;
 * `ocr.version` and `embed.version` their own stage. A stage that reads one of them re-runs only when what it
 * stores changed (`vision.embed` and `vision.describe` after new shots or best frames, not after every rise).
 */
export function visionStageVersions(config: StageVersionConfig, motion: number = MOTION_CONFIG.version) {
  return {
    'vision.shots': config.version + config.shots.version,
    /** FRM1-MOT: + the camera estimator's version, so a new estimator measures every indexed shot again. */
    'vision.analyse': config.version + config.profile.version + COUPLED_AT_IX3.analyse + motion,
    /** +1 since LIB1-FIX: each shot's text is cleaned (ocr/clean.ts), so every asset's text is read again. */
    'vision.ocr': config.ocr.version + COUPLED_AT_IX3.ocr + 1,
    'vision.embed': config.embed.version + COUPLED_AT_IX3.embed,
    /**
     * Its own: raise it to describe every shot again (2 since LRN1-CTX: each shot with its context). 3 since
     * LIB1-FIND: what people are doing (actions). The rise also describes once more every shot an older build left
     * at `not_yet` while its model was still downloading (LIB1-FIX); since then such a description waits.
     */
    'vision.describe': 3 + COUPLED_AT_IX3.describe,
    /** Its own: raise it to embed every on-screen text again. */
    'vision.embedOcr': 1 + COUPLED_AT_IX3.embedOcr,
    /** Its own: raise it to rebuild every asset's contact sheet. */
    'vision.contactSheet': 1,
  } as const;
}

const VERSIONS = visionStageVersions(VISION_CONFIG);
export const SHOTS_VERSION = VERSIONS['vision.shots'];
export const ANALYSE_VERSION = VERSIONS['vision.analyse'];
export const OCR_VERSION = VERSIONS['vision.ocr'];
export const EMBED_VERSION = VERSIONS['vision.embed'];
export const DESCRIBE_VERSION = VERSIONS['vision.describe'];
export const EMBED_OCR_VERSION = VERSIONS['vision.embedOcr'];
export const CONTACT_SHEET_VERSION = VERSIONS['vision.contactSheet'];

/** The stages that read normalise's plan read the proxy too where the hardware profile reads it (`framesOf`). */
export function frameReads(preferred: FrameInput): string[] {
  return preferred === 'proxy' ? ['media.normalise', 'media.proxy'] : ['media.normalise'];
}

/** Normalise's plan for jobs that read frames, and the proxy's key when they read it. */
export function framesOf(view: AssetIndexView, preferred: FrameInput) {
  const plan = storedPlan(view);
  if (!plan) return {};
  // Only a stage that prefers the proxy reads (and declares it reads) media.proxy.
  const proxy = preferred === 'proxy' ? storedProxy(view) : undefined;
  const input = frameInputFor(preferred, { kind: plan.kind, rate: plan.frameRate.output }, proxy);
  return proxy && input === 'proxy' ? { plan, proxyKey: proxy.key } : { plan };
}
