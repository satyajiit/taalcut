// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import type { NormalisedBox } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { keepPlausible, plausible, writtenBy } from '../../src/ocr/plausible';
import { LATIN_CAPS, fakeEngine, frame, observation } from './helpers/fakes';

const BOX: NormalisedBox = { x: 0.1, y: 0.1, width: 0.3, height: 0.05 };
const read = (text: string) => observation(text, BOX);

/** What the ix-v1 bench library stored with languages ['en'] (helper-check-ixv1, run 1). */
const TEXTURE = ['恕！', '٠٠.٠', '٠٠. ..', '..٠', '一期', '路量', '٠٠٠٠', '好好你好好好好所你好与怎你好', '١٠٠٠٠٠٠٠'];
const PUNCTUATION = ['.°', '.... .. ... ......'];
const KNOWN = ['PIER', '39 FERRY', 'KEYBOARD SALE 50 OFF', 'JARDIM BOTANICO', 'TAKE', '4', '00:00:01.300', 'KRTE PARK'];

describe('plausible', () => {
  it('drops texture read as Han, Arabic-Indic digits, or bare punctuation when English is asked', () => {
    const en = writtenBy(['en']);
    for (const text of [...TEXTURE, ...PUNCTUATION]) expect(plausible(read(text), en), text).toBe(false);
    for (const text of KNOWN) expect(plausible(read(text), en), text).toBe(true);
  });

  it('keeps accented Latin, and the scripts of every asked language', () => {
    expect(plausible(read('Jardim Botânico'), writtenBy(['pt-BR']))).toBe(true);
    const hinglish = writtenBy(['hi', 'en']);
    expect(plausible(read('नमस्ते दोस्तों'), hinglish)).toBe(true);
    expect(plausible(read('SALE ५०%'), hinglish)).toBe(true);
    expect(plausible(read('नमस्ते'), writtenBy(['en']))).toBe(false);
    // Latin always counts: an English word on a Hindi reel stays.
    expect(plausible(read('LIVE'), writtenBy(['hi']))).toBe(true);
    expect(plausible(read('東京タワー'), writtenBy(['ja']))).toBe(true);
  });

  it('keeps mixed readings that are mostly an asked script', () => {
    const en = writtenBy(['en']);
    expect(plausible(read('CAFÉ 好'), en)).toBe(true);
    expect(plausible(read('好好 A'), en)).toBe(false);
  });

  it("checks only the shape when a language isn't known", () => {
    const unknown = writtenBy(['en', 'xx']);
    expect(unknown).toBeUndefined();
    expect(plausible(read('好好你好'), unknown)).toBe(true);
    expect(plausible(read('....'), unknown)).toBe(false);
  });

  it("uses Vision's default languages when none is asked", () => {
    expect(plausible(read('٠٠٠'), writtenBy([]))).toBe(false);
    expect(plausible(read('Mañana'), writtenBy([]))).toBe(true);
  });
});

describe('keepPlausible', () => {
  it("filters each page by the call's languages and passes everything else through", async () => {
    const engine = fakeEngine(LATIN_CAPS, (f) =>
      f.index === 0 ? [read('PIER 39'), read('٠٠٠'), read('.°')] : [read('好好你好')],
    );
    const kept = keepPlausible(engine);
    const pages = await kept.recognize([frame(0), frame(1)], { languages: ['en'] });
    expect(pages.ok && pages.value.map((p) => p.observations.map((o) => o.text))).toEqual([['PIER 39'], []]);
    expect(engine.calls).toEqual([{ frames: [0, 1], languages: ['en'] }]);
    expect(await kept.capabilities()).toEqual(await engine.capabilities());
  });
});
