// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The "[Taalcut] The user pointed at:" note (P3-V15): one line per place with the ids the model acts on, the
 * slot number, both videos' times, the slot's intent (template text, fenced as untrusted) and, for a cut, the
 * transition. An unresolved reference says why, so the model tells the user instead of guessing.
 * Model-facing text, not user-facing copy.
 */
import { escapeUntrusted, FrameRate, RationalTime, TimeRange } from '@taalcut/core';
import type { ResolvedReference } from './resolve';

const TENTHS = FrameRate.of(10);

/** 4.5 s → "0:04.5": model-facing, to the tenth, in the units the user wrote. */
export function clock(time: RationalTime): string {
  const tenths = RationalTime.toFrames(time, TENTHS);
  const minutes = Math.floor(tenths / 600);
  const rest = tenths % 600;
  return `${minutes}:${String(Math.floor(rest / 10)).padStart(2, '0')}.${rest % 10}`;
}

const span = (range: TimeRange) =>
  TimeRange.isEmpty(range)
    ? `at ${clock(range.start)}`
    : `${clock(range.start)}–${clock(TimeRange.end(range))}`;

const VIDEO = { template: 'the reference', timeline: 'their video' } as const;

function unresolvedLine(said: string, place: ResolvedReference): string {
  const { why, count } = place;
  const video = VIDEO[place.basis];
  const where = place.range ? ` (${span(place.range)})` : '';
  switch (why) {
    case 'noTemplate':
      return `${said}: no reference in this conversation yet.`;
    case 'noTimeline':
      return `${said}: no video made in this conversation yet.`;
    case 'noCut':
      return `${said}: no cut within half a second of that time in ${video}${where}.`;
    default:
      return count !== null
        ? `${said}: ${video} has ${count} slots, so there is no slot ${place.slotNumber ?? 'like that'}.`
        : `${said}: nothing there in ${video}${where}; it is shorter.`;
  }
}

function line(place: ResolvedReference): string {
  const said = JSON.stringify(place.said);
  if (place.kind === 'unresolved') return `- ${unresolvedLine(said, place)}`;
  const what =
    place.kind === 'cut'
      ? `the cut into slot ${place.slotNumber}`
      : place.kind === 'range'
        ? `a range from slot ${place.slotNumber}`
        : `slot ${place.slotNumber}`;
  const parts = [
    `${said} → ${what} of ${VIDEO[place.basis]}`,
    `slot id ${place.slotId ?? 'none'}`,
    ...(place.clipId ? [`clip id ${place.clipId}`] : []),
    ...(place.templateId ? [`template ${place.templateId}`] : []),
    ...(place.timelineId ? [`timeline ${place.timelineId}`] : []),
    ...(place.templateRange ? [`in the reference ${span(place.templateRange)}`] : []),
    ...(place.timelineRange ? [`in their video ${span(place.timelineRange)}`] : []),
    ...(place.theirs
      ? [`their timeline ${place.theirs.timelineId}, clip id ${place.theirs.clipId ?? 'none (a gap)'}`]
      : []),
    ...(place.transition ? [`transition: ${place.transition}`] : []),
    ...(place.covers.length > 1 ? [`covers slots ${place.covers.join(', ')}`] : []),
    ...(place.intent
      ? [`intent: <untrusted source="template">${escapeUntrusted(place.intent)}</untrusted>`]
      : []),
  ];
  return `- ${parts.join('; ')}`;
}

/** The note for a message's places (the transcript adds the "[Taalcut]" prefix); empty when there are none. */
export function pointerNote(places: readonly ResolvedReference[]): string {
  if (places.length === 0) return '';
  return [
    'The user pointed at:',
    ...places.map(line),
    'Act on these ids. For one that could not be found, tell the user; never guess another.',
  ].join('\n');
}
