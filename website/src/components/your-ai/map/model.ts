// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The map of what leaves your computer, as data: for a profile and the Local only switch, which lanes cross the
 * border to the AI you chose, which stay, what each says, and what the cloud side reads. Pure, so
 * test/unit/ai-map.test.ts can hold every state to the app's own list (LOCAL_ONLY, PROFILES in #content/providers).
 */
import { AI_MAP } from '#content/ai-map';
import { LOCAL_ONLY, PROFILES } from '#content/providers';
import type { Fact } from '#content/schema';

export type ProfileName = (typeof PROFILES)[number][0];

/** The profile that runs every job on your computer (On this Computer on Ubuntu). */
export const LOCAL_PROFILE: ProfileName = 'On this Mac';
/** What the server HTML shows: Everyday, Local only off. */
export const DEFAULT_PROFILE: ProfileName = 'Everyday';

export interface MapState {
  readonly profile: ProfileName;
  readonly localOnly: boolean;
}

export const DEFAULT_STATE: MapState = { profile: DEFAULT_PROFILE, localOnly: false };

/** Each lane is one thing that may cross: its drawing is chosen by id. */
export type LaneId = 'cloud' | 'links' | 'speech' | 'reports' | 'updates';

export interface Lane {
  readonly id: LaneId;
  readonly label: string;
  /** The lane's words; null where the cloud side says it instead (On this Mac reads cloudWithLocalProfile there). */
  readonly value: string | null;
  /** Crosses the border to the AI you chose; otherwise it stays on your computer. */
  readonly crosses: boolean;
  /** Leaves only when you turn it on (drawn dashed): crash reports and usage counts. */
  readonly optIn?: boolean;
}

/** The app's list, in its order (privacy-labels.ts): cloud models, reference links, speech, reports and counts. */
const leavesAt = (i: number): Fact => LOCAL_ONLY.leavesWhenOff[i]!;
const [CLOUD, LINKS, SPEECH, REPORTS] = [leavesAt(0), leavesAt(1), leavesAt(2), leavesAt(3)];
/** What stays when Local only is on: your footage, reel links, jobs with no local model. */
const [REEL_LINKS, NO_LOCAL] = [LOCAL_ONLY.staysWhenOn[1]!, LOCAL_ONLY.staysWhenOn[2]!];

/** The app's own "What leaves your computer" list for a profile with Local only off (privacy-labels.ts). */
export function leaves(profile: ProfileName): readonly Fact[] {
  const local = profile === LOCAL_PROFILE;
  return LOCAL_ONLY.leavesWhenOff
    .filter(([label]) => !(local && label === SPEECH[0]))
    .map(([label, value]) => [label, local && label === CLOUD[0] ? LOCAL_ONLY.cloudWithLocalProfile : value] as const);
}

/**
 * The lanes for a state, top to bottom. Local only off: the app's list crosses (the cloud lane stays home under On
 * this Mac, and speech drops). Local only on: everything stops at the border, the cloud and link lanes say what stays
 * instead, and only the update check still crosses.
 */
export function lanes({ profile, localOnly }: MapState): readonly Lane[] {
  const local = profile === LOCAL_PROFILE;
  const out: Lane[] = [];
  if (localOnly) {
    out.push({ id: 'cloud', label: NO_LOCAL[0], value: NO_LOCAL[1], crosses: false });
    out.push({ id: 'links', label: REEL_LINKS[0], value: REEL_LINKS[1], crosses: false });
  } else {
    out.push({ id: 'cloud', label: CLOUD[0], value: local ? null : CLOUD[1], crosses: !local });
    out.push({ id: 'links', label: LINKS[0], value: LINKS[1], crosses: true });
  }
  if (!local) out.push({ id: 'speech', label: SPEECH[0], value: SPEECH[1], crosses: !localOnly });
  out.push({ id: 'reports', label: REPORTS[0], value: REPORTS[1], crosses: !localOnly, optIn: true });
  out.push({ id: 'updates', label: AI_MAP.updates, value: LOCAL_ONLY.stillRuns, crosses: true });
  return out;
}

/**
 * Where a lane's card rests: with the AI you chose (the cloud lane, crossing), outside your computer (the others,
 * crossing), with the AI on your computer (the cloud lane under On this Mac), or held at the wall (Local only).
 */
export type Place = 'ai' | 'outside' | 'local' | 'held';

export function placeOf(lane: Lane, { profile }: MapState): Place {
  if (lane.id === 'cloud') return lane.crosses ? 'ai' : profile === LOCAL_PROFILE ? 'local' : 'held';
  return lane.crosses ? 'outside' : 'held';
}

/** What the AI you chose reads: the model the profile picks, none (On this Mac), or closed (Local only). */
export type CloudSide =
  | { readonly kind: 'model'; readonly name: ProfileName }
  | { readonly kind: 'none'; readonly words: string }
  | { readonly kind: 'closed'; readonly words: string };

export function cloudSide({ profile, localOnly }: MapState): CloudSide {
  if (localOnly) return { kind: 'closed', words: LOCAL_ONLY.whenOn };
  if (profile === LOCAL_PROFILE) return { kind: 'none', words: LOCAL_ONLY.cloudWithLocalProfile };
  return { kind: 'model', name: profile };
}

/** Where the AI's mark sits: with the cloud model, or on your computer under On this Mac. */
export function aiHome({ profile }: MapState): 'cloud' | 'computer' {
  return profile === LOCAL_PROFILE ? 'computer' : 'cloud';
}

/** A profile's line in the app's words. */
export function profileLine(profile: ProfileName): string {
  return PROFILES.find(([name]) => name === profile)?.[1] ?? '';
}

/** The local profile's limit: its line's second sentence ("Lower quality, and no AI voice or images."). */
export function profileLimit(): string {
  return profileLine(LOCAL_PROFILE).split('. ').slice(1).join('. ');
}

/**
 * The cloud lane's words in two parts, so the rule (Taalcut asks before it first sends your files to a cloud model)
 * stands on its own line: everything up to the last sentence, and the last sentence. Joined with a space they are the
 * fact again, word for word.
 */
export function splitRule(value: string): readonly [string, string] {
  const at = value.lastIndexOf('. ', value.length - 2);
  if (at < 0) return [value, ''];
  return [value.slice(0, at + 1), value.slice(at + 2)];
}

/** Which profile an arrow key moves to from `index`, wrapping round. */
export function stepProfile(index: number, key: string): number | null {
  const step = key === 'ArrowRight' || key === 'ArrowDown' ? 1 : key === 'ArrowLeft' || key === 'ArrowUp' ? -1 : 0;
  if (key === 'Home') return 0;
  if (key === 'End') return PROFILES.length - 1;
  if (!step) return null;
  return (index + step + PROFILES.length) % PROFILES.length;
}
