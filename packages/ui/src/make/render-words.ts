// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Words for the keys @taalcut/render sends (presets, export stages, QA checks
 * and fixes). The renderer owns them (apps/renderer/src/features/renders/
 * render-messages.ts, explicit ids), so the kit asks the active catalogue for
 * the key first; these English fallbacks are for a catalogue without it
 * (tests, a key newer than the app's words).
 */
import type { I18n, MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import type { ExportPresetId, Platform, QaCheckId, RenderStatus } from '@taalcut/core';
import { PRESET_LABELS } from '../cards/export-labels';

/** The catalogue's words for `key`, or the fallback's. */
export function backendText(i18n: I18n, key: string, fallback: MessageDescriptor): string {
  return key in i18n.messages ? i18n._(key) : i18n._(fallback);
}

const PRESETS: Readonly<Record<ExportPresetId, MessageDescriptor>> = {
  shorts: msg`YouTube Shorts`,
  reels: msg`Instagram Reels`,
  tiktok: msg`TikTok`,
  device: msg`Save to this Mac`,
  deviceHevc: msg`Save to this Mac (smaller file)`,
  landscape: PRESET_LABELS.landscape,
  standard: PRESET_LABELS.standard,
  youtubeAv1: PRESET_LABELS.youtubeAv1,
  deviceAv1: PRESET_LABELS.deviceAv1,
  square: msg({ id: 'render.presets.square', message: 'Square (1:1)' }),
  portrait: msg({ id: 'render.presets.portrait', message: 'Portrait (4:5)' }),
  square2160: msg({ id: 'render.presets.square2160', message: '2160p master (1:1)' }),
  portrait2160: msg({ id: 'render.presets.portrait2160', message: '2160p master (4:5)' }),
  master4k: PRESET_LABELS.master4k,
  landscape4k: PRESET_LABELS.landscape4k,
};

export function presetLabel(i18n: I18n, presetId: ExportPresetId): string {
  return backendText(i18n, `render.presets.${presetId}`, PRESETS[presetId]);
}

const STAGES: Readonly<Record<string, MessageDescriptor>> = {
  preflight: msg`Checking clips`,
  conforming: msg`Preparing clips`,
  composing: msg`Laying out`,
  capturing: msg`Exporting`,
  mixingAudio: msg`Mixing sound`,
  finishing: msg`Finishing`,
  checking: msg`Checking the video`,
  fixing: msg`Fixing`,
  // Phase 3's optional stages (render SPEC P3.11): reframing, a Style's grade, Content Credentials.
  reframing: msg`Framing`,
  grading: msg`Matching colour`,
  signing: msg`Signing`,
};

const STATUSES: Readonly<Record<RenderStatus, MessageDescriptor>> = {
  queued: msg`Waiting to start`,
  rendering: msg`Exporting`,
  checking: msg`Checking the video`,
  fixing: msg`Fixing`,
  ready: msg`Exported`,
  needsAttention: msg`Needs review`,
  failed: msg`Didn’t finish`,
  cancelled: msg`Stopped`,
};

const SOMETHING = msg`Working on it`;

/**
 * What an export is doing: its progress's stage key (`render.stage.capturing`,
 * or the bare stage name) when it has one, else its status in words.
 */
export function renderStageLabel(
  i18n: I18n,
  stage: string | null | undefined,
  status?: RenderStatus,
): string {
  if (stage) {
    const bare = stage.startsWith('render.stage.') ? stage.slice('render.stage.'.length) : stage;
    const key = `render.stage.${bare}`;
    return backendText(i18n, key, STAGES[bare] ?? (status ? STATUSES[status] : SOMETHING));
  }
  return i18n._(status ? STATUSES[status] : SOMETHING);
}

/** Every check render runs (core QA_CHECK_IDS); "A check" is only for an id newer than these words. */
const CHECKS: Readonly<Record<QaCheckId, MessageDescriptor>> = {
  preflightMedia: msg`All clips are here`,
  preflightFonts: msg`Caption fonts are intact`,
  rightsReferenceAudio: msg`Music rights`,
  container: msg`File type`,
  codec: msg`Video and audio format`,
  resolution: msg`Resolution`,
  aspectRatio: msg`Shape (9:16)`,
  frameRate: msg`Frame rate`,
  duration: msg`Length`,
  bitrate: msg`Quality`,
  blackFrames: msg`No unexpected black frames`,
  frozenFrames: msg`No frozen picture`,
  blackBars: msg`No black bars`,
  avSync: msg`Sound in sync`,
  beatSync: msg`Cuts on the beat`,
  loudness: msg`Loudness`,
  silence: msg`Sound is there`,
  captionSafeZone: msg`Captions clear of the app’s buttons`,
  captionOverflow: msg`Captions fit`,
  captionGlyphs: msg`Every caption letter shows`,
  captionReadability: msg`Captions are easy to read`,
  // Phase 3 (render SPEC P3.10): reframing, motion graphics, voice under music, Content Credentials, brand kits.
  subjectInFrame: msg`Faces and people stay in frame`,
  cropJitter: msg`The framing moves smoothly`,
  captionCoversFace: msg`Captions clear of faces`,
  graphicsSafeZone: msg`Graphics clear of the app’s buttons`,
  graphicsOverlap: msg`Graphics don’t cover each other`,
  graphicsReadability: msg`Graphics are easy to read`,
  voiceOverMusic: msg`The voice is clear over the music`,
  contentCredentials: msg`Content Credentials are intact`,
  brandAssets: msg`Logo and watermark are in place`,
  // LRN1-STY.
  stylePacing: msg`Pacing matches the style you asked for`,
  // FRM1-OVL.
  graphicCoversFace: msg`Text and graphics clear of faces`,
  // AGT2-MATCH: the video against its template, slot by slot.
  slotNeeds: msg`Each shot shows what the reel’s moment needs`,
  slotFace: msg`Faces shown or hidden as in the reel`,
  slotFraming: msg`People framed as in the reel`,
  slotMotion: msg`Camera moves as in the reel`,
  slotTiming: msg`Shots last as long as the reel’s`,
  slotGraphics: msg`The reel’s graphics are there, in its place`,
  // EAR1: the render heard.
  soundOnCuts: msg`A sound lands on each cut`,
  soundClean: msg`No clicks or distortion in the sound`,
  soundCritique: msg`The sound mix sounds finished`,
};

const A_CHECK = msg`A check`;
const isCheckId = (id: string): id is QaCheckId => Object.hasOwn(CHECKS, id);
const A_FIX = msg`Fix it`;

/** A QA check's name from its labelKey (`qa.checks.<id>`). */
export function qaCheckLabel(i18n: I18n, labelKey: string): string {
  const id = labelKey.startsWith('qa.checks.') ? labelKey.slice('qa.checks.'.length) : labelKey;
  return backendText(i18n, `qa.checks.${id}`, isCheckId(id) ? CHECKS[id] : A_CHECK);
}

const FIXES: Readonly<Record<string, MessageDescriptor>> = {
  captionClearFace: msg`Move captions off the face`,
  captionStroke: msg`Outline the captions`,
  coveringFont: msg`Use a font with these letters`,
  editCaptionText: msg`Edit the caption`,
  largerCaptions: msg`Make the captions larger`,
  // HFW1: the Editor asks the Designer for the graphic with larger words (render's graphicsReadability).
  largerGraphicWords: msg`Make the graphic’s words larger`,
  lengthen: msg`Make the video longer`,
  lengthenGraphic: msg`Keep the graphic on longer`,
  mediaChanged: msg`Use the clip as it is now`,
  moveCaptions: msg`Move the captions`,
  moveGraphic: msg`Move the graphic`,
  moveText: msg`Move the text`,
  openOnPicture: msg`Start on a picture`,
  raiseDucking: msg`Quieter music under the voice`,
  rebuildCaptions: msg`Rebuild the captions`,
  referenceAudioWarning: msg`Review the music choice`,
  reframeBlurPad: msg`Show the whole shot`,
  reframeCentre: msg`Hold the framing still`,
  relinkMedia: msg`Find the missing clip`,
  replaceBrandAsset: msg`Move or replace the logo`,
  resyncBeats: msg`Put cuts back on the beat`,
  setClipFitCover: msg`Fill the frame`,
  shortenText: msg`Shorten the text`,
  shrinkCaptions: msg`Make the captions smaller`,
  swapFromAlternates: msg`Swap in another take`,
  swapOrTrimDark: msg`Swap or trim the dark part`,
  swapOrTrimStatic: msg`Swap or trim the still part`,
  trimToDuration: msg`Trim to fit`,
  usePlatformSound: msg`Add sound in the app`,
  // LRN1-STY: the Editor re-times the shots toward the style's band.
  matchStylePacing: msg`Match the style’s pacing`,
  // AGT2-MATCH: the AI brings a slot closer to the reel's.
  matchSlotNeeds: msg`Use a shot that shows what the moment needs`,
  matchSlotFace: msg`Show or hide the face as the reel does`,
  matchSlotFraming: msg`Frame the person as the reel does`,
  matchSlotMotion: msg`Use a shot that moves as the reel’s does`,
  matchSlotTiming: msg`Time the shot as the reel does`,
  matchSlotGraphics: msg`Put the reel’s graphic in its place`,
  // EAR1-A2: the Editor places the effects on their cuts again; a click in the mix is found and cut.
  resyncHits: msg`Put the effects back on their cuts`,
  findClick: msg`Find the click`,
};

const A_SOUND_FIX = msg`Improve the sound`;

/**
 * EAR1-A2: a sound critique fix or tip (`audio.critique.*`, audio's CRITIQUE_MESSAGE_KEYS) with its values; numbers
 * in the locale's format. The renderer's catalogue has the words (render-messages-listen.ts).
 */
export function soundFixText(
  i18n: I18n,
  key: string,
  params: Readonly<Record<string, string | number>> = {},
): string {
  if (!(key in i18n.messages)) return i18n._(A_SOUND_FIX);
  const values = Object.fromEntries(
    Object.entries(params).map(([name, value]) => [
      name,
      typeof value === 'number' ? i18n.number(value, { maximumFractionDigits: 2 }) : value,
    ]),
  );
  return i18n._(key, values);
}

/**
 * A QA fix's button words from its labelKey or instructionKey (`qa.fixes.<id>`); a sound critique's key
 * (`audio.critique.*`) reads with the agent fix's `params`.
 */
export function qaFixLabel(
  i18n: I18n,
  labelKey: string,
  params?: Readonly<Record<string, string | number>>,
): string {
  if (labelKey.startsWith('audio.critique.')) return soundFixText(i18n, labelKey, params);
  const id = labelKey.startsWith('qa.fixes.') ? labelKey.slice('qa.fixes.'.length) : labelKey;
  return backendText(i18n, `qa.fixes.${id}`, FIXES[id] ?? A_FIX);
}

const PRESET_IDS: readonly ExportPresetId[] = [
  'shorts',
  'reels',
  'tiktok',
  'device',
  'deviceHevc',
  'landscape',
  'standard',
  'youtubeAv1',
  'deviceAv1',
];

/** True for a string that names an export preset. */
export function isPresetId(value: string): value is ExportPresetId {
  return (PRESET_IDS as readonly string[]).includes(value);
}

/** How each app asks you to label AI content (render's DISCLOSURE_V1, checked on 2026-10-14). */
const DISCLOSURES: Readonly<Record<Platform, { title: MessageDescriptor; steps: MessageDescriptor }>> = {
  shorts: {
    title: msg({ message: 'YouTube Shorts', comment: 'Brand name: keep as written.' }),
    steps: msg`In YouTube Studio, set “Altered or synthetic content” (AI use) to Yes when the video shows a realistic person, place or event that AI made or changed, or AI music is the focus. With Content Credentials on, YouTube may label it automatically, and that label can’t be changed.`,
  },
  reels: {
    title: msg({ message: 'Instagram and Facebook Reels', comment: 'Brand names: keep as written.' }),
    steps: msg`Use “Add AI label” when realistic video or audio was made or changed with AI (an AI voiceover counts). Credentials that say “created with AI” add the label for you.`,
  },
  tiktok: {
    title: msg({ message: 'TikTok', comment: 'Brand name: keep as written.' }),
    steps: msg`Turn on “AI-generated content” under More options for realistic AI images, audio or video. With Content Credentials on, TikTok adds its own label, which can’t be removed.`,
  },
};

/** A platform's AI disclosure reminder: its name or its steps (`render.disclosure.<platform>.title|steps`). */
export function disclosureText(i18n: I18n, platform: Platform, part: 'title' | 'steps'): string {
  return backendText(i18n, `render.disclosure.${platform}.${part}`, DISCLOSURES[platform][part]);
}
