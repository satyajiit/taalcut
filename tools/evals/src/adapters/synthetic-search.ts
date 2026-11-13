// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { z } from 'zod';
import { parseNamed } from '../schema';
import { type EvalShot, type SearchQuery, type SearchSystem } from './types';

const syntheticClipSchema = z
  .object({
    asset: z.string().min(1),
    word: z.string().min(1),
    frames: z.number().int().positive(),
    orientation: z.enum(['landscape', 'portrait', 'square']),
    quality: z.number().min(0).max(1),
    captured: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })
  .strict();

/** A clip the synthetic index can match by a whole word in the query. */
export interface SyntheticClip {
  asset: string;
  word: string;
  frames: number;
  orientation: 'landscape' | 'portrait' | 'square';
  quality: number;
  /** ISO date YYYY-MM-DD. */
  captured: string;
}

export function parseSyntheticClips(input: unknown, label = 'synthetic clips'): SyntheticClip[] {
  return parseNamed(z.array(syntheticClipSchema), input, label);
}

function matchesFilters(clip: SyntheticClip, query: SearchQuery): boolean {
  const filters = query.filters;
  if (filters === undefined) return true;
  if (filters.orientation !== undefined && clip.orientation !== filters.orientation) return false;
  if (filters.minFrames !== undefined && clip.frames < filters.minFrames) return false;
  if (filters.maxFrames !== undefined && clip.frames > filters.maxFrames) return false;
  if (filters.minQuality !== undefined && clip.quality < filters.minQuality) return false;
  if (filters.capturedAfter !== undefined && clip.captured < filters.capturedAfter) return false;
  if (filters.capturedBefore !== undefined && clip.captured >= filters.capturedBefore) return false;
  return true;
}

/**
 * Whole-word match against the word burned into the clip. This stands in for
 * the library index until that package is wired. It does not read pixels.
 */
export function syntheticSearchSystem(clips: readonly SyntheticClip[]): SearchSystem {
  return {
    search(query: SearchQuery, limit: number): Promise<EvalShot[]> {
      const tokens = new Set(
        query.text
          .toLowerCase()
          .split(/[^a-z0-9]+/)
          .filter((token) => token.length > 0),
      );
      const hits = clips.filter((clip) => tokens.has(clip.word.toLowerCase()) && matchesFilters(clip, query));
      return Promise.resolve(
        hits.slice(0, Math.max(0, limit)).map((clip) => ({
          asset: clip.asset,
          range: { startFrame: 0, endFrame: clip.frames },
        })),
      );
    },
  };
}
