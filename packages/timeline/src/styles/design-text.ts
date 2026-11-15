// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * TXT1: `timeline.designText` as pure steps. The video's text looks become a Style of the video's own: the looks
 * as stated, on the rest of the Style the video had (its colours, fonts, captions, logo, intro, outro and grade
 * stay). With no Style before it, the Style's own colours and fonts are read off the stated looks (the first
 * role's letters and what sits behind them), so nothing in it is a look nobody stated. Each role's letter case and
 * arrival go on the role's texts.
 */
import {
  err,
  ok,
  styleSchema,
  textRolesOf,
  type Result,
  type Style,
  type StyleId,
  type TextRoleLook,
  type TextTrackItem,
  type Timeline,
} from '@taalcut/core';
import { InvalidMove } from '../errors';
import type { EditResult, TimelinePart } from '../edits/types';

/** The roles the video's text uses that `looks` leaves out, with how many texts each has. */
export function rolesWithoutLook(timeline: Timeline, looks: readonly TextRoleLook[]) {
  const given = new Set(looks.map((entry) => entry.role));
  return textRolesOf(timeline).filter((use) => !given.has(use.role));
}

/** What the tool is told when a role in use has no look: which roles, and what to send. */
export function missingLooks(timeline: Timeline, looks: readonly TextRoleLook[]): string | null {
  const missing = rolesWithoutLook(timeline, looks);
  if (missing.length === 0) return null;
  const named = missing.map((use) => `"${use.role}" (${use.itemIds.length} texts)`).join(', ');
  return `This video's text also uses ${named}. Give a look for every role its text uses, in one call.`;
}

const luminance = (hex: string) => {
  const channel = (at: number) => parseInt(hex.slice(at, at + 2), 16) / 255;
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
};

/** What the first look's letters sit on: its box, its outline, its shadow, or the far end from the letters. */
function behind(entry: TextRoleLook): string {
  const { look } = entry;
  return (
    look.background?.colour ??
    look.stroke?.colour ??
    look.shadow?.colour ??
    (luminance(look.colour) > 0.5 ? '#000000' : '#ffffff')
  );
}

export interface DesignedStyleInput {
  readonly id: StyleId;
  readonly name: string;
  readonly looks: readonly TextRoleLook[];
  /** The Style the video had, whose other fields are kept; null when it had none. */
  readonly previous: Style | null;
  readonly madeFrom: Style['madeFrom'];
  readonly now: number;
}

/** The video's own Style: the stated looks, on what the video's Style had before. */
export function designedStyle(input: DesignedStyleInput): Result<Style> {
  const { previous, looks } = input;
  const first = looks[0]!;
  const textStyles = {
    ...(previous?.textStyles ?? {}),
    ...Object.fromEntries(looks.map((entry) => [entry.role, entry.look])),
  };
  const accent = looks.find((entry) => entry.look.colour !== first.look.colour)?.look.colour;
  const base = previous
    ? { ...previous }
    : {
        colours: {
          primary: first.look.colour,
          secondary: behind(first),
          accent: accent ?? first.look.colour,
          text: first.look.colour,
          background: behind(first),
        },
        fonts: { heading: first.look.font, body: (looks[1] ?? first).look.font },
        captions: null,
        logo: null,
        watermark: null,
        intro: null,
        outro: null,
        grade: null,
        fontMatch: null,
      };
  const parsed = styleSchema.safeParse({
    ...base,
    schemaVersion: 1,
    id: input.id,
    revision: 1,
    name: input.name,
    kind: 'look',
    textStyles,
    madeFrom: input.madeFrom,
    createdAt: input.now,
    updatedAt: input.now,
  });
  if (!parsed.success) return err(InvalidMove(undefined, { detail: parsed.error.issues[0]?.message }));
  return ok(parsed.data);
}

/** The video pointed at `style`, each role's texts in the role's case and arrival. */
export function designText(
  timeline: Timeline,
  style: Pick<Style, 'id'>,
  looks: readonly TextRoleLook[],
): Result<EditResult> {
  const byRole = new Map(looks.map((entry) => [entry.role, entry]));
  let touched = false;
  const dress = (item: TextTrackItem): TextTrackItem => {
    if (item.type !== 'text') return item;
    const entry = byRole.get(item.styleKey);
    const letterCase = entry?.case ?? item.appearance.case;
    const reveal = entry?.reveal ?? item.reveal;
    if (letterCase === item.appearance.case && reveal === item.reveal) return item;
    touched = true;
    return { ...item, reveal, appearance: { ...item.appearance, case: letterCase } };
  };
  const tracks = timeline.tracks.map((track) =>
    track.kind === 'text' ? { ...track, items: track.items.map(dress) } : track,
  );
  const changed: TimelinePart[] = [];
  if (style.id !== timeline.styleId) changed.push('style');
  if (touched) changed.push('tracks');
  return ok({ timeline: { ...timeline, styleId: style.id, ...(touched ? { tracks } : {}) }, changed });
}
