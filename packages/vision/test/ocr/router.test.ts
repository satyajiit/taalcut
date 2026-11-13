// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { CancelledError } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { OcrFailed } from '../../src/errors';
import { createRoutedOcr, mergePages } from '../../src/ocr/router';
import { DEVA_CAPS, fakeEngine, frame, LATIN_CAPS, observation } from './helpers/fakes';

const TOP = { x: 0.1, y: 0.1, width: 0.8, height: 0.1 };
const BOTTOM = { x: 0.1, y: 0.7, width: 0.8, height: 0.1 };

function engines() {
  const vision = fakeEngine(LATIN_CAPS, () => [
    observation('Subscribe now', TOP, 0.95, 'apple-vision', 'en'),
  ]);
  const devanagari = fakeEngine(DEVA_CAPS, () => [
    observation('अभी सदस्यता लें', BOTTOM, 0.9, 'ppocr-v5', 'hi'),
  ]);
  return { vision, devanagari };
}

describe('createRoutedOcr', () => {
  it('sends Latin languages to Vision only', async () => {
    const { vision, devanagari } = engines();
    const router = createRoutedOcr({ vision, devanagari });
    const pages = await router.recognize([frame(3)], { languages: ['en', 'pt-BR'] });
    expect(pages.ok && pages.value[0]?.observations.map((o) => o.engine)).toEqual(['apple-vision']);
    expect(vision.calls).toEqual([{ frames: [3], languages: ['en', 'pt'] }]);
    expect(devanagari.calls).toEqual([]);
  });

  it('sends Hindi to PP-OCR only', async () => {
    const { vision, devanagari } = engines();
    const pages = await createRoutedOcr({ vision, devanagari }).recognize([frame(0)], { languages: ['hi'] });
    expect(pages.ok && pages.value[0]?.observations[0]?.text).toBe('अभी सदस्यता लें');
    expect(vision.calls).toEqual([]);
    expect(devanagari.calls[0]?.languages).toEqual(['hi']);
  });

  it('runs both on a mixed frame and merges by box', async () => {
    const { vision, devanagari } = engines();
    const pages = await createRoutedOcr({ vision, devanagari }).recognize([frame(0), frame(1)], {
      languages: ['en', 'hi'],
    });
    expect(pages.ok).toBe(true);
    if (!pages.ok) return;
    expect(pages.value.map((p) => p.frame)).toEqual([0, 1]);
    expect(pages.value[0]?.observations.map((o) => o.text)).toEqual(['Subscribe now', 'अभी सदस्यता लें']);
  });

  it('asks both engines before either answers on a mixed frame (IX3-O2), with the same merged pages', async () => {
    const { vision, devanagari } = engines();
    const order: string[] = [];
    let release = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const held = (name: string, engine: typeof vision): typeof vision => ({
      ...engine,
      async recognize(frames, options) {
        order.push(`${name} asked`);
        await gate;
        order.push(`${name} answered`);
        return engine.recognize(frames, options);
      },
    });
    const pending = createRoutedOcr({
      vision: held('vision', vision),
      devanagari: held('devanagari', devanagari),
    }).recognize([frame(0)], { languages: ['hi', 'en'] });
    await new Promise((resolve) => setImmediate(resolve));
    expect(order).toEqual(['vision asked', 'devanagari asked']);
    release();
    const pages = await pending;
    expect(pages.ok && pages.value[0]?.observations.map((o) => o.text)).toEqual([
      'Subscribe now',
      'अभी सदस्यता लें',
    ]);
  });

  it("returns Vision's error when both engines fail on a mixed frame", async () => {
    const vision = fakeEngine(LATIN_CAPS, () => OcrFailed(undefined, { detail: 'vision' }));
    const devanagari = fakeEngine(DEVA_CAPS, () => OcrFailed(undefined, { detail: 'ppocr' }));
    const pages = await createRoutedOcr({ vision, devanagari }).recognize([frame(0)], {
      languages: ['en', 'hi'],
    });
    expect(!pages.ok && pages.error.detail).toBe('vision');
  });

  it('prefers Vision for Hindi when this macOS lists it', async () => {
    const vision = fakeEngine({ scripts: ['latin', 'devanagari'], languages: ['en', 'hi'] }, () => []);
    const devanagari = fakeEngine(DEVA_CAPS, () => []);
    await createRoutedOcr({ vision, devanagari }).recognize([frame(0)], { languages: ['hi'] });
    expect(vision.calls.length).toBe(1);
    expect(devanagari.calls.length).toBe(0);
  });

  it('never falls back to PP-OCR when Vision fails on a Latin frame', async () => {
    const vision = fakeEngine(LATIN_CAPS, () => OcrFailed(undefined, { detail: 'helper crashed' }));
    const devanagari = fakeEngine(DEVA_CAPS, () => []);
    const pages = await createRoutedOcr({ vision, devanagari }).recognize([frame(0)], { languages: ['en'] });
    expect(!pages.ok && pages.error.code).toBe('vision.ocr_failed');
    expect(devanagari.calls).toEqual([]);
  });

  it('sends Latin to a failing helper so its error surfaces', async () => {
    const vision = fakeEngine(OcrFailed(), () => OcrFailed());
    const pages = await createRoutedOcr({ vision }).recognize([frame(0)], { languages: ['es'] });
    expect(!pages.ok && pages.error.code).toBe('vision.ocr_failed');
  });

  it('says which language nobody reads', async () => {
    const { vision } = engines();
    const hindi = await createRoutedOcr({ vision }).recognize([frame(0)], { languages: ['hi'] });
    expect(!hindi.ok && hindi.error).toMatchObject({
      code: 'vision.ocr_unavailable',
      params: { language: 'hi' },
    });
    const tamil = await createRoutedOcr(engines()).recognize([frame(0)], { languages: ['ta'] });
    expect(!tamil.ok && tamil.error.params).toEqual({ language: 'ta' });
    const none = await createRoutedOcr({}).recognize([frame(0)], { languages: [] });
    expect(!none.ok && none.error.code).toBe('vision.ocr_unavailable');
  });

  it('uses Vision defaults with no languages, handles empty input and cancellation', async () => {
    const { vision, devanagari } = engines();
    const router = createRoutedOcr({ vision, devanagari });
    expect(await router.recognize([], { languages: ['en'] })).toEqual({ ok: true, value: [] });
    const pages = await router.recognize([frame(0)], { languages: [] });
    expect(pages.ok && pages.value[0]?.observations.length).toBe(1);
    const controller = new AbortController();
    controller.abort();
    const cancelled = await router.recognize([frame(0)], { languages: ['en'], signal: controller.signal });
    expect(!cancelled.ok && CancelledError.is(cancelled.error)).toBe(true);
    const failing = createRoutedOcr({ vision, devanagari: fakeEngine(DEVA_CAPS, () => OcrFailed()) });
    const mixed = await failing.recognize([frame(0)], { languages: ['en', 'hi'] });
    expect(mixed.ok && mixed.value[0]?.observations.map((o) => o.text)).toEqual(['Subscribe now']);
  });

  it('falls back to PP-OCR Latin or keeps Devanagari when Vision fails at read time', async () => {
    const { devanagari } = engines();
    const brokenVision = fakeEngine(LATIN_CAPS, () => OcrFailed(undefined, { detail: 'vision failed' }));
    const latin = fakeEngine(LATIN_CAPS, () => [observation('Fallback text', TOP, 0.9, 'ppocr-v5', 'en')]);
    const withLatin = createRoutedOcr({ vision: brokenVision, latin, devanagari });
    const latinOnly = await withLatin.recognize([frame(0)], { languages: ['en'] });
    expect(latinOnly.ok && latinOnly.value[0]?.observations.map((o) => o.text)).toEqual(['Fallback text']);
    const merged = await withLatin.recognize([frame(0)], { languages: ['en', 'hi'] });
    expect(merged.ok && merged.value[0]?.observations.map((o) => o.text)).toEqual([
      'Fallback text',
      'अभी सदस्यता लें',
    ]);
    const devaOnly = await createRoutedOcr({ vision: brokenVision, devanagari }).recognize([frame(0)], {
      languages: ['en', 'hi'],
    });
    expect(devaOnly.ok && devaOnly.value[0]?.observations.map((o) => o.text)).toEqual(['अभी सदस्यता लें']);
  });

  it('reads Latin with PP-OCR Latin where there is no Vision, and merges it with Hindi', async () => {
    const latin = fakeEngine(LATIN_CAPS, () => [observation('Subscribe now', TOP, 0.9, 'ppocr-v5')]);
    const { devanagari } = engines();
    const router = createRoutedOcr({ latin, devanagari });
    const english = await router.recognize([frame(0)], { languages: ['en'] });
    expect(english.ok && english.value[0]?.observations.map((o) => o.text)).toEqual(['Subscribe now']);
    expect(devanagari.calls).toEqual([]);
    const hinglish = await router.recognize([frame(1)], { languages: ['hi', 'en'] });
    expect(hinglish.ok && hinglish.value[0]?.observations.map((o) => o.text)).toEqual([
      'Subscribe now',
      'अभी सदस्यता लें',
    ]);
    expect(latin.calls.map((c) => c.languages)).toEqual([['en'], ['en']]);
  });

  it('prefers Vision over PP-OCR Latin, and closes every engine it was given', async () => {
    const { vision, devanagari } = engines();
    const closed: string[] = [];
    const latin = {
      ...fakeEngine(LATIN_CAPS, () => []),
      close: async () => void closed.push('latin'),
    };
    const router = createRoutedOcr({
      vision: { ...vision, close: async () => void closed.push('vision') },
      latin,
      devanagari,
    });
    await router.recognize([frame(0)], { languages: ['en'] });
    expect(vision.calls).toHaveLength(1);
    expect(latin.calls).toEqual([]);
    await router.close?.();
    expect(closed).toEqual(['vision', 'latin']);
  });

  it('reports the union of capabilities', async () => {
    const caps = await createRoutedOcr({
      ...engines(),
      devanagari: fakeEngine(DEVA_CAPS, () => []),
    }).capabilities();
    expect(caps.ok && [...caps.value.scripts].sort()).toEqual(['devanagari', 'latin']);
    expect(caps.ok && caps.value.languages).toContain('hi');
    // A Latin reader that can't start is the answer (a dead helper must not read as "no language", IX-F3);
    // a Devanagari engine that isn't there only takes Hindi away.
    const broken = await createRoutedOcr({ vision: fakeEngine(OcrFailed(), () => []) }).capabilities();
    expect(!broken.ok && broken.error.code).toBe('vision.ocr_failed');
    const withDeva = await createRoutedOcr({
      vision: fakeEngine(OcrFailed(), () => []),
      devanagari: fakeEngine(DEVA_CAPS, () => []),
    }).capabilities();
    expect(!withDeva.ok && withDeva.error.code).toBe('vision.ocr_failed');
    const noDeva = await createRoutedOcr({
      vision: fakeEngine(LATIN_CAPS, () => []),
      devanagari: fakeEngine(OcrFailed(), () => []),
    }).capabilities();
    expect(noDeva.ok && noDeva.value.languages).not.toContain('hi');
    expect(noDeva.ok && noDeva.value.languages).toContain('en');
  });
});

