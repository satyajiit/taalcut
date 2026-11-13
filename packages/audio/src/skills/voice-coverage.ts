// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The Voice director's coverage check (SPEC P3.8, `VOICE_CONFIG.coverage`): the words the voice lines' files say
 * must cover 98 % of the script's graphemes. Each generated line lands with its exact words as its asset's
 * transcript (engine `tts`, round P3-3), so this reads the transcript of every line's asset and matches its words
 * against the line's text. A line whose transcript can't be read (none stored, an asset from before) isn't counted:
 * coverage alone never fails it, and the reason names such lines only when the rest already fall short.
 */
import {
  ok,
  type AssetId,
  type AsyncResult,
  type SkillVerdict,
  type Transcript,
  type Voiceover,
} from '@taalcut/core';
import { graphemeCount } from '../translate/retime';
import { VOICE_CONFIG } from '../voice/config';

/** Stored transcripts by asset (the desktop passes the library's, as render's TranscriptSource reads them). */
export interface TranscriptReader {
  transcript(assetId: AssetId): AsyncResult<Transcript | null>;
}

/** A text's spoken words, compared loosely: audio tags such as [whispers] left out, NFC, lower case. */
export function spokenWords(text: string, language: string): string[] {
  const spoken = text.replace(/\[[^\]]*\]/g, ' ').normalize('NFC');
  const words: string[] = [];
  for (const segment of new Intl.Segmenter(language, { granularity: 'word' }).segment(spoken))
    if (segment.isWordLike) words.push(segment.segment.toLocaleLowerCase(language));
  return words;
}

interface LineCoverage {
  readonly index: number;
  readonly covered: number;
  readonly total: number;
  readonly missing: readonly string[];
}

/** The line's words its transcript says, each counted once, weighed by graphemes. */
function lineCoverage(index: number, text: string, transcript: Transcript, language: string): LineCoverage {
  const said = new Map<string, number>();
  for (const word of transcript.segments.flatMap((segment) => segment.words))
    for (const part of spokenWords(word.text, language)) said.set(part, (said.get(part) ?? 0) + 1);
  let covered = 0;
  let total = 0;
  const missing: string[] = [];
  for (const word of spokenWords(text, language)) {
    const size = graphemeCount(word, language);
    total += size;
    const left = said.get(word) ?? 0;
    if (left > 0) {
      said.set(word, left - 1);
      covered += size;
    } else missing.push(word);
  }
  return { index, covered, total, missing };
}

const percent = (share: number) => Math.floor(share * 1000) / 10;

/**
 * Null when coverage holds or nothing could be read; a retry naming the line that misses the most otherwise. Read
 * errors count as unread: a check must not fail the handoff because the library was busy.
 */
export async function coverageVerdict(
  voiceover: Voiceover,
  reader: TranscriptReader,
  signal?: AbortSignal,
): Promise<SkillVerdict | null> {
  const lines: LineCoverage[] = [];
  let unread = 0;
  for (const [index, line] of voiceover.lines.entries()) {
    if (signal?.aborted) return null;
    const transcript = line.assetId ? await reader.transcript(line.assetId) : ok(null);
    if (!transcript.ok || !transcript.value) {
      unread += 1;
      continue;
    }
    lines.push(lineCoverage(index, line.text, transcript.value, voiceover.language));
  }
  const total = lines.reduce((sum, line) => sum + line.total, 0);
  if (total === 0) return null;
  const share = lines.reduce((sum, line) => sum + line.covered, 0) / total;
  if (share >= VOICE_CONFIG.coverage) return null;
  const worst = lines.reduce((a, b) => (b.total - b.covered > a.total - a.covered ? b : a));
  const missing = worst.missing
    .slice(0, 5)
    .map((word) => `"${word}"`)
    .join(', ');
  const notRead =
    unread > 0 ? ` (${unread} line${unread === 1 ? '' : 's'} had no stored transcript to check)` : '';
  return {
    verdict: 'retry',
    reason:
      `The voice lines say ${percent(share)} % of the script's words, under ${percent(VOICE_CONFIG.coverage)} %` +
      `${notRead}. Line ${worst.index + 1} misses ${missing}: call voice.editLine for it with the same text, or ` +
      'rewrite it for the ear.',
  };
}
