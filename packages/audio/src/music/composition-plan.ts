// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A v2 composition plan for the timeline (SPEC P3.5 step 1), pure. Sections (the template's slot roles, or a
 * default hook / body / outro split) are merged at downbeats into chunks of 3–120 s, at most 30, each lasting
 * exactly to the millisecond of the downbeat it ends on; the last runs to the timeline's end plus the tail. The
 * API has no BPM field, so the tempo goes in as a style ("96 BPM"), with 4/4, the mood words and "instrumental".
 * Mood words come from the person or the agent: only plain lowercase words pass, so a style can't carry a
 * sentence (or an artist's name the API forbids prompting with).
 */
import type { CompositionChunk } from '@taalcut/core';
import { MUSIC_CONFIG } from './config';

export interface PlanSection {
  /** What the section does: 'hook', 'build', 'payoff', 'outro' (SLOT_ROLES) or 'body'. */
  readonly role: string;
  readonly startMs: number;
}

export interface CompositionInput {
  readonly durationMs: number;
  readonly bpm: number;
  /** Target downbeats in ms (the timeline's grid); chunk edges snap to them. */
  readonly downbeatsMs: readonly number[];
  readonly sections?: readonly PlanSection[];
  readonly mood?: readonly string[];
  readonly vocals?: boolean;
}

const ROLE_TEXT: Record<string, string> = {
  hook: 'An instantly catchy opening that grabs attention',
  build: 'Building energy, adding layers',
  payoff: 'The full groove at its peak',
  outro: 'Winding down to a clean ending',
  body: 'A steady groove that supports a voice',
};

const MOOD_WORD = /^[a-z][a-z -]{1,23}$/;

export function cleanMood(words: readonly string[] | undefined): string[] {
  const kept = (words ?? []).map((w) => w.trim().toLowerCase()).filter((w) => MOOD_WORD.test(w));
  return [...new Set(kept)].slice(0, MUSIC_CONFIG.styles.maxMoodWords);
}

function defaultSections(durationMs: number): PlanSection[] {
  return [
    { role: 'hook', startMs: 0 },
    { role: 'body', startMs: durationMs * 0.25 },
    { role: 'outro', startMs: durationMs * 0.85 },
  ];
}

/** The downbeat nearest `ms`, or `ms` when there are none. */
function snap(ms: number, downbeats: readonly number[]): number {
  return downbeats.reduce(
    (best, d) => (Math.abs(d - ms) < Math.abs(best - ms) ? d : best),
    downbeats[0] ?? ms,
  );
}

export function planComposition(input: CompositionInput): CompositionChunk[] {
  const total = Math.round(input.durationMs + MUSIC_CONFIG.tailMs);
  const { minMs, maxMs, maxChunks } = MUSIC_CONFIG.chunk;
  const sections = (input.sections?.length ? input.sections : defaultSections(input.durationMs))
    .map((s) => ({
      role: s.role,
      startMs: s.startMs <= 0 ? 0 : Math.round(snap(s.startMs, input.downbeatsMs)),
    }))
    .sort((a, b) => a.startMs - b.startMs);
  // Edges: each section's start, split further where a section would run over the API's 120 s.
  const edges: { role: string; startMs: number }[] = [];
  sections.forEach((section, i) => {
    const end = sections[i + 1]?.startMs ?? total;
    if (end - section.startMs <= 0) return;
    let start = section.startMs;
    while (end - start > maxMs) {
      edges.push({ role: section.role, startMs: start });
      start = Math.round(
        snap(
          start + maxMs * 0.9,
          input.downbeatsMs.filter((d) => d > start && d < start + maxMs),
        ),
      );
    }
    edges.push({ role: section.role, startMs: start });
  });
  // Merge a chunk shorter than the API's 3 s into the one before (or the next, for the first).
  const merged: { role: string; startMs: number; endMs: number }[] = [];
  edges.forEach((edge, i) => {
    const endMs = edges[i + 1]?.startMs ?? total;
    const last = merged.at(-1);
    if (endMs - edge.startMs < minMs && last) last.endMs = endMs;
    else merged.push({ role: edge.role, startMs: edge.startMs, endMs });
  });
  const first = merged[0];
  const second = merged[1];
  if (first && second && first.endMs - first.startMs < minMs) {
    second.startMs = first.startMs;
    merged.shift();
  }
  const mood = cleanMood(input.mood);
  const positive = [
    `${Math.round(input.bpm)} BPM`,
    '4/4',
    ...mood,
    ...(input.vocals ? [] : ['instrumental']),
  ];
  const negative = input.vocals
    ? MUSIC_CONFIG.styles.negative.filter((s) => s !== 'vocals')
    : [...MUSIC_CONFIG.styles.negative];
  return merged.slice(0, maxChunks).map((chunk) => ({
    text: (ROLE_TEXT[chunk.role] ?? ROLE_TEXT.body ?? '').slice(0, MUSIC_CONFIG.chunk.maxTextChars),
    durationMs: Math.max(minMs, Math.min(maxMs, chunk.endMs - chunk.startMs)),
    positiveStyles: positive,
    negativeStyles: negative,
  }));
}
