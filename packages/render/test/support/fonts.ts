// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The bundled caption fonts for tests: the committed packages/render/fonts
 * folder and one harfbuzzjs measurer over it, shared by every test file.
 */
import { join } from 'node:path';
import { createTextMeasurer, type DetailedTextMeasurer } from '../../src/captions/measure';

export const FONTS_DIR = join(import.meta.dirname, '..', '..', 'fonts');

let measurer: Promise<DetailedTextMeasurer> | undefined;

export function testMeasurer(): Promise<DetailedTextMeasurer> {
  measurer ??= createTextMeasurer(FONTS_DIR);
  return measurer;
}

/** Golden strings per language (SPEC section 6, "Safe zones in four languages"). */
export const GOLDEN = {
  en: 'Morning light over the old harbour',
  hi: 'क्षमा त्रिशूल ज्ञान श्रम कर्क ज़िंदगी कि की कु कू कृ के कै को कौ',
  es: '¿Dónde está el niño? ¡Mañana sí!',
  pt: 'Não, irmã: você põe açúcar no pão',
  hinglish: 'Yeh video bahut अच्छा hai',
  emoji: 'Party time 🎉🇮🇳❤️ 👍🏽',
} as const;
