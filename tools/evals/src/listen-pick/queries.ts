// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * listen-pick's golden set (EAR1-B2): 60 plain-words requests for a sound effect, each with the family (or the two
 * families) a right answer comes from. Every phrase is written from the bank's own metadata at ff41f07: an entry's
 * `notes` (what it is for), its member name, or upstream's "for" column (docs/SFX.md); no third-party data. A second
 * family is accepted only where the bank itself serves the request from both: shared kit roles (a tap is also
 * `land.light`, like a knock) or a note that names the other (a bubble pop is how a drip is described).
 */
import type { PickFamilyName } from './families';

export interface PickQuery {
  readonly query: string;
  readonly families: readonly PickFamilyName[];
  /** Where the words come from: `notes:<category>`, `member:<id>` or `doc:<family>`. */
  readonly from: string;
}

export const PICK_QUERIES: readonly PickQuery[] = [
  { query: 'a mouse click on a button', families: ['click'], from: 'notes:click' },
  { query: 'a cursor pressing a button', families: ['click'], from: 'notes:click' },
  { query: 'a bright designed UI tick', families: ['click', 'tick'], from: 'notes:pro_click' },
  { query: 'a tiny tick as a list row passes', families: ['tick'], from: 'notes:hover_tick' },
  { query: 'an airy digital tick for a counter', families: ['tick'], from: 'notes:pro_hover_tick' },
  { query: 'a hover tick', families: ['tick', 'click'], from: 'doc:tick' },
  { query: 'a finger tapping a phone screen', families: ['tap'], from: 'notes:tap' },
  { query: 'the soft low thump of a touch', families: ['tap', 'knock'], from: 'notes:pro_tap' },
  { query: 'a light touch on a table', families: ['tap', 'knock'], from: 'notes:tap' },
  { query: 'a settings switch toggling on', families: ['toggle'], from: 'notes:toggle' },
  { query: 'a switch flipping with a latch', families: ['toggle'], from: 'notes:toggle' },
  { query: 'a bubble pop', families: ['pop', 'drip'], from: 'notes:pop' },
  { query: 'a cork popping', families: ['pop'], from: 'notes:pop' },
  { query: 'a soft rounded pop as a badge appears', families: ['pop'], from: 'notes:pro_pop' },
  { query: 'an icon popping in', families: ['pop'], from: 'notes:pro_pop_in' },
  { query: 'a notification ding', families: ['bell'], from: 'notes:pro_notify' },
  { query: 'a struck bell chime for a success message', families: ['bell'], from: 'notes:notify' },
  { query: 'a short clean ding', families: ['bell'], from: 'notes:pro_notify' },
  { query: 'chimes ringing out with sparkle', families: ['shimmer'], from: 'notes:shimmer' },
  { query: 'a granular sparkle', families: ['shimmer'], from: 'notes:pro_shimmer' },
  { query: 'a fast whip pan whoosh', families: ['whoosh'], from: 'notes:whoosh_fast' },
  { query: 'a big whoosh for a scene transition', families: ['whoosh'], from: 'notes:whoosh_big' },
  { query: 'a large object passing by', families: ['whoosh'], from: 'notes:whoosh_big' },
  { query: 'a thin quick swish', families: ['swish'], from: 'notes:swish' },
  { query: 'a paper page turn', families: ['swish'], from: 'notes:swipe' },
  { query: 'a cloth swipe', families: ['swish'], from: 'member:swipe/cloth' },
  { query: 'a riser building tension', families: ['riser'], from: 'member:riser/tension' },
  { query: 'a build into a reveal', families: ['riser'], from: 'notes:riser' },
  { query: 'a short stutter riser into a cut', families: ['riser'], from: 'notes:pro_riser' },
  { query: 'energy falling away after a hit', families: ['downlifter'], from: 'notes:downlifter' },
  { query: 'a falling downlifter as the scene exits', families: ['downlifter'], from: 'notes:downlifter' },
  { query: 'a tonal sweep across a cut', families: ['zip'], from: 'notes:pro_zip' },
  { query: 'a zip sweeping up', families: ['zip'], from: 'member:pro_zip/up' },
  { query: 'a cinematic impact hit', families: ['impact'], from: 'notes:impact' },
  { query: 'a title slam', families: ['impact'], from: 'notes:impact' },
  { query: 'a short punchy hit on a cut', families: ['impact'], from: 'notes:cut_hit' },
  { query: 'a deep sub hit with a kick', families: ['impact', 'drop'], from: 'notes:cut_hit' },
  { query: 'a sub bass drop', families: ['drop'], from: 'notes:sub_drop' },
  { query: 'an 808 drop', families: ['drop'], from: 'member:sub_drop/808' },
  { query: 'a logo reveal sting', families: ['sting'], from: 'notes:logo_sting' },
  { query: 'a launch sting landing on a tone', families: ['sting'], from: 'notes:pro_logo_sting' },
  { query: 'a digital glitch', families: ['glitch'], from: 'doc:glitch' },
  { query: 'a glitch transition for an error', families: ['glitch'], from: 'notes:glitch' },
  { query: 'a data stutter', families: ['glitch'], from: 'member:pro_glitch/data' },
  { query: 'a mechanical keyboard key press', families: ['key'], from: 'notes:typing_key' },
  { query: 'typing on a keyboard', families: ['key'], from: 'notes:pro_typing_run' },
  { query: 'a space bar press', families: ['key'], from: 'member:fit/key.space/thock_space' },
  { query: 'a low thocky key press', families: ['key'], from: 'member:typing_key/thock' },
  { query: 'a kalimba note', families: ['note'], from: 'notes:pluck' },
  { query: 'a short wooden marimba note', families: ['note'], from: 'notes:mallet' },
  { query: 'a glockenspiel note', families: ['note', 'bell'], from: 'notes:mallet' },
  { query: 'a knuckle knocking on a desk', families: ['knock', 'tap'], from: 'notes:knock' },
  { query: 'a knock-knock', families: ['knock'], from: 'notes:knock' },
  { query: 'a wooden block knock', families: ['knock'], from: 'notes:knock' },
  { query: 'a water drop', families: ['drip'], from: 'notes:drip' },
  { query: 'a small high droplet plink', families: ['drip'], from: 'notes:drip' },
  { query: 'a camera shutter', families: ['shutter'], from: 'notes:shutter' },
  { query: 'a snap zoom camera click', families: ['shutter'], from: 'notes:shutter' },
  { query: 'a reverse cymbal', families: ['swell'], from: 'notes:reverse_swell' },
  { query: 'a reverse swell into a cut', families: ['swell'], from: 'doc:swell' },
];
