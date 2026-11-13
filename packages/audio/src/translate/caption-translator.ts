// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A timeline's captions in another language (P3-V20, SPEC P3.11): cues grouped into sentence units, translated
 * through core's TextTranslator (models; on-device under Local only), checked so every unit comes back exactly
 * once, shared back over the source cues on their timing, and a unit whose cue runs over 1.3× its source graphemes
 * sent back once for a shorter line. The result is `captions.applyTranslation`'s payload: render's handler picks
 * the font for the script, breaks the lines and times the words, and its QA checks overflow on the next draft.
 */
import {
  CAPTION_COMMANDS,
  captionCommandPayloads,
  err,
  NotFoundError,
  ok,
  ValidationError,
  type AppLocale,
  type AsyncResult,
  type GenerationTrace,
  type TextTranslator,
  type Timeline,
  type TranslationUnit,
  type TranslationUsage,
} from '@taalcut/core';
import { z } from 'zod';
import { TRANSLATE_CONFIG } from './config';
import { TranslationFailed, TranslationMismatch } from './errors';
import { graphemeCount, shareUnit, type CueText } from './retime';
import { captionUnits, cueText, unitBatches, type SourceUnit } from './units';

const applyPayload = captionCommandPayloads[CAPTION_COMMANDS.applyTranslation];
export type ApplyTranslationPayload = z.output<typeof applyPayload>;

export interface CaptionTranslatorDeps {
  readonly translator: TextTranslator;
}

export interface CaptionTranslationRequest {
  readonly timeline: Timeline;
  readonly language: AppLocale;
  readonly signal?: AbortSignal;
  readonly trace?: GenerationTrace;
}

export interface CaptionTranslation {
  readonly payload: ApplyTranslationPayload;
  /** Cues translated (every cue of the track). */
  readonly cues: number;
  /** Units sent back once for a shorter line. */
  readonly shortened: number;
  readonly provider: string;
  readonly model: string;
  /** Every call ran on this Mac. */
  readonly local: boolean;
  /** What every call used, the shorter pass included: the tool reports it (review M8). */
  readonly usage: TranslationUsage;
}

interface Called {
  readonly texts: Map<string, string>;
  readonly provider: string;
  readonly model: string;
  readonly local: boolean;
  readonly usage: TranslationUsage;
}

const NO_USAGE: TranslationUsage = { inputTokens: 0, outputTokens: 0, usd: 0 };

const plus = (a: TranslationUsage, b: TranslationUsage): TranslationUsage => ({
  inputTokens: a.inputTokens + b.inputTokens,
  outputTokens: a.outputTokens + b.outputTokens,
  usd: a.usd + b.usd,
});

const primary = (tag: string) => tag.split('-')[0]?.toLowerCase() ?? tag.toLowerCase();

/** Every id sent comes back once, none added, none empty. */
function checkedTexts(sent: readonly TranslationUnit[], got: readonly TranslationUnit[]) {
  const texts = new Map<string, string>();
  const asked = new Set(sent.map((unit) => unit.id));
  for (const unit of got) {
    if (!asked.has(unit.id) || texts.has(unit.id))
      return err(TranslationMismatch({ unitId: unit.id }, { detail: 'added or repeated' }));
    if (unit.text.trim() === '')
      return err(TranslationFailed(undefined, { detail: `unit ${unit.id} came back empty` }));
    texts.set(unit.id, unit.text.trim());
  }
  const missing = sent.find((unit) => !texts.has(unit.id));
  return missing ? err(TranslationMismatch({ unitId: missing.id }, { detail: 'missing' })) : ok(texts);
}

/** True when a cue's text is longer than its source allows. */
function overflows(unit: SourceUnit, shares: readonly CueText[], from: string, to: string): boolean {
  return unit.cues.some((cue, i) => {
    const source = graphemeCount(cueText(cue), from);
    return graphemeCount(shares[i]?.text ?? '', to) > TRANSLATE_CONFIG.overflowRatio * source;
  });
}

