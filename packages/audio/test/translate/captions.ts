// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Captioned timelines and a recorded-answers TextTranslator for the translation tests. */
import {
  CAPTION_PRESETS,
  err,
  FrameRate,
  newId,
  NotFoundError,
  ok,
  RationalTime,
  timelineSchema,
  type CaptionCue,
  type TextTranslator,
  type Timeline,
  type TranslationUnit,
} from '@taalcut/core';
import { makeTestTimeline } from '../helpers/timeline';

export const RATE = FrameRate.of(30);

export interface CueSpec {
  readonly text: string;
  readonly startMs: number;
  readonly endMs: number;
}

const frames = (ms: number) => Math.round((ms * 30) / 1000);

/** A cue whose words share its span evenly, frame-aligned at 30 fps. */
export function cueOf(spec: CueSpec): CaptionCue {
  const words = spec.text.split(' ');
  const start = frames(spec.startMs);
  const end = frames(spec.endMs);
  const edges = words.map((_, i) => start + Math.round(((end - start) * i) / words.length));
  return {
    id: newId<'CaptionCue'>(),
    range: { start: RationalTime.of(start, RATE), duration: RationalTime.of(end - start, RATE) },
    words: words.map((text, i) => {
      const from = edges[i] ?? start;
      const to = edges[i + 1] ?? end;
      return {
        text,
        range: { start: RationalTime.of(from, RATE), duration: RationalTime.of(to - from, RATE) },
        confidence: 0.9,
      };
    }),
    edited: false,
  };
}

/** A timeline as long as its captions (at least 10 s), whose captions are these cues, in `language`. */
export function captionedTimeline(language: string, cues: readonly CueSpec[]): Timeline {
  const length = Math.max(300, ...cues.map((cue) => frames(cue.endMs)));
  const base = makeTestTimeline({ rate: RATE, clips: [{ frames: length }] });
  return timelineSchema.parse({
    ...base,
    captions: {
      enabled: true,
      language,
      style: CAPTION_PRESETS.classic,
      styleSource: 'preset',
      cues: cues.map(cueOf),
    },
  });
}

/** An English talking head: three sentences over six cues. */
export const ENGLISH_CUES: readonly CueSpec[] = [
  { text: 'So today I want', startMs: 0, endMs: 800 },
  { text: 'to show you my morning routine.', startMs: 800, endMs: 2400 },
  { text: 'It takes ten minutes', startMs: 3200, endMs: 4400 },
  { text: 'and it changed my whole week.', startMs: 4400, endMs: 6000 },
  { text: "Let's start", startMs: 6100, endMs: 6900 },
  { text: 'with coffee!', startMs: 6900, endMs: 7800 },
];

/** A Spanish one: two sentences over three cues. */
export const SPANISH_CUES: readonly CueSpec[] = [
  { text: 'Hoy quiero mostrarte', startMs: 0, endMs: 1400 },
  { text: 'mi rutina.', startMs: 1400, endMs: 2200 },
  { text: '¡Empecemos con café!', startMs: 2400, endMs: 3600 },
];

export interface TranslateCall {
  readonly units: readonly TranslationUnit[];
  readonly context: readonly TranslationUnit[];
  readonly to: string;
  readonly from: string;
  readonly instruction: 'shorter' | undefined;
}

/**
 * A TextTranslator that answers from recorded translations, keyed by target language and source text (and by
 * `shorter:` + source text for the shorter pass). `answer` can rewrite a reply to fake a model's mistakes.
 */
export function recordedTranslator(
  answers: Readonly<Record<string, Readonly<Record<string, string>>>>,
  options: {
    readonly placement?: ReturnType<TextTranslator['placement']>;
    readonly answer?: (units: TranslationUnit[]) => TranslationUnit[];
  } = {},
): TextTranslator & { readonly calls: TranslateCall[] } {
  const calls: TranslateCall[] = [];
  const placement = options.placement ?? 'local';
  return {
    calls,
    placement: () => placement,
    async translate(request) {
      calls.push({
        units: request.units,
        context: request.context ?? [],
        to: request.to,
        from: request.from,
        instruction: request.instruction,
      });
      const book = answers[request.to] ?? {};
      const units: TranslationUnit[] = [];
      for (const unit of request.units) {
        const key = request.instruction === 'shorter' ? `shorter:${unit.text}` : unit.text;
        const text = book[key];
        if (text === undefined) return err(NotFoundError({ entity: 'recorded translation', id: key }));
        units.push({ id: unit.id, text });
      }
      // A recorded price: 10 tokens in and 8 out per unit, US$0.001 a unit in the cloud, free on this Mac.
      const cloud = placement !== 'local';
      return ok({
        units: options.answer ? options.answer(units) : units,
        provider: cloud ? 'cloud' : 'on-device',
        model: cloud ? 'recorded-cloud' : 'qwen3.5-4b',
        local: !cloud,
        usage: {
          inputTokens: request.units.length * 10,
          outputTokens: request.units.length * 8,
          usd: cloud ? request.units.length * 0.001 : 0,
        },
      });
    },
  };
}
