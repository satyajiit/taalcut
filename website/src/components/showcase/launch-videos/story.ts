// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The launch video in the showcase: Taalcut made with Taalcut, from taalcut.app. The brief, its sources, the script's
 * scenes and the production's tasks, in the app's own words (apps/renderer/src/features/create, read, never imported:
 * create-words.ts, create-sources.tsx, create-scene.tsx, create-production.tsx, shared/video-format-picker.tsx). The
 * site never says "draft": the app's "new draft" reads as "version" here. When things happen is pass.ts.
 */

import type { SlotRole } from '#content/schema';

/* ---------------------------------------------------------------------------------------------------------------- */
/* The brief                                                                                                        */
/* ---------------------------------------------------------------------------------------------------------------- */

export const BRIEF = {
  title: 'Taalcut launch',
  category: 'Product launch',
  idea: 'A launch video for Taalcut: a reel you saved, made again from your own clips. Quick and warm, ending on the waitlist.',
  seconds: 30,
} as const;

export type Aspect = '16:9' | '9:16' | '1:1' | '4:5';

/**
 * The output formats, as the app's format picker names them, landscape first (video-format-picker.tsx), each with its
 * width over height. `side` is a frame's width at equal area (the square root of the ratio): four frames of one video
 * side by side, none smaller than the others.
 */
export const FORMATS: readonly { readonly id: Aspect; readonly label: string; readonly ratio: number; readonly side: number }[] = [
  { id: '16:9', label: 'Landscape · 16:9', ratio: 16 / 9, side: Math.sqrt(16 / 9) },
  { id: '9:16', label: 'Portrait · 9:16', ratio: 9 / 16, side: Math.sqrt(9 / 16) },
  { id: '1:1', label: 'Square · 1:1', ratio: 1, side: 1 },
  { id: '4:5', label: 'Portrait · 4:5', ratio: 4 / 5, side: Math.sqrt(4 / 5) },
];

export function formatOf(id: Aspect) {
  return FORMATS.find((f) => f.id === id) ?? FORMATS[0]!;
}

/** Toggle a format in the brief's set, never leaving it empty ("Every creation needs a delivery format"). */
export function toggleFormat(chosen: readonly Aspect[], id: Aspect): readonly Aspect[] {
  if (chosen.includes(id)) return chosen.length > 1 ? chosen.filter((f) => f !== id) : chosen;
  return FORMATS.map((f) => f.id).filter((f) => f === id || chosen.includes(f));
}

/**
 * Each frame's width as a share of its row, so the chosen formats share one row at equal area. In `pairs` (a narrow
 * window) they go two to a row, each pair sharing its own row.
 */
export function frameShares(chosen: readonly Aspect[], pairs: boolean): readonly number[] {
  const sides = chosen.map((id) => formatOf(id).side);
  return sides.map((side, i) => {
    const row = pairs ? sides.slice(i - (i % 2), i - (i % 2) + 2) : sides;
    return side / row.reduce((sum, s) => sum + s, 0);
  });
}

export type Voice = 'connected' | 'upload' | 'none';

export const VOICES: readonly { readonly value: Voice; readonly label: string }[] = [
  { value: 'connected', label: 'Generate a voiceover' },
  { value: 'upload', label: 'Use a recording' },
  { value: 'none', label: 'No voiceover' },
];

/* ---------------------------------------------------------------------------------------------------------------- */
/* Sources (create-sources.tsx): the website, a project folder, two clips from the library, and a recording         */
/* ---------------------------------------------------------------------------------------------------------------- */

export type SourceKind = 'website' | 'folder' | 'media' | 'recording';

export interface Source {
  readonly id: string;
  readonly kind: SourceKind;
  readonly name: string;
  /** What research did with it, in a few words. */
  readonly read: string;
  /** A clip from the library: the camera roll's id, for its frame. */
  readonly clipId?: string;
}

export const SOURCES: readonly Source[] = [
  { id: 'site', kind: 'website', name: 'taalcut.app', read: 'Website · three pages read, with screenshots' },
  { id: 'folder', kind: 'folder', name: 'website', read: 'Project folder · its app captured in an isolated copy' },
  { id: 'karst', kind: 'media', name: 'Karst field', read: 'Clip from your library', clipId: 'repeat-03' },
  { id: 'arches', kind: 'media', name: 'Starry arches', read: 'Clip from your library', clipId: 'vietnam-12' },
  { id: 'voice', kind: 'recording', name: 'launch-voice.m4a', read: 'Your voice recording' },
];

/** The sources a brief with this voice holds: the recording only when the voiceover is yours. */
export function sourcesFor(voice: Voice): readonly Source[] {
  return SOURCES.filter((s) => s.kind !== 'recording' || voice === 'upload');
}

/* ---------------------------------------------------------------------------------------------------------------- */
/* The script: up to 12 scenes, each its words on screen, narration and length (create-scene.tsx)                   */
/* ---------------------------------------------------------------------------------------------------------------- */