describe('mergePages', () => {
  it('lets Devanagari win an overlapping box and drops Vision garbage over Hindi', () => {
    const deva = observation('अभी सदस्यता लें', BOTTOM, 0.9, 'ppocr-v5');
    const garbage = observation('3TH HG441 C', { ...BOTTOM, x: 0.15 }, 0.3, 'apple-vision');
    const confidentOverlap = observation('Abhi sadasyata', BOTTOM, 0.8, 'apple-vision');
    const latin = observation('Subscribe now', TOP, 0.95, 'apple-vision');
    const merged = mergePages(
      7,
      { frame: 7, observations: [garbage, confidentOverlap, latin] },
      { frame: 7, observations: [deva] },
    );
    expect(merged.frame).toBe(7);
    expect(merged.observations.map((o) => o.text)).toEqual(['Subscribe now', 'अभी सदस्यता लें']);
  });

  it('takes Latin and digits from Vision only: PP-OCR adds Devanagari, never its own Latin or digits', () => {
    const digitsOverLatin = observation('2026', TOP, 0.9, 'ppocr-v5');
    // Where Vision saw nothing, PP-OCR's Latin was texture read as text on ix-v1 (section 12.3).
    const digitsAlone = observation('₹499', BOTTOM, 0.9, 'ppocr-v5');
    const texture = observation('TEA', { ...BOTTOM, y: 0.5 }, 0.5, 'ppocr-v5');
    const latin = observation('Sale 2026', TOP, 0.95, 'apple-vision');
    const merged = mergePages(
      0,
      { frame: 0, observations: [latin] },
      { frame: 0, observations: [digitsOverLatin, digitsAlone, texture] },
    );
    expect(merged.observations.map((o) => o.text)).toEqual(['Sale 2026']);
    expect(mergePages(1, undefined, undefined)).toEqual({ frame: 1, observations: [] });
  });
});
