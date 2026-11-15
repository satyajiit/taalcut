// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* eslint-disable lingui/no-unlocalized-strings -- the model's words about a reel: data, never translated */

/**
 * FIX-DOCKCHAT: the reel a run on 2026-11-14 read and cast, slot by slot, as its template and timeline held it:
 * 32 slots over 14.6 s (three slow ones, then cuts a quarter of a second apart), each with the sentence the
 * breakdown wrote for it (80 to 123 characters), and the cast as it stood when the editor's chat showed it: nine
 * picks swapped by hand, two checked again, most of the rest unsure, two or three other shots a slot. The shape is
 * what the cast board has to lay out in the editor's narrow chat; the footage is the fake library's.
 */
import type { Template } from '@taalcut/core';

type Intent = Template['slots'][number]['intent'];

export interface ReelRunSlot {
  readonly frames: number;
  readonly role: Template['slots'][number]['role'];
  readonly shotType: Intent['shotType'];
  readonly motion: Intent['motion'];
  readonly energy: number;
  /** How sure the cast was of its pick; null where you chose the shot, or nothing scored it. */
  readonly confidence: number | null;
  readonly note: 'userPick' | 'reranked' | null;
  /** How many other shots the slot keeps. */
  readonly alternates: number;
  /** What the slot wants, in the breakdown's words. */
  readonly text: string;
}

type Shape = readonly [
  frames: number,
  role: ReelRunSlot['role'],
  shotType: ReelRunSlot['shotType'],
  motion: ReelRunSlot['motion'],
  energy: number,
  confidence: number | null,
  note: ReelRunSlot['note'],
  alternates: number,
];

const SHAPES: readonly Shape[] = [
  [47, 'hook', 'wide', 'tilt', 0.3, null, 'userPick', 3],
  [37, 'body', 'close', 'handheld', 0.35, 0.28, null, 3],
  [68, 'body', 'close', 'handheld', 0.45, null, 'userPick', 3],
  [9, 'body', 'medium', 'static', 0.75, null, 'userPick', 3],
  [9, 'body', 'medium', 'static', 0.8, 0.68, null, 3],
  [7, 'body', 'medium', 'static', 0.8, 0.3, null, 3],
  [8, 'body', 'wide', 'static', 0.8, 0.58, null, 3],
  [7, 'body', 'aerial', 'static', 0.8, 0.08, null, 3],
  [24, 'body', 'wide', 'handheld', 0.55, 0.7, null, 3],
  [9, 'body', 'aerial', 'static', 0.8, 0.3, null, 3],
  [7, 'body', 'wide', 'static', 0.8, 0.35, null, 3],
  [7, 'body', 'wide', 'static', 0.85, 0.54, null, 3],
  [7, 'body', 'medium', 'handheld', 0.8, null, 'userPick', 3],
  [7, 'body', 'medium', 'handheld', 0.7, 0.34, null, 3],
  [7, 'body', 'pov', 'static', 0.75, 0.76, null, 3],
  [19, 'body', 'medium', 'static', 0.55, null, 'userPick', 3],
  [7, 'body', 'pov', 'static', 0.75, null, null, 3],
  [7, 'body', 'wide', 'static', 0.8, 0.6, null, 3],
  [7, 'body', 'pov', 'handheld', 0.8, 0, 'reranked', 2],
  [7, 'body', 'pov', 'static', 0.65, 0, 'reranked', 2],
  [8, 'body', 'medium', 'static', 0.75, 0.01, null, 3],
  [6, 'body', 'medium', 'static', 0.8, 0.18, null, 3],
  [21, 'body', 'medium', 'static', 0.45, null, 'userPick', 3],
  [7, 'body', 'wide', 'static', 0.8, null, null, 3],
  [7, 'body', 'close', 'static', 0.85, 0.53, null, 3],
  [8, 'peak', 'wide', 'static', 0.9, 0.55, null, 3],
  [7, 'body', 'close', 'static', 0.8, null, null, 3],
  [7, 'body', 'medium', 'static', 0.85, null, null, 3],
  [8, 'body', 'medium', 'static', 0.85, 0.32, null, 3],
  [8, 'body', 'close', 'static', 0.8, null, 'userPick', 3],
  [8, 'body', 'medium', 'static', 0.65, null, 'userPick', 3],
  [35, 'outro', 'pov', 'pull-out', 0.4, null, 'userPick', 3],
];

