// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FIX-TOOLGROUPS: a tool call's summary for people (`ToolSpec.describeCall`, `agent.toolFinished.summary`): one
 * plain line that says which item a call was about, "IMG_0412.MOV · 0:48". Language-neutral on purpose: it is made
 * in the tool's process, where the window's language is not known, so it says file names, clock times and numbers,
 * never words that would need translating.
 */

/** The longest summary an event carries, in characters. */
export const TOOL_CALL_SUMMARY_MAX = 200;

/** The file's own name from a path or a name, with either separator: "/Users/me/Trip/IMG_0412.MOV" → "IMG_0412.MOV". */
export function fileNameOf(pathOrName: string): string {
  const parts = pathOrName.split(/[\\/]/);
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index]!.trim();
    if (part) return part;
  }
  return '';
}

/** Seconds as a clock: "0:48", "12:05", "1:02:09". Rounds down to the second; negative or not a number is "0:00". */
export function callClock(seconds: number): string {
  const total = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor(total / 60) % 60;
  const secs = String(total % 60).padStart(2, '0');
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${secs}` : `${minutes}:${secs}`;
}

/**
 * A summary as an event carries it: invisible format characters dropped, control characters and every run of white
 * space one space, at most TOOL_CALL_SUMMARY_MAX characters (cut with "…"). Undefined when nothing is left.
 */
export function toolCallSummary(text: string | undefined | null): string | undefined {
  if (typeof text !== 'string') return undefined;
  const line = text
    .replace(/\p{Cf}/gu, '')
    .replace(/\p{Cc}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!line) return undefined;
  return line.length > TOOL_CALL_SUMMARY_MAX
    ? `${line.slice(0, TOOL_CALL_SUMMARY_MAX - 1).trimEnd()}…`
    : line;
}
