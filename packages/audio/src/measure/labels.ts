// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Audio kinds from core, plus the golden-reel names tools/evals use. */
import { AUDIO_KINDS } from '@taalcut/core';
import { z } from 'zod';

export type AudioKind = (typeof AUDIO_KINDS)[number];
export const audioKindSchema = z.enum(AUDIO_KINDS);

/** Golden-reel labels. `original` maps to ambience. */
export const GOLDEN_AUDIO_LABELS = {
  silent: 'silence',
  music: 'music',
  voice: 'speech',
  mixed: 'mixed',
  original: 'ambience',
} as const;
