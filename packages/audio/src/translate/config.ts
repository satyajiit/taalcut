// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Caption translation's rules (SPEC P3.11). The per-call unit and context limits are core's TRANSLATION_LIMITS. */
export const TRANSLATE_CONFIG = {
  /** A gap this long between two cues ends a unit, like end punctuation does. */
  pauseMs: 600,
  /** At most this many cues in one unit. */
  maxCuesPerUnit: 3,
  /** Each word keeps at least this long on screen, so a cue holds at most duration / minWordMs words. */
  minWordMs: 120,
  /** A cue longer than this many times its source graphemes sends its unit back once for a shorter line. */
  overflowRatio: 1.3,
  /** captionCueSchema's words per cue, and the command's characters per cue text. */
  maxCueWords: 40,
  maxCueChars: 500,
} as const;
