// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { I18n, MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import type { JobState, PlanStepStatus } from '@taalcut/core';
import { EXTRA_TOOL_LABELS } from './tool-labels-extra';

/**
 * Plain names for the agent's tools, in the words of PRD 9.4 ("clip", not
 * "asset"). A tool without a name here shows as "A step"; developer mode adds
 * the tool's id.
 */
export const TOOL_LABELS: Readonly<Record<string, MessageDescriptor>> = {
  // Library & clip search
  'library.addSource': msg`Add a folder`,
  'library.removeSource': msg`Remove a folder`,
  'library.recheckSource': msg`Check a folder`,
  'library.listSources': msg`List your folders`,
  'library.listAssets': msg`List your clips`,
  'library.getAsset': msg`Inspect a clip`,
  'library.search': msg`Search your clips`,
  'library.searchShots': msg`Search shots`,
  'library.getShotCard': msg`Read shot details`,
  'library.findSimilarShots': msg`Find similar shots`,
  'library.searchStock': msg`Search stock video`,
  'library.importStock': msg`Download stock video`,
  // AGT2: the AI's eyes.
  'library.frameAt': msg`Look at a clip`,
  'library.subjects': msg`Find the people in a clip`,
  'video.compare': msg`Compare the video with the reel`,
  // Media & vision
  'media.probe': msg`Check the video`,
  'vision.describeFrame': msg`Look at a frame`,
  'vision.detectShots': msg`Find the shots`,
  'vision.indexAsset': msg`Index a clip`,
  // Audio, music, voice & sound effects
  'audio.detectBeats': msg`Find the music beats`,
  'audio.transcribe': msg`Transcribe speech`,
  'audio.analyseLoudness': msg`Check audio loudness`,
  'music.pickForTimeline': msg`Pick music for the video`,
  'music.searchLibrary': msg`Search music tracks`,
  'music.generate': msg`Make background music`,
  'music.useReferenceAudio': msg`Use the reference audio`,
  'music.keepOriginalAudio': msg`Keep the original audio`,
  'voice.listVoices': msg`List voices`,
  'voice.generateScript': msg`Write a voice-over script`,
  'voice.synthesise': msg`Create voice-over`,
  'voice.placeOnTimeline': msg`Place voice-over on the video`,
  'sfx.placeForTimeline': msg`Add sound effects`,
  // Captions
  'captions.generate': msg`Create captions`,
  'captions.applyStyle': msg`Style the captions`,
  'captions.editSegment': msg`Edit a caption`,
  // Templates & reference reels
  'templates.breakdown': msg`Break down the reference video`,
  'templates.get': msg`Read the template`,
  'templates.list': msg`List templates`,
  'templates.fromTimeline': msg`Save as a template`,
  'templates.exportFile': msg`Export the template`,
  'templates.importFile': msg`Import a template`,
  'templates.importSavedReel': msg`Import a Saved reel`,
  'templates.listSavedCollections': msg`List Saved collections`,
  'templates.listSavedReels': msg`List Saved reels`,
  'templates.syncSaved': msg`Sync Saved reels`,
  // Reading a reel, step by step (REF1 gate finding 1: these showed as "A step").
  'templates.fetchReference': msg`Get the reel`,
  'templates.referenceStatus': msg`Check where the reel is`,
  'templates.judgeCut': msg`Check a cut`,
  'templates.resolveCuts': msg`Settle the cuts`,
  'templates.setIntents': msg`Describe the slots`,
  'templates.finalise': msg`Save the template`,
  'templates.fetchMedia': msg`Get the reel’s video and music`,
  'hub.search': msg`Search community templates`,
  'hub.install': msg`Add template from the hub`,
  // Timeline & casting
  'timeline.build': msg`Cut the video`,
  'timeline.cast': msg`Match your clips to the template`,
  'timeline.fillGap': msg`Fill a missing shot`,
  'timeline.swapClip': msg`Swap a clip`,
  'timeline.trimClip': msg`Trim a clip`,
  'timeline.splitClip': msg`Split a clip`,
  'timeline.moveClip': msg`Move a clip`,
  'timeline.deleteClip': msg`Remove a clip`,
  'timeline.setSpeed': msg`Change clip speed`,
  'timeline.setTransition': msg`Set a transition`,
  'timeline.setTextOverlay': msg`Set text on the video`,
  'timeline.setCrop': msg`Reframe the video`,
  'timeline.setAudioMix': msg`Mix the audio`,
  'timeline.applyColourLook': msg`Apply a colour look`,
  'timeline.matchShot': msg`Match shot colour`,
  'timeline.undo': msg`Undo the last edit`,
  'timeline.redo': msg`Redo the edit`,
  'timeline.exportOtio': msg`Export timeline file`,
  // Images, motion design & export
  'images.generateForSlot': msg`Generate images for a slot`,
  'sandbox.generateMotionClip': msg`Create motion graphics`,
  'render.start': msg`Export the video`,
  'render.cancel': msg`Stop the export`,
  'render.VerifyCut': msg`Check the finished cut`,
  // Style & preferences
  'soul.read': msg`Read your editing style`,
  'soul.proposeRule': msg`Suggest a style preference`,
  'memory.remember': msg`Remember something for later`,
  'memory.recall': msg`Look up what Taalcut remembers`,
  'templates.styleProfile': msg`Read what your references have in common`,
  'templates.useStyleProfile': msg`Make it in that style`,
  // EDT1-CMT: the comments you send from the editor.
  'comments.list': msg`Read your comments`,
  'comments.reply': msg`Answer a comment`,
  ...EXTRA_TOOL_LABELS,
};

