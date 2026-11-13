// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EAR1-X1: what this Mac measured, as plain text for the prompt (earshot `llm.py` `context`): the clip that is sent,
 * the loudness numbers the model must use instead of guessing, and with `withTimeline` this Mac's own listening
 * summary (events, sections, tempo, key) in file seconds. Only numbers and the listening layer's English labels go
 * out: no file path, no transcript.
 */
import { RationalTime, type SoundEvent, type SoundMeasures, type SoundSection } from '@taalcut/core';
import { CLOUD_CRITIQUE_CONTEXT_CHARS } from './schema';

/** The window of the source that is sent, in file seconds. */
export interface ClipWindow {
  readonly startS: number;
  readonly endS: number;
  /** The whole source's length. */
  readonly fileSeconds: number;
  readonly codec: string;
}

/** What the listening layer heard over the window (audio.listen.analyse), its times from the window's start. */
export interface CritiqueFacts {
  readonly measures: SoundMeasures | null;
  /** With `withTimeline` only. */
  readonly timeline?: {
    readonly events: readonly SoundEvent[];
    readonly sections: readonly SoundSection[];
  };
  /** Why something wasn't measured or sent ("sections need the listening models, not installed"). */
  readonly notes: readonly string[];
}

const fixed1 = (n: number) => n.toFixed(1);
const secondsOf = (t: RationalTime) => RationalTime.toSeconds(t);
/** Upstream rounds to 2 decimals and drops trailing zeros (Python's `g`). */
const short = (n: number) => String(Math.round(n * 100) / 100);

function measuredLine(m: SoundMeasures): string {
  const got: string[] = [];
  if (m.lufs !== null) got.push(`integrated loudness ${short(m.lufs)} LUFS`);
  got.push(`true peak ${short(m.truePeakDbtp)} dBTP`);
  if (m.lraLu !== null) got.push(`loudness range ${short(m.lraLu)} LU`);
  if (m.lufs !== null && m.crestLu !== null) got.push(`short-term max ${short(m.lufs + m.crestLu)} LUFS`);
  got.push(`quietest 20 ms level (10th percentile) ${short(m.noiseFloorDbfs)} dBFS`);
  return `Measured by Taalcut on this Mac (exact; use these, never estimate loudness): ${got.join(', ')}.`;
}

function musicLine(m: SoundMeasures): string | undefined {
  const parts: string[] = [];
  if (m.tempo) parts.push(`tempo ${short(m.tempo.bpm)} BPM (${m.tempo.confidence} pulse)`);
  if (m.key) parts.push(`key ${m.key.tonic} ${m.key.mode}`);
  return parts.length > 0 ? `Music grid: ${parts.join(', ')}.` : undefined;
}

/** The listening summary, in file seconds: what the hosted model can't measure itself. */
function timelineText(facts: NonNullable<CritiqueFacts['timeline']>, startS: number): string {
  const lines: string[] = [];
  for (const section of facts.sections) {
    const a = secondsOf(section.start) + startS;
    const b = secondsOf(section.end) + startS;
    lines.push(`section ${fixed1(a)}-${fixed1(b)} s: ${section.label}`);
  }
  for (const event of facts.events) {
    const t = secondsOf(event.at) + startS;
    const kind = event.kind ? ` ${event.kind}` : '';
    lines.push(
      `${event.shape}${kind} at ${t.toFixed(2)} s, ${short(event.prominenceDb)} dB over its bed` +
        `${event.exposed ? ' (exposed)' : ''}`,
    );
  }
  return lines.length > 0 ? lines.join('\n') : 'no events or sections found';
}

/** The context text the prompt carries after the rubric. */
export function critiqueContext(clip: ClipWindow, facts: CritiqueFacts): string {
  const seconds = clip.endS - clip.startS;
  const lines = [
    `Clip under review: ${fixed1(seconds)} s (file seconds ${fixed1(clip.startS)}-${fixed1(clip.endS)} of a ` +
      `${fixed1(clip.fileSeconds)} s file), sent as ${clip.codec} for this review.`,
  ];
  if (facts.measures) {
    lines.push(measuredLine(facts.measures));
    const music = musicLine(facts.measures);
    if (music) lines.push(music);
  }
  if (facts.timeline) {
    const from = clip.startS > 0 ? `, clip starts at file second ${fixed1(clip.startS)}` : '';
    const body = timelineText(facts.timeline, clip.startS).slice(0, CLOUD_CRITIQUE_CONTEXT_CHARS);
    lines.push(`Taalcut listening transcript (machine-made; file times${from}):\n${body}`);
  }
  return lines.join('\n');
}
