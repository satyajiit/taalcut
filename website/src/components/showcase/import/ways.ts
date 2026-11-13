// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { Cable, Camera, Files, Folder, HardDrive, Images, Smartphone, type LucideIcon } from 'lucide-react';

/**
 * Library › Import in the app's own words (apps/renderer/src/features/library/imports/import-words.ts and
 * import-chooser.tsx, read, never imported; test/unit/showcase-import.test.ts holds them to the app's text): the ways
 * in, their notes and glyphs, the chooser's three groups, which ways each platform offers (WEB3 truth ledger: Files,
 * Folder and Phone over Wi-Fi everywhere, the rest on a Mac), and the stages a clip moves through once it lands.
 */

export type WayId = 'files' | 'folder' | 'phone-wifi' | 'phone-cable' | 'camera' | 'dji' | 'insta360' | 'photos';
export type Platform = 'mac' | 'ubuntu';

export interface Way {
  readonly id: WayId;
  /** METHOD_NAMES */
  readonly name: string;
  /** METHOD_NOTES */
  readonly note: string;
  /** METHOD_ICONS */
  readonly icon: LucideIcon;
  /** Only on a Mac (the ledger: cable, cameras and Apple Photos are never on Ubuntu). */
  readonly macOnly: boolean;
}

export const WAYS: Readonly<Record<WayId, Way>> = {
  files: { id: 'files', name: 'Files', note: 'Choose videos and photos from this computer.', icon: Files, macOnly: false },
  folder: {
    id: 'folder',
    name: 'Folder',
    note: 'Bring in a folder once, or watch it for new footage.',
    icon: Folder,
    macOnly: false,
  },
  'phone-wifi': {
    id: 'phone-wifi',
    name: 'Phone over Wi-Fi',
    note: 'Scan a code, then choose footage on your phone.',
    icon: Smartphone,
    macOnly: false,
  },
  'phone-cable': {
    id: 'phone-cable',
    name: 'Phone on a cable',
    note: 'Connect a phone and choose its originals.',
    icon: Cable,
    macOnly: true,
  },
  camera: {
    id: 'camera',
    name: 'Camera or card',
    note: 'Read footage from a mounted camera, drive or card.',
    icon: Camera,
    macOnly: true,
  },
  dji: {
    id: 'dji',
    name: 'DJI',
    note: 'Pocket and Action originals over USB storage or a card reader.',
    icon: Camera,
    macOnly: true,
  },
  insta360: {
    id: 'insta360',
    name: 'Insta360',
    note: 'Save originals and companions; playable MP4 is ready to edit.',
    icon: HardDrive,
    macOnly: true,
  },
  photos: {
    id: 'photos',
    name: 'Apple Photos',
    note: 'Choose originals from your System Photo Library. Photos edits are not included.',
    icon: Images,
    macOnly: true,
  },
};

/** The chooser's groups, in the app's order (import-chooser.tsx). */
export const GROUPS: readonly { readonly title: string; readonly ways: readonly WayId[] }[] = [
  { title: 'This computer', ways: ['files', 'folder', 'photos'] },
  { title: 'Phones', ways: ['phone-wifi', 'phone-cable'] },
  { title: 'Cameras and cards', ways: ['camera', 'dji', 'insta360'] },
];

/** The groups a platform shows, each with the ways it offers there; a group with none left goes. */
export function groupsOn(platform: Platform): { readonly title: string; readonly ways: readonly WayId[] }[] {
  return GROUPS.map((g) => ({ title: g.title, ways: g.ways.filter((id) => platform === 'mac' || !WAYS[id].macOnly) })).filter(
    (g) => g.ways.length > 0,
  );
}

/** The ways only a Mac has, in the chooser's order. */
export const MAC_ONLY: readonly WayId[] = GROUPS.flatMap((g) => g.ways).filter((id) => WAYS[id].macOnly);

/** "Apple Photos, Phone on a cable, Camera or card, DJI and Insta360". */
export function listWords(ids: readonly WayId[]): string {
  const names = ids.map((id) => WAYS[id].name);
  if (names.length < 2) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** The way a platform falls back to when the chosen one isn't there. */
export function wayOn(platform: Platform, chosen: WayId): WayId {
  return platform === 'ubuntu' && WAYS[chosen].macOnly ? 'phone-wifi' : chosen;
}

/** A clip's stages once it lands, in order (STAGE_NAMES). */
export const STAGES = [
  'Receiving or copying',
  'Checking the copy',
  'Available to edit',
  'Searchable',
  'Fully analysed',
] as const;

/** When a clip reaches each stage, in ms after its phone starts sending it. */
export const STAGE_AT: readonly number[] = [0, 500, 900, 1500, 2400];

/** The stage a clip is at `elapsed` ms after it started (−1: not sent yet). */
export function stageAt(elapsed: number): number {
  if (elapsed < 0) return -1;
  let stage = 0;
  for (const [i, at] of STAGE_AT.entries()) if (elapsed >= at) stage = i;
  return stage;
}

/** What the phone's page says of a clip at a stage (the phone page's state words). */
export function phoneWords(stage: number): string {
  if (stage <= 0) return 'Sending';
  return stage === 1 ? 'Adding to your library' : 'Added';
}

/** One clip sent from the phone: which, when (ms on the run's clock), and which of the phone's two choices sent it. */
export interface Arrival {
  readonly clipId: string;
  readonly sentAt: number;
  readonly from: 'files' | 'photos';
}

/** The run, in ms: the phone asks, Allow at ASK_FOR, the first clips leave in turn, and it rests at RUN_END. */
export const ASK_FOR = 1000;
export const FIRST_SEND = 1300;
export const SEND_EVERY = 600;
export const RUN_END = 4500;

/** The match code both screens show, and the phone's address on the network. */
export const MATCH_CODE = '47';
export const PHONE_ADDRESS = '192.168.1.24';

/** The owner's clips the phone sends first, then those it can still send, in turn (#content/reels ids). */
export const FIRST_CLIPS: readonly string[] = ['repeat-02', 'repeat-13', 'vietnam-05', 'airport-03'];
export const MORE_CLIPS: readonly string[] = [
  'repeat-11',
  'vietnam-12',
  'repeat-07',
  'airport-08',
  'repeat-14',
  'vietnam-03',
  'repeat-01',
  'airport-04',
];

/** The first clips, leaving the phone one after another once the computer allows it. */
export function firstArrivals(at = FIRST_SEND): Arrival[] {
  return FIRST_CLIPS.map((clipId, i) => ({ clipId, sentAt: at + i * SEND_EVERY, from: 'files' as const }));
}

/** The next clips the phone can send (two a choice), none once every one of them has gone. */
export function nextClips(sent: readonly Arrival[], count = 2): string[] {
  const gone = new Set(sent.map((a) => a.clipId));
  return MORE_CLIPS.filter((id) => !gone.has(id)).slice(0, count);
}

/** When every arrival has reached Fully analysed. */
export function settledAt(arrivals: readonly Arrival[]): number {
  return Math.max(0, ...arrivals.map((a) => a.sentAt + (STAGE_AT[STAGE_AT.length - 1] ?? 0)));
}