const UNKNOWN_TOOL = msg`A step`;

export function toolLabel(i18n: I18n, tool: string): string {
  return i18n._(TOOL_LABELS[tool] ?? UNKNOWN_TOOL);
}

/**
 * Names for the providers a consent card or smart card references. Company and
 * product names, kept as written, but through the catalogue like every string.
 * An id without a name here is shown as written.
 */
export const PROVIDER_LABELS: Readonly<Record<string, MessageDescriptor>> = {
  google: msg({ message: 'Google', comment: 'Brand name: keep as written.' }),
  // The plans people sign in with (CHATGPT_PROVIDER and the warned logins): named as the person knows them.
  'openai-codex': msg({ message: 'ChatGPT', comment: 'Brand name: keep as written.' }),
  'github-copilot': msg({ message: 'GitHub Copilot', comment: 'Brand name: keep as written.' }),
  openai: msg({ message: 'OpenAI', comment: 'Brand name: keep as written.' }),
  anthropic: msg({ message: 'Anthropic', comment: 'Brand name: keep as written.' }),
  openrouter: msg({ message: 'OpenRouter', comment: 'Brand name: keep as written.' }),
  xai: msg({ message: 'xAI', comment: 'Brand name: keep as written.' }),
  'x-ai': msg({ message: 'xAI', comment: 'Brand name: keep as written.' }),
  elevenlabs: msg({ message: 'ElevenLabs', comment: 'Brand name: keep as written.' }),
  'cloudflare-workers-ai': msg({ message: 'Cloudflare Workers AI', comment: 'Brand name: keep as written.' }),
  cloudflare: msg({ message: 'Cloudflare', comment: 'Brand name: keep as written.' }),
  'black-forest-labs': msg({ message: 'Black Forest Labs', comment: 'Brand name: keep as written.' }),
  flux: msg({ message: 'Flux', comment: 'Brand name: keep as written.' }),
  deepseek: msg({ message: 'DeepSeek', comment: 'Brand name: keep as written.' }),
  mistral: msg({ message: 'Mistral', comment: 'Brand name: keep as written.' }),
  mistralai: msg({ message: 'Mistral', comment: 'Brand name: keep as written.' }),
  meta: msg({ message: 'Meta', comment: 'Brand name: keep as written.' }),
  'meta-llama': msg({ message: 'Meta', comment: 'Brand name: keep as written.' }),
  pexels: msg({ message: 'Pexels', comment: 'Brand name: keep as written.' }),
  pixabay: msg({ message: 'Pixabay', comment: 'Brand name: keep as written.' }),
  freesound: msg({ message: 'Freesound', comment: 'Brand name: keep as written.' }),
  instagram: msg({ message: 'Instagram', comment: 'Brand name: keep as written.' }),
  cursor: msg({ message: 'Cursor', comment: 'Brand name: keep as written.' }),
  'claude-code': msg({ message: 'Claude Code', comment: 'Brand name: keep as written.' }),
  codex: msg({ message: 'Codex', comment: 'Brand name: keep as written.' }),
};

