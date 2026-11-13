// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EDT1-OPS: older callers' inputs, mended before the tool checks them (core `ToolSpec.mendInput`, which the executor
 * applies): the clip fields the editor tools renamed, a trim's `bySeconds` and `byBeats`, a move's `toIndex`, a slip's
 * part sent as fields of its own.
 */

/**
 * EDT1-OPS: an input from an older caller mended to the renamed fields (core `ToolSpec.mendInput`): `clipId` becomes
 * `clip`, a grade's `clipIds` its `clips`, a sound's `of.clipIds` its `of.clips`, an insert's `position.itemId` its
 * `position.clip`. An MCP client, a stored or recorded call and a QA fix still send the old names; the model sees only
 * the new ones. A field already sent by its new name is kept, and the input is otherwise as sent.
 */
export function mendClipFields(input: unknown): unknown {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return input;
  const raw = { ...(input as Record<string, unknown>) };
  const rename = (from: Record<string, unknown>, old: string, now: string) => {
    if (from[old] === undefined) return;
    if (from[now] === undefined) from[now] = from[old];
    delete from[old];
  };
  rename(raw, 'clipId', 'clip');
  rename(raw, 'clipIds', 'clips');
  for (const key of ['of', 'position'] as const) {
    const inner = raw[key];
    if (inner === null || typeof inner !== 'object' || Array.isArray(inner)) continue;
    const copy = { ...(inner as Record<string, unknown>) };
    if (key === 'of') rename(copy, 'clipIds', 'clips');
    else if (copy.kind === 'before' || copy.kind === 'after') rename(copy, 'itemId', 'clip');
    raw[key] = copy;
  }
  return raw;
}

/**
 * timeline.trimClip's mend: the clip fields, and an older caller's length as `by` (json.ts `trimBySchema`): bySeconds
 * becomes {"seconds"}, byBeats {"beats"}. When two came, one is kept: bySeconds, else byBeats, else by. The 9B sent
 * bySeconds with byBeats (eval run 13: 1 s with 2 beats for "a second longer", -1 s with -1 beat for "down to one
 * second") and gave the seconds alone when told to give one. It sent by with bySeconds (by -1 at the canvas rate,
 * bySeconds -0.5 for a beat), and when told to give one, gave by and trimmed a whole second.
 */
export function mendTrimFields(input: unknown): unknown {
  const raw = mendClipFields(input);
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const { bySeconds, byBeats, ...rest } = raw as Record<string, unknown>;
  if (bySeconds !== undefined) return { ...rest, by: { seconds: bySeconds } };
  if (byBeats !== undefined) return { ...rest, by: { beats: byBeats } };
  return raw;
}

/**
 * timeline.moveClip's mend: the clip fields, and an older caller's `toIndex` (from 0) as `to` (from 1). With a gap
 * before that place the two count differently (a position counts a gap, a clip number doesn't); `to` is the clip's.
 */
export function mendMoveFields(input: unknown): unknown {
  const raw = mendClipFields(input);
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const { toIndex, ...rest } = raw as Record<string, unknown>;
  if (toIndex === undefined) return raw;
  if (rest.to !== undefined) return rest;
  // A whole index from 0 is the next number; anything else goes on as words, which the tool refuses with the numbers.
  const index = typeof toIndex === 'number' ? toIndex : typeof toIndex === 'string' && /^-?\d+(\.\d+)?$/.test(toIndex.trim()) ? Number(toIndex) : NaN;
  return { ...rest, to: Number.isInteger(index) && index >= 0 ? index + 1 : String(toIndex) };
}

/**
 * FIX-TRIM: timeline.slipClip's mend: the clip fields, and a part sent beside it rather than in `part` (one form per
 * field): `bySeconds` or `seconds` becomes {"seconds"}, `avoid` {"avoid"}, one word of it a list of one. With `part`
 * given, the input is as sent.
 */
export function mendSlipFields(input: unknown): unknown {
  const raw = mendClipFields(input);
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const { bySeconds, seconds, avoid, ...rest } = raw as Record<string, unknown>;
  if (rest.part !== undefined) return raw;
  const by = bySeconds ?? seconds;
  if (by !== undefined) return { ...rest, part: { seconds: by } };
  if (avoid !== undefined) return { ...rest, part: { avoid: typeof avoid === 'string' ? [avoid] : avoid } };
  return raw;
}
