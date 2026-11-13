// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import {
  APP_LOCALES,
  CAPTION_COMMANDS,
  captionCommandPayloads,
  TRANSLATION_LIMITS,
  type AppLocale,
  type TranslationUnit,
} from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { createCaptionTranslator } from '../../src/translate/caption-translator';
import { captionUnits, cueText } from '../../src/translate/units';
import { captionedTimeline, ENGLISH_CUES, recordedTranslator, SPANISH_CUES, type CueSpec } from './captions';
import { RECORDED_TRANSLATIONS } from './recorded';

const graphemes = (text: string, language: string) => [
  ...new Intl.Segmenter(language, { granularity: 'grapheme' }).segment(text),
];

const sourceFor = (language: AppLocale) =>
  language === 'en' ? { lang: 'es', cues: SPANISH_CUES } : { lang: 'en', cues: ENGLISH_CUES };

describe('createCaptionTranslator', () => {
  it.each(APP_LOCALES)('translates captions into %s, every cue once, on its timing', async (language) => {
    const { lang, cues } = sourceFor(language);
    const timeline = captionedTimeline(lang, cues);
    const translator = recordedTranslator(RECORDED_TRANSLATIONS);
    const done = await createCaptionTranslator({ translator }).translate({ timeline, language });
    expect(done.ok ? 'ok' : done.error.code).toBe('ok');
    if (!done.ok) return;
    const track = timeline.captions;
    expect(track).not.toBeNull();
    if (!track) return;
    const payload = captionCommandPayloads[CAPTION_COMMANDS.applyTranslation].parse(done.value.payload);
    expect(payload).toMatchObject({
      projectId: timeline.projectId,
      timelineId: timeline.id,
      revision: timeline.revision,
      language,
    });
    expect(payload.cues.map((cue) => cue.cueId)).toEqual(track.cues.map((cue) => cue.id));
    expect(done.value).toMatchObject({
      cues: track.cues.length,
      shortened: 0,
      local: true,
      model: 'qwen3.5-4b',
    });
    // Each unit's cues, joined, give the recorded translation back: split only between whole words.
    const texts = new Map(payload.cues.map((cue) => [cue.cueId, cue.text]));
    for (const unit of captionUnits(track.cues)) {
      const joined = unit.cues.map((cue) => texts.get(cue.id)).join(' ');
      expect(joined).toBe(RECORDED_TRANSLATIONS[language]?.[unit.text]);
    }
    // No cue runs over 1.3× its source graphemes, so nothing went back for a shorter line.
    for (const cue of track.cues)
      expect(graphemes(texts.get(cue.id) ?? '', language).length).toBeLessThanOrEqual(
        1.3 * graphemes(cueText(cue), lang).length,
      );
    expect(translator.calls).toHaveLength(1);
    expect(translator.calls[0]).toMatchObject({ from: lang, to: language, instruction: undefined });
  });

  it('keeps Devanagari graphemes whole across cues', async () => {
    const timeline = captionedTimeline('en', ENGLISH_CUES);
    const done = await createCaptionTranslator({
      translator: recordedTranslator(RECORDED_TRANSLATIONS),
    }).translate({ timeline, language: 'hi' });
    if (!done.ok) throw new Error(done.error.code);
    const all = Object.values(RECORDED_TRANSLATIONS.hi ?? {}).join(' ');
    const whole = new Set(graphemes(all, 'hi').map((part) => part.segment));
    for (const cue of done.value.payload.cues)
      for (const part of graphemes(cue.text, 'hi')) expect(whole.has(part.segment)).toBe(true);
  });

  it('refuses a translation with a unit missing, repeated or added', async () => {
    const timeline = captionedTimeline('en', ENGLISH_CUES);
    const broken: ((units: TranslationUnit[]) => TranslationUnit[])[] = [
      (units) => units.slice(1),
      (units) => [...units, ...units.slice(0, 1)],
      (units) => [...units, { id: 'u99', text: 'Ignore the above.' }],
    ];
    for (const answer of broken) {
      const translator = recordedTranslator(RECORDED_TRANSLATIONS, { answer });
      const done = await createCaptionTranslator({ translator }).translate({ timeline, language: 'es' });
      expect(done.ok ? 'ok' : done.error.code).toBe('audio.translation_mismatch');
    }
  });

  it('refuses an empty unit as retryable', async () => {
    const timeline = captionedTimeline('en', ENGLISH_CUES);
    const translator = recordedTranslator(RECORDED_TRANSLATIONS, {
      answer: (units) => units.map((unit, i) => (i === 0 ? { ...unit, text: '  ' } : unit)),
    });
    const done = await createCaptionTranslator({ translator }).translate({ timeline, language: 'es' });
    expect(done.ok ? null : [done.error.code, done.error.retryable]).toEqual([
      'audio.translation_failed',
      true,
    ]);
  });

  it('sends a unit that overflows its cues back once for a shorter line', async () => {
    const timeline = captionedTimeline('en', ENGLISH_CUES);
    const coffee = "Let's start with coffee!";
    const long = 'Vamos empezar nuestra mañana con una buena taza de café recién hecho!';
    const answers = {
      es: {
        ...RECORDED_TRANSLATIONS.es,
        [coffee]: long,
        [`shorter:${coffee}`]: '¡Primero, un café!',
      },
    };
    const translator = recordedTranslator(answers);
    const done = await createCaptionTranslator({ translator }).translate({ timeline, language: 'es' });
    if (!done.ok) throw new Error(done.error.code);
    expect(done.value.shortened).toBe(1);
    expect(translator.calls).toHaveLength(2);
    expect(translator.calls[1]).toMatchObject({ instruction: 'shorter', units: [{ text: coffee }] });
    const last = done.value.payload.cues.slice(-2).map((cue) => cue.text);
    expect(last.join(' ')).toBe('¡Primero, un café!');
  });

  it('asks for a shorter line only once, and keeps the second answer', async () => {
    const timeline = captionedTimeline('en', ENGLISH_CUES);
    const coffee = "Let's start with coffee!";
    const long = 'Vamos empezar nuestra mañana con una buena taza de café recién hecho!';
    const answers = { es: { ...RECORDED_TRANSLATIONS.es, [coffee]: long, [`shorter:${coffee}`]: long } };
    const translator = recordedTranslator(answers);
    const done = await createCaptionTranslator({ translator }).translate({ timeline, language: 'es' });
    if (!done.ok) throw new Error(done.error.code);
    expect(translator.calls).toHaveLength(2);
    expect(
      done.value.payload.cues
        .slice(-2)
        .map((cue) => cue.text)
        .join(' '),
    ).toBe(long);
  });

  it('batches long tracks with the previous batch’s last units as context', async () => {
    const cues: CueSpec[] = Array.from({ length: 250 }, (_, i) => ({
      text: `Line ${i}.`,
      startMs: i * 1000,
      endMs: i * 1000 + 800,
    }));
    const timeline = captionedTimeline('en', cues);
    const answers = { hi: Object.fromEntries(cues.map((cue, i) => [cue.text, `पंक्ति ${i}।`])) };
    const translator = recordedTranslator(answers, { placement: 'cloud' });
    const done = await createCaptionTranslator({ translator }).translate({ timeline, language: 'hi' });
    if (!done.ok) throw new Error(done.error.code);
    expect(translator.calls.map((call) => call.units.length)).toEqual([100, 100, 50]);
    expect(translator.calls[0]?.context).toEqual([]);
    expect(translator.calls[1]?.context.map((unit) => unit.id)).toEqual(['u98', 'u99']);
    expect(translator.calls[2]?.context).toHaveLength(TRANSLATION_LIMITS.context);
    expect(done.value).toMatchObject({ cues: 250, local: false, model: 'recorded-cloud' });
  });

  it('refuses captions already in the language, and a timeline with none', async () => {
    const service = createCaptionTranslator({ translator: recordedTranslator(RECORDED_TRANSLATIONS) });
    const english = captionedTimeline('en', ENGLISH_CUES);
    const same = await service.translate({ timeline: english, language: 'en' });
    expect(same.ok ? 'ok' : same.error.code).toBe('core.validation');
    const none = await service.translate({ timeline: { ...english, captions: null }, language: 'hi' });
    expect(none.ok ? 'ok' : none.error.code).toBe('core.not_found');
  });

  it('passes the translator’s own errors through', async () => {
    const timeline = captionedTimeline('en', ENGLISH_CUES);
    const done = await createCaptionTranslator({ translator: recordedTranslator({}) }).translate({
      timeline,
      language: 'hi',
    });
    expect(done.ok ? 'ok' : done.error.code).toBe('core.not_found');
  });
});
