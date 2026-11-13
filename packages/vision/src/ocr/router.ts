// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Routes OCR by language (SPEC "Routing"): Latin languages to Apple Vision,
 * Hindi to PP-OCRv5 Devanagari, both on every frame when both are asked for
 * (Hinglish reels), merged by box. Vision has no CPU twin: when the helper
 * fails, a Latin frame is an error, never a silent PP-OCR call, and so is
 * `capabilities()`. A macOS whose
 * Vision lists Hindi takes Hindi too, with no code change (capabilities()).
 * Where there is no Apple Vision (Windows, IX-O7) the PP-OCRv5 Latin engine
 * takes Vision's place; on a Mac with Vision it is never used.
 */
import { CancelledError, err, ok, type AsyncResult, type Result, type TextScript } from '@taalcut/core';
import { VISION_CONFIG } from '../config';
import { OcrUnavailable } from '../errors';
import { baseLanguage, boxIou } from './text';
import type {
  OcrCapabilities,
  OcrEngine,
  OcrFrame,
  OcrObservation,
  OcrPage,
  OcrRecognizeOptions,
} from './types';

export interface RoutedOcrEngines {
  /** Apple Vision through the mac helper (macOS). */
  readonly vision?: OcrEngine;
  /** PP-OCRv5 Devanagari, when its component is installed. */
  readonly devanagari?: OcrEngine;
  /** PP-OCRv5 Latin, where there is no Apple Vision (IX-O7). */
  readonly latin?: OcrEngine;
}

interface Plan {
  readonly vision: readonly string[];
  readonly devanagari: readonly string[];
}

interface Engines {
  /** The primary Latin engine: Vision, else PP-OCR Latin. */
  readonly vision: OcrEngine | undefined;
  /** PP-OCR Latin fallback when Vision is present and fails. */
  readonly latin: OcrEngine | undefined;
  readonly devanagari: OcrEngine | undefined;
}

async function capabilitiesOf(engine: OcrEngine | undefined): Promise<OcrCapabilities | null> {
  if (!engine) return null;
  const result = await engine.capabilities();
  return result.ok ? result.value : null;
}

/** Which languages each engine reads: Vision first for any language it lists, Hindi included on an OS that adds it. */
async function planRoute(engines: Engines, languages: readonly string[]): AsyncResult<Plan> {
  const visionCaps = await capabilitiesOf(engines.vision);
  const devaCaps = await capabilitiesOf(engines.devanagari);
  const visionServes = new Set((visionCaps?.languages ?? []).map(baseLanguage));
  const devaServes = new Set((devaCaps?.languages ?? []).map(baseLanguage));
  const vision: string[] = [];
  const devanagari: string[] = [];
  for (const language of new Set(languages.map(baseLanguage))) {
    if (visionServes.has(language)) vision.push(language);
    else if (devaServes.has(language)) devanagari.push(language);
    else if (language === 'hi' && engines.devanagari) devanagari.push(language);
    else if (language !== 'hi' && engines.vision && !visionCaps) vision.push(language);
    else return err(OcrUnavailable({ language }));
  }
  return ok({ vision, devanagari });
}

/** One engine's pages for its languages; undefined when it has none to read or isn't there. */
async function readWith(
  engine: OcrEngine | undefined,
  frames: readonly OcrFrame[],
  languages: readonly string[],
  options: Omit<OcrRecognizeOptions, 'languages'>,
): Promise<Result<OcrPage[]> | undefined> {
  return engine ? engine.recognize(frames, { ...options, languages }) : undefined;
}

/**
 * Both engines' languages and scripts. Every read needs the Latin reader (Vision, or PP-OCR Latin without it): when
 * it can't start, that is the answer, so a dead helper fails the read instead of reading no language (IX-F3). A
 * Devanagari engine that isn't there only takes Hindi off the list: its component is optional.
 */
async function routedCapabilities(engines: Engines): AsyncResult<OcrCapabilities> {
  const latin = engines.vision ? await engines.vision.capabilities() : undefined;
  if (latin && !latin.ok) return latin;
  const caps = [latin?.value ?? null, await capabilitiesOf(engines.devanagari)].filter(
    (c): c is OcrCapabilities => c !== null,
  );
  const scripts = new Set<TextScript>(caps.flatMap((c) => c.scripts));
  const languages = new Set(caps.flatMap((c) => c.languages));
  return ok({ scripts: [...scripts], languages: [...languages] });
}

