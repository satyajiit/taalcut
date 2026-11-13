// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { RationalTime, type AuthoredProgram } from '@taalcut/core';

/** Source edits retain chapter identities and clamp only chapters touched by the new end. */
export function authoredSourceDuration(program: AuthoredProgram, seconds: number): AuthoredProgram {
  const duration = RationalTime.fromSeconds(seconds, program.canvas.rate);
  return {
    ...program,
    duration,
    chapters: program.chapters.flatMap((chapter) => {
      if (RationalTime.compare(chapter.start, duration) >= 0) return [];
      const available = RationalTime.subtract(duration, chapter.start);
      return [{ ...chapter, duration: RationalTime.min(chapter.duration, available) }];
    }),
  };
}