/** The most scenes a script holds (packages/agent SPEC, CREATE1: "the writer emits at most twelve beats"). */
export const MAX_SCENES = 12;

export type SceneLook = 'hook' | 'read' | 'pick' | 'check' | 'approve' | 'close';

export interface Scene {
  readonly id: string;
  readonly look: SceneLook;
  /** Its part of the video, for the scene bar's brackets. */
  readonly group: SlotRole;
  /** On-screen words. */
  readonly words: string;
  readonly narration: string;
  /** Length in seconds. */
  readonly seconds: number;
}

export const SCENES: readonly Scene[] = [
  {
    id: 's1',
    look: 'hook',
    group: 'hook',
    words: 'Every reel you save becomes one you can make.',
    narration: 'You saved a reel to make one like it. Taalcut makes it with your clips.',
    seconds: 5,
  },
  {
    id: 's2',
    look: 'read',
    group: 'build',
    words: 'Paste a reel. It finds the cuts and music beats.',
    narration: 'Paste a link or drop a file, and Taalcut reads its cuts, music beats and words on screen.',
    seconds: 5,
  },
  {
    id: 's3',
    look: 'pick',
    group: 'build',
    words: 'Each slot gets the clip that fits.',
    narration: 'Your camera roll is indexed on your computer, and the AI picks a clip for each slot.',
    seconds: 5.5,
  },
  {
    id: 's4',
    look: 'check',
    group: 'peak',
    words: 'Checked against the reel before you see it.',
    narration: 'The agent checks the cut against the reel before you see it.',
    seconds: 4.5,
  },
  {
    id: 's5',
    look: 'approve',
    group: 'peak',
    words: 'Approve once.',
    narration: 'You watch your version and approve once. Undo covers every edit.',
    seconds: 4,
  },
  {
    id: 's6',
    look: 'close',
    group: 'outro',
    words: 'Join the waitlist at taalcut.app',
    narration: 'Taalcut. Join the waitlist at taalcut.app.',
    seconds: 6,
  },
];

/** A scene's length can change in half seconds, from 1 to 12 (create-scene.tsx takes any length above zero). */
export const SECONDS_STEP = 0.5;
export const SECONDS_MIN = 1;
export const SECONDS_MAX = 12;

export function changeSeconds(seconds: number, by: number): number {
  const next = Math.round((seconds + by) / SECONDS_STEP) * SECONDS_STEP;
  return Math.min(SECONDS_MAX, Math.max(SECONDS_MIN, next));
}

export function totalSeconds(scenes: readonly Pick<Scene, 'seconds'>[]): number {
  return scenes.reduce((sum, s) => sum + s.seconds, 0);
}

/** Where each scene starts and ends on the video's clock, in seconds. */
export function sceneSpans(scenes: readonly Pick<Scene, 'seconds'>[]): readonly (readonly [number, number])[] {
  let at = 0;
  return scenes.map((s) => {
    const span = [at, at + s.seconds] as const;
    at += s.seconds;
    return span;
  });
}

/** The scene playing at `t` seconds (the last one from its start to the end). */
export function sceneAt(scenes: readonly Pick<Scene, 'seconds'>[], t: number): number {
  const spans = sceneSpans(scenes);
  const i = spans.findIndex(([, end]) => t < end);
  return i === -1 ? Math.max(0, scenes.length - 1) : i;
}

/** Seconds as the script shows them: "5 s", "5.5 s". */
export function secondsLabel(seconds: number): string {
  return `${Number.isInteger(seconds) ? seconds : seconds.toFixed(1)} s`;
}

/** A length as a clock: 30 → "0:30". */
export function clock(seconds: number): string {
  const whole = Math.floor(seconds + 1e-6);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

/* ---------------------------------------------------------------------------------------------------------------- */
/* Production: the director's specialists, each a task (create-words.ts TASK_ROLES, TASK_ACTIVITY, TASK_STATUS)      */
/* ---------------------------------------------------------------------------------------------------------------- */

export type TaskRole = 'researcher' | 'writer' | 'designer' | 'voice' | 'reviewer';
export type TaskStatus = 'queued' | 'running' | 'completed';

export const TASKS: readonly { readonly role: TaskRole; readonly label: string; readonly activity: string }[] = [
  { role: 'researcher', label: 'Research', activity: 'Researching your sources' },
  { role: 'writer', label: 'Script', activity: 'Writing the script' },
  { role: 'designer', label: 'Design', activity: 'Designing the scenes' },
  { role: 'voice', label: 'Voiceover', activity: 'Preparing the voiceover' },
  { role: 'reviewer', label: 'Review', activity: 'Reviewing the finished video' },
];

export const TASK_STATUS_WORDS: Readonly<Record<TaskStatus, string>> = {
  queued: 'Waiting',
  running: 'Working',
  completed: 'Complete',
};

/** The tasks a brief with this voice runs: no voiceover skips synthesis. */
export function tasksFor(voice: Voice) {
  return TASKS.filter((t) => t.role !== 'voice' || voice !== 'none');
}