export function providerLabel(i18n: I18n, provider: string): string {
  const key = provider.trim().toLowerCase();
  const prefix = key.includes('/') ? (key.split('/')[0] ?? key) : key;
  const known = PROVIDER_LABELS[key] ?? PROVIDER_LABELS[prefix];
  return known ? i18n._(known) : provider;
}

/** Labels for progress cards (`labelKey`). Unknown keys read "Working". */
export const PROGRESS_LABELS: Readonly<Record<string, MessageDescriptor>> = {
  'cards.progress.indexingLibrary': msg({
    id: 'cards.progress.indexingLibrary',
    message: 'Indexing your clips',
  }),
  'cards.progress.importing': msg({ id: 'cards.progress.importing', message: 'Importing' }),
  'cards.progress.rendering': msg({ id: 'cards.progress.rendering', message: 'Exporting the video' }),
  'cards.progress.downloadingModels': msg({
    id: 'cards.progress.downloadingModels',
    message: 'Downloading models',
  }),
};

/** Stage names inside a progress card (`progress.stageKey`). */
export const STAGE_LABELS: Readonly<Record<string, MessageDescriptor>> = {
  'jobs.stage.extractingFrames': msg({
    id: 'jobs.stage.extractingFrames',
    message: 'Taking frames from the clips',
  }),
  'jobs.stage.detectingShots': msg({ id: 'jobs.stage.detectingShots', message: 'Finding the shots' }),
  'jobs.stage.encoding': msg({ id: 'jobs.stage.encoding', message: 'Encoding' }),
};

const WORKING = msg`Working`;

export function progressLabel(i18n: I18n, key: string): string {
  if (PROGRESS_LABELS[key]) return i18n._(PROGRESS_LABELS[key]);
  return key in i18n.messages ? i18n._(key) : i18n._(WORKING);
}

export function stageLabel(i18n: I18n, key: string): string | undefined {
  if (STAGE_LABELS[key]) return i18n._(STAGE_LABELS[key]);
  return key in i18n.messages ? i18n._(key) : undefined;
}

export const JOB_STATE_LABELS: Readonly<Record<JobState, MessageDescriptor>> = {
  queued: msg`Waiting`,
  running: msg`Working`,
  paused: msg`Paused`,
  succeeded: msg`Done`,
  failed: msg`Failed`,
  cancelled: msg`Stopped`,
};

export const STEP_STATUS_LABELS: Readonly<Record<PlanStepStatus, MessageDescriptor>> = {
  pending: msg`Not started`,
  running: msg`In progress`,
  done: msg`Done`,
  failed: msg`Failed`,
  skipped: msg`Skipped`,
};

export const TOOL_STATUS_LABELS: Readonly<
  Record<'running' | 'succeeded' | 'failed' | 'cancelled', MessageDescriptor>
> = {
  running: msg`Running`,
  succeeded: msg`Done`,
  failed: msg`Failed`,
  cancelled: msg`Stopped`,
};