/** Translates the units in batches of TRANSLATION_LIMITS.units, each checked to come back whole. */
async function translateUnits(
  translator: TextTranslator,
  units: readonly Pick<SourceUnit, 'id' | 'text'>[],
  request: CaptionTranslationRequest & { readonly from: string; readonly instruction?: 'shorter' },
): AsyncResult<Called> {
  const texts = new Map<string, string>();
  let last: Omit<Called, 'texts' | 'usage'> = { provider: '', model: '', local: true };
  let local = true;
  let usage = NO_USAGE;
  for (const batch of unitBatches(units)) {
    const done = await translator.translate({
      units: batch.units,
      from: request.from,
      to: request.language,
      ...(batch.context.length > 0 ? { context: batch.context } : {}),
      ...(request.instruction ? { instruction: request.instruction } : {}),
      ...(request.signal ? { signal: request.signal } : {}),
      ...(request.trace ? { trace: request.trace } : {}),
    });
    if (!done.ok) return done;
    usage = plus(usage, done.value.usage);
    const checked = checkedTexts(batch.units, done.value.units);
    if (!checked.ok) return checked;
    for (const [id, text] of checked.value) texts.set(id, text);
    last = { provider: done.value.provider, model: done.value.model, local: done.value.local };
    local &&= done.value.local;
  }
  return ok({ texts, ...last, local, usage });
}

/** The track to translate: there are captions, and they aren't in the target language already. */
function sourceTrack(request: CaptionTranslationRequest) {
  const track = request.timeline.captions;
  if (!track || track.cues.length === 0)
    return err(NotFoundError({ entity: 'caption track', id: request.timeline.id }));
  if (primary(track.language) === primary(request.language))
    return err(
      ValidationError({ field: 'language' }, { detail: `the captions are already ${track.language}` }),
    );
  return ok(track);
}

/** `captions.applyTranslation`'s payload, checked against core's schema; no cue over the cue limit. */
function applyPayloadOf(request: CaptionTranslationRequest, cues: readonly CueText[]) {
  const tooLong = cues.find((cue) => cue.text.length > TRANSLATE_CONFIG.maxCueChars);
  if (tooLong)
    return err(TranslationFailed(undefined, { detail: `cue ${tooLong.cueId} is over 500 characters` }));
  const payload = applyPayload.safeParse({
    projectId: request.timeline.projectId,
    timelineId: request.timeline.id,
    revision: request.timeline.revision,
    language: request.language,
    cues,
  });
  return payload.success
    ? ok(payload.data)
    : err(ValidationError({ field: 'cues' }, { detail: z.prettifyError(payload.error) }));
}

export function createCaptionTranslator(deps: CaptionTranslatorDeps) {
  return {
    async translate(request: CaptionTranslationRequest): AsyncResult<CaptionTranslation> {
      const track = sourceTrack(request);
      if (!track.ok) return track;
      const from = track.value.language;
      const units = captionUnits(track.value.cues);
      const first = await translateUnits(deps.translator, units, { ...request, from });
      if (!first.ok) return first;
      const share = (unit: SourceUnit, texts: ReadonlyMap<string, string>) =>
        shareUnit(unit.cues, texts.get(unit.id) ?? '', request.language);
      const shares = new Map(units.map((unit) => [unit.id, share(unit, first.value.texts)]));
      const long = units.filter((unit) => overflows(unit, shares.get(unit.id) ?? [], from, request.language));
      let called = first.value;
      if (long.length > 0) {
        const again = await translateUnits(deps.translator, long, {
          ...request,
          from,
          instruction: 'shorter',
        });
        if (!again.ok) return again;
        for (const unit of long) shares.set(unit.id, share(unit, again.value.texts));
        called = {
          ...again.value,
          local: first.value.local && again.value.local,
          usage: plus(first.value.usage, again.value.usage),
        };
      }
      const cues = units.flatMap((unit) => shares.get(unit.id) ?? []);
      const payload = applyPayloadOf(request, cues);
      if (!payload.ok) return payload;
      return ok({
        payload: payload.value,
        cues: cues.length,
        shortened: long.length,
        provider: called.provider,
        model: called.model,
        local: called.local,
        usage: called.usage,
      });
    },
  };
}

export type CaptionTranslator = ReturnType<typeof createCaptionTranslator>;
