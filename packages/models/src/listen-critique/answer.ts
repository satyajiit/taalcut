// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EAR1-X1: the hosted model's answer made predictable, as earshot's `llm.py` does (`parse_json`, `normalize`): the
 * JSON object found in the text (code fences, prose around it and trailing commas tolerated), scores clamped to
 * 0..10, clip times clamped to the clip and moved to file time, issues most severe first and then by time. Every
 * string is cut to the output schema's length, so a long-winded answer can't fail the tool.
 */
import { FrameRate, RationalTime } from '@taalcut/core';
import {
  CRITIQUE_SCORE_KEYS,
  CRITIQUE_SEVERITIES,
  type CloudCritique,
  type CritiqueIssue,
  type CritiqueScoreKey,
} from './schema';

const MS = FrameRate.of(1000, 1);
type Json = Record<string, unknown>;

/** The JSON object inside a model's answer, or undefined. */
export function parseAnswerJson(text: string): Json | undefined {
  const stripped = text.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, '');
  for (const candidate of [stripped, outerObject(stripped)]) {
    if (!candidate) continue;
    for (const attempt of [candidate, candidate.replace(/,\s*([}\]])/g, '$1')]) {
      try {
        const value: unknown = JSON.parse(attempt);
        if (value && typeof value === 'object' && !Array.isArray(value)) return value as Json;
      } catch {
        // Try the next form.
      }
    }
  }
  return undefined;
}

/** From the first `{` to its matching `}` (strings and escapes skipped), or to the end when it never closes. */
function outerObject(text: string): string | undefined {
  const start = text.indexOf('{');
  if (start < 0) return undefined;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      escaped = ch === '\\' && !escaped;
      if (ch === '"' && !escaped) inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return text.slice(start, i + 1);
  }
  return text.slice(start);
}

/** Seconds from a number, "12.4", "12.4s" or "0:12.4"; undefined for anything else. */
export function secondsOf(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'string') return undefined;
  const match = /^\s*(?:(\d+):)?(\d+(?:\.\d+)?)\s*s?\s*$/.exec(value);
  return match ? Number(match[1] ?? 0) * 60 + Number(match[2]) : undefined;
}

function scoreOf(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(/^\s*(\d+(?:\.\d+)?)/.exec(value)?.[1] ?? NaN) : value;
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  return Math.round(Math.min(10, Math.max(0, n)) * 10) / 10;
}

const text = (value: unknown, max: number): string =>
  value == null ? '' : String(value).trim().slice(0, max);
const record = (value: unknown): Json =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : {};
const ms = (seconds: number) => RationalTime.of(Math.round(seconds * 1000), MS);

/** The clip the model heard, in file seconds: its answer's times are from `start`, at most `seconds` long. */
export interface HeardClip {
  readonly startS: number;
  readonly seconds: number;
}

/** A span in clip seconds, clamped to the clip, as file-time RationalTimes. */
function spanOf(item: Json, clip: HeardClip) {
  let a = secondsOf(item.start);
  let b = secondsOf(item.end);
  if (a !== undefined) {
    a = Math.min(Math.max(0, a), clip.seconds);
    b = b === undefined ? a : Math.min(Math.max(a, b), clip.seconds);
  }
  return {
    start: a === undefined ? null : ms(a + clip.startS),
    end: b === undefined ? null : ms(b + clip.startS),
  };
}

const items = (value: unknown, max: number): Json[] =>
  (Array.isArray(value) ? value : [])
    .filter((x): x is Json => !!x && typeof x === 'object' && !Array.isArray(x))
    .slice(0, max);

/** Upstream's snake_case key for each score. */
const ANSWER_KEY: Readonly<Record<CritiqueScoreKey, string>> = {
  sync: 'sync',
  realism: 'realism',
  mixBalance: 'mix_balance',
  loudness: 'loudness',
  music: 'music',
};

const SEVERITY_RANK: Readonly<Record<string, number>> = { high: 0, medium: 1, low: 2 };

export function normaliseCritique(answer: Json, clip: HeardClip): CloudCritique {
  const overall = record(answer.overall);
  const overallScore = 'score' in overall ? overall.score : answer.overall;
  const scores = record(answer.scores);
  const notes = record(answer.notes);

  const issues: CritiqueIssue[] = items(answer.issues, 40).map((item) => {
    const severity = text(item.severity, 20).toLowerCase();
    return {
      ...spanOf(item, clip),
      severity: (CRITIQUE_SEVERITIES as readonly string[]).includes(severity)
        ? (severity as CritiqueIssue['severity'])
        : 'medium',
      category: text(item.category, 40),
      problem: text(item.problem, 600),
      fix: text(item.fix, 600),
    };
  });
  const startMs = (issue: CritiqueIssue) =>
    issue.start ? RationalTime.toSeconds(issue.start) : Number.POSITIVE_INFINITY;
  issues.sort(
    (x, y) => (SEVERITY_RANK[x.severity] ?? 1) - (SEVERITY_RANK[y.severity] ?? 1) || startMs(x) - startMs(y),
  );

  const critique: CloudCritique = {
    overall: { score: scoreOf(overallScore), verdict: text(overall.verdict, 600) },
    scores: Object.fromEntries(
      CRITIQUE_SCORE_KEYS.map((key) => [key, scoreOf(scores[ANSWER_KEY[key]])]),
    ) as CloudCritique['scores'],
    notes: Object.fromEntries(
      CRITIQUE_SCORE_KEYS.flatMap((key) => {
        const note = text(notes[ANSWER_KEY[key]], 1000);
        return note ? [[key, note]] : [];
      }),
    ),
    syntheticOrCheap: items(answer.synthetic_or_cheap, 20).map((item) => ({
      ...spanOf(item, clip),
      what: text(item.what, 300),
      why: text(item.why, 600),
    })),
    issues,
    strengths: strings(answer.strengths, 8, 300),
    topFixes: strings(answer.top_fixes, 5, 600),
  };
  const reply = text(answer.answer, 2000);
  return reply ? { ...critique, answer: reply } : critique;
}

function strings(value: unknown, max: number, length: number): string[] {
  return (Array.isArray(value) ? value : [])
    .map((s) => text(s, length))
    .filter((s) => s.length > 0)
    .slice(0, max);
}

/** Upstream's one-line summary, with the trust note: an opinion, approximate times, checked here before use. */
export function critiqueSummary(model: string, critique: CloudCritique, trimmed: string): string {
  const high = critique.issues.filter((issue) => issue.severity === 'high').length;
  const lead = critique.overall.score === null ? 'unscored' : `${critique.overall.score}/10`;
  const verdict = (critique.overall.verdict || 'no verdict').replace(/\s+$/, '');
  const ended = /[.!?]$/.test(verdict) ? verdict : `${verdict}.`;
  const top = critique.topFixes[0] ? ` Top fix: ${critique.topFixes[0]}` : '';
  return (
    `${model} rates the soundtrack ${lead}: ${ended} ${critique.issues.length} issues (${high} high).${top}` +
    ` An AI opinion, not a measurement: times are approximate; check each fix with audio.critique or` +
    ` audio.listen before and after${trimmed}.`
  ).slice(0, 2000);
}