/** The frames read by each engine for its languages, merged frame by frame. */
async function routedRecognize(
  engines: Engines,
  frames: readonly OcrFrame[],
  { languages, signal, meter }: OcrRecognizeOptions,
): AsyncResult<OcrPage[]> {
  if (signal?.aborted) return err(CancelledError());
  if (frames.length === 0) return ok([]);
  // No languages: Vision's own default set (en, es, pt).
  const route =
    languages.length === 0 ? ok({ vision: [], devanagari: [] }) : await planRoute(engines, languages);
  if (!route.ok) return route;
  const useVision = languages.length === 0 || route.value.vision.length > 0;
  if (useVision && !engines.vision) return err(OcrUnavailable({ language: route.value.vision[0] ?? 'en' }));
  const options = { ...(signal ? { signal } : {}), ...(meter ? { meter } : {}) };
  // Both engines at once (IX3-O2): Vision reads in the mac helper (Neural Engine and CPU), PP-OCR on the GPU in
  // this process, and neither page depends on the other, so a Hindi read takes the longer of the two, not the sum.
  const [visionPages, devaPages] = await Promise.all([
    useVision ? readWith(engines.vision, frames, route.value.vision, options) : undefined,
    route.value.devanagari.length > 0
      ? readWith(engines.devanagari, frames, route.value.devanagari, options)
      : undefined,
  ]);
  let latinPages = visionPages;
  if (latinPages && !latinPages.ok && engines.latin && route.value.vision.length > 0) {
    const fallback = await readWith(engines.latin, frames, route.value.vision, options);
    if (fallback?.ok) latinPages = fallback;
  }
  if (latinPages?.ok && devaPages && !devaPages.ok) return latinPages;
  if (devaPages?.ok && latinPages && !latinPages.ok) return devaPages;
  if (latinPages && !latinPages.ok) return latinPages;
  if (devaPages && !devaPages.ok) return devaPages;
  return ok(combine(frames, latinPages?.value, devaPages?.value));
}

export function createRoutedOcr(routed: RoutedOcrEngines): OcrEngine {
  const engines: Engines = {
    vision: routed.vision ?? routed.latin,
    latin: routed.vision ? routed.latin : undefined,
    devanagari: routed.devanagari,
  };
  return {
    capabilities: () => routedCapabilities(engines),
    recognize: (frames, options) => routedRecognize(engines, frames, options),

    async close() {
      await routed.vision?.close?.();
      await routed.latin?.close?.();
      await routed.devanagari?.close?.();
    },
  };
}

/** Both engines' pages frame by frame, or whichever one read. */
function combine(
  frames: readonly OcrFrame[],
  vision: readonly OcrPage[] | undefined,
  deva: readonly OcrPage[] | undefined,
): OcrPage[] {
  if (!vision) return [...(deva ?? [])];
  if (!deva) return [...vision];
  return frames.map((frame, i) => mergePages(frame.index, vision[i], deva[i]));
}

/**
 * Merges one frame's pages by box. Where boxes overlap (IoU ≥ mergeIou) the
 * PP-OCR reading wins when it is Devanagari, else Vision's. A low-confidence
 * Vision reading over any Devanagari box is Vision misreading Hindi as Latin,
 * and is dropped. The Devanagari engine adds only Devanagari: the Latin
 * reader (Vision, or PP-OCR Latin without it) read the frame for Latin and
 * digits, and the Devanagari model's own Latin where that reader saw nothing
 * was texture read as text (ix-v1's Hindi clips: 64 such tracks, no real one).
 */
export function mergePages(frame: number, vision: OcrPage | undefined, deva: OcrPage | undefined): OcrPage {
  const { mergeIou, visionGarbageConfidence } = VISION_CONFIG.ocr;
  const devanagari = (deva?.observations ?? []).filter((o) => o.script === 'devanagari');
  const kept: OcrObservation[] = [...devanagari];
  for (const observation of vision?.observations ?? []) {
    const overDeva = devanagari.some((d) => boxIou(d.box, observation.box) > 0);
    if (overDeva && observation.confidence < visionGarbageConfidence) continue;
    if (devanagari.some((d) => boxIou(d.box, observation.box) >= mergeIou)) continue;
    kept.push(observation);
  }
  kept.sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x);
  return { frame, observations: kept };
}