const WORDS: readonly string[] = [
  'A wide golden-hour travel view tilts up for a calm opening under the lyric hook.',
  'Handheld close-up of a personal travel detail indoors; a preparation beat that keeps the opening unhurried.',
  'Handheld close personal detail gives way to a bright open view, completing the slower travel setup.',
  'Static medium view of a colorful indoor detail; the first quick cut opens the rapid travel montage.',
  'Static upward medium view of a busy indoor passage; a quick orientation beat with people in the background.',
  'Static medium view of an illuminated indoor detail; a second, more focused orientation beat in the fast sequence.',
  'Static wide travel view against bright blue sky; the montage opens out from the indoor details.',
  'Static aerial travel view in clear daylight; open space gives the rapid montage a brief scenic release.',
  'Handheld wide travel view in warm sunset light; a slightly longer scenic pause amid the fast cuts.',
  'Static aerial travel view after dark; distant lights shift the montage from day into night.',
  'Static medium-wide view of a colorful indoor public space; a quick arrival glimpse after the night view.',
  'Static wide view of a busy arrival area at night; background activity adds bustle to the travel montage.',
  'Handheld medium view of a traveler from behind, walking through a bright indoor passage toward a stop.',
  'Handheld rear view of the traveler now waiting in a dim interior; a brief pause in the arrival sequence.',
  "Static downward POV of the traveler's legs indoors; a warm-lit arrival detail breaks up the wider views.",
  'Static medium exterior view with bright accents against the night sky; a longer pause establishes the destination.',
  "Static downward POV returns to the traveler's feet, a tight warm-lit detail after the night exterior.",
  'Static wide view of an outdoor passage at night; contrasting colored light adds atmosphere between personal details.',
  "Handheld downward POV of the traveler's feet on a textured surface; a dim, warm close detail keeps the quick rhythm.",
  "Static low POV past the traveler's resting legs into a warm-lit room; a brief settling-in moment.",
  'Static medium view of a warm-lit room; a quick glimpse of the place to rest after the personal arrival details.',
  'Static medium view of textured surroundings under colored night lights; a brief atmospheric accent between indoor moments.',
  'Static medium view of a seated traveler glancing toward the camera then down; a longer, warm-lit pause during the stay.',
  'Static wide view across a warm-lit room; a quick spatial reset after the seated personal moment.',
  'Static overhead close-up of a meal indoors; a quick comfort detail in soft light.',
  'Static low-angle wide view of an outdoor leisure space in soft daylight; a bright destination reveal.',
  'Static close view of a meal beside a window; soft daylight resets the mood after the outdoor reveal.',
  'Static medium view of outdoor texture under colored night lights; a quick atmospheric beat near the end.',
  'Static medium view of the traveler stepping through a doorway into a warm interior; a brief burst of human motion.',
  'Static close-up of a meal by a bright window; cooler daylight contrasts with the preceding warm interior.',
  'Static medium rear view of the traveler looking out a bright window; a quiet human beat before the finish.',
  'A low personal POV pulls out from a relaxed outdoor moment in soft daylight; the longer final hold lets the montage settle.',
];

export const REEL_RUN_SLOTS: readonly ReelRunSlot[] = SHAPES.map(
  ([frames, role, shotType, motion, energy, confidence, note, alternates], index) => ({
    frames,
    role,
    shotType,
    motion,
    energy,
    confidence,
    note,
    alternates,
    text: WORDS[index] ?? '',
  }),
);
