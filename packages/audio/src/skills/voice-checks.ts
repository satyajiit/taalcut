// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The Voice director's second method (SPEC P3.8), pure over the stored timeline and the handoff: the voiceover
 * handed off is the stored one at the stored revision; every line has its clip on the voice track, inside the
 * timeline; each onset sits within one frame of its beat or is flagged off-beat; a handoff that says final has no
 * draft line left; and the music handed off is the timeline's, a generated track only with a passing grid check.
 * Reasons are model-facing: each says what to call to fix it.
 */
import { RationalTime, type MusicPath, type SkillVerdict, type Timeline } from '@taalcut/core';
import { trackOfRole } from '../commands/audio-track';
import { frameMs, timelineFrames } from '../timeline/span';

export interface VoiceHandoff {
  readonly timelineId: string;
  readonly revision: number;
  readonly voiceoverId: string;
  readonly lines: number;
  readonly quality: 'draft' | 'final';
  readonly music: MusicPath;
  readonly duckingMinMarginLu: number | null;
}

/** A generated track passes the grid check when p95 sits within a frame and at most 5 % of beats are missed. */
const MAX_MISSED = 0.05;

interface PlacedClip {
  readonly startFrame: number;
  readonly endFrame: number;
  readonly beatIndex: number | null;
}

/** The voice track's clips by id, with where they sit in canvas frames. */
function voiceClips(timeline: Timeline): Map<string, PlacedClip> {
  const clips = new Map<string, PlacedClip>();
  let at = 0;
  for (const item of trackOfRole(timeline, 'voice')?.items ?? []) {
    if (item.type === 'transition') continue;
    if (item.type === 'clip')
      clips.set(item.id, {
        startFrame: at,
        endFrame: at + item.duration.value,
        beatIndex: item.beatAnchor?.beatIndex ?? null,
      });
    at += item.duration.value;
  }
  return clips;
}

const retry = (reason: string): SkillVerdict => ({ verdict: 'retry', reason });

function lineProblem(timeline: Timeline, clips: ReadonlyMap<string, PlacedClip>, end: number) {
  const beats = timeline.beatMap?.beats ?? [];
  for (const [i, line] of (timeline.voiceover?.lines ?? []).entries()) {
    const clip = line.clipId ? clips.get(line.clipId) : undefined;
    if (!clip) return `Line ${i + 1} (${line.id}) has no clip on the voice track: call voice.place.`;
    if (clip.endFrame > end) return `Line ${i + 1} runs past the end of the video: call voice.place.`;
    if (line.offBeat || beats.length === 0) continue;
    const beat = clip.beatIndex === null ? undefined : beats[clip.beatIndex];
    if (!beat) return `Line ${i + 1} has no beat and isn't flagged off-beat: call voice.place.`;
    const beatFrame = RationalTime.toFrames(beat, timeline.canvas.rate);
    if (Math.abs(clip.startFrame - beatFrame) > 1)
      return `Line ${i + 1} starts ${clip.startFrame - beatFrame} frames from its beat: call voice.place.`;
  }
  return null;
}

function musicProblem(timeline: Timeline, handoff: VoiceHandoff) {
  const music = timeline.music;
  if (handoff.music !== music.path)
    return `The timeline's music is ${music.path}, not ${handoff.music}: hand off what the timeline has.`;
  if (music.path !== 'generated') return null;
  const frame = frameMs(timeline);
  if (music.grid.p95ErrorMs > frame || music.grid.missed > MAX_MISSED)
    return 'The generated music is off the beat grid: call music.generate again or choose a library track.';
  return null;
}

export function checkVoiceHandoff(timeline: Timeline, handoff: VoiceHandoff): SkillVerdict {
  if (timeline.id !== handoff.timelineId) return retry('Hand off the timeline you were given.');
  if (timeline.revision !== handoff.revision)
    return retry(`The stored timeline is at revision ${timeline.revision}: hand off that revision.`);
  const voiceover = timeline.voiceover;
  if (!voiceover || voiceover.id !== handoff.voiceoverId)
    return retry(
      `No voiceover ${handoff.voiceoverId} on the timeline: hand off the id voice.generate returned.`,
    );
  if (voiceover.lines.length !== handoff.lines)
    return retry(`The voiceover has ${voiceover.lines.length} lines, not ${handoff.lines}.`);
  if (handoff.quality === 'final' && voiceover.lines.some((line) => line.quality === 'draft'))
    return retry('Some lines are still drafts: call voice.finalize, or hand off quality draft.');
  const placed = lineProblem(timeline, voiceClips(timeline), timelineFrames(timeline));
  if (placed) return retry(placed);
  const music = musicProblem(timeline, handoff);
  if (music) return retry(music);
  const margin = timeline.mix.ducking.marginLu;
  if (handoff.duckingMinMarginLu !== null && handoff.duckingMinMarginLu < margin)
    return retry(`The voice is only ${handoff.duckingMinMarginLu} LU above the music: keep ducking on.`);
  return { verdict: 'pass' };
}
