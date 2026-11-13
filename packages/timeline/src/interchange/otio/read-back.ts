// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * An OTIO file read back to a cut list (P3-V5): each track laid out the way OpenTimelineIO lays it out (children
 * end to end by their source_range durations; transitions take no time), converted to canvas frames at the
 * global start time's rate. What the export command and the round-trip tests compare with the timeline's.
 */
import { err, ok, ValidationError, type Result } from '@taalcut/core';
import type { CutEntry, CutList } from '../cut-list';
import { reduce, secondsKey } from '../seconds';
import { otioTimelineSchema, type OtioTimeline } from './schema';

/** A `.otio` file's text parsed and checked against the subset Taalcut writes. */
export function readOtio(text: string): Result<OtioTimeline> {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (cause) {
    return err(
      ValidationError({ field: 'otio' }, { detail: cause instanceof Error ? cause.message : 'not JSON' }),
    );
  }
  const parsed = otioTimelineSchema.safeParse(json);
  if (parsed.success) return ok(parsed.data);
  return err(ValidationError({ field: 'otio' }, { detail: parsed.error.issues[0]?.message ?? '' }));
}

/** The rational a writer's rate double came from (whole rates and the NTSC x/1001 family), else null. */
export function rateOf(double: number): { readonly num: bigint; readonly den: bigint } | null {
  for (const den of [1, 1001, 1000, 100]) {
    const num = Math.round(double * den);
    if (num / den === double) return { num: BigInt(num), den: BigInt(den) };
  }
  return null;
}

/** A value at a rate double as exact seconds; a non-whole value or an unknown rate reads as inexact. */
function seconds(value: number, rate: number): string {
  const exact = rateOf(rate);
  if (!exact || !Number.isInteger(value)) return `~${value / rate}`;
  return secondsKey(reduce(BigInt(value) * exact.den, exact.num));
}

type Metadata = Readonly<Record<string, unknown>>;
const taalcut = (metadata: { readonly Taalcut?: Metadata }): Metadata => metadata.Taalcut ?? {};
const text = (value: unknown): string | null => (typeof value === 'string' ? value : null);

type OtioTrack = OtioTimeline['tracks']['children'][number];
type OtioChild = Exclude<OtioTrack['children'][number], { readonly OTIO_SCHEMA: 'Transition.1' }>;

/** Where a child sits on its track, in canvas frames. */
interface Place {
  readonly start: number;
  readonly frames: number;
}

/** A track child's entry, or null for what the cut list leaves out (an audio gap). */
function childEntry(child: OtioChild, track: OtioTrack, trackId: string, place: Place): CutEntry | null {
  if (child.OTIO_SCHEMA === 'Gap.1')
    return track.kind === 'Video'
      ? { track: trackId, kind: 'gap', ...place, assetId: null, inPoint: null }
      : null;
  const span = child.source_range;
  return {
    track: trackId,
    kind: 'clip',
    ...place,
    assetId: text(taalcut(child.metadata).assetId),
    inPoint: span ? seconds(span.start_time.value, span.start_time.rate) : null,
  };
}

/** One track laid out as OTIO lays it out: children end to end; transitions take no time. */
function trackCuts(track: OtioTrack, canvas: number): CutEntry[] {
  const frame = (at: number) => Math.round(at * canvas);
  const trackId = text(taalcut(track.metadata).trackId) ?? track.name ?? '';
  const out: CutEntry[] = [];
  let at = 0;
  for (const child of track.children) {
    if (child.OTIO_SCHEMA === 'Transition.1') continue;
    const span = child.source_range;
    const start = frame(at);
    at += span ? span.duration.value / span.duration.rate : 0;
    const entry = childEntry(child, track, trackId, { start, frames: frame(at) - start });
    if (entry) out.push(entry);
  }
  return out;
}

export function otioCutList(otio: OtioTimeline): CutList {
  const canvas = otio.global_start_time?.rate ?? 30;
  return otio.tracks.children.flatMap((track) => trackCuts(track, canvas));
}
