// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { AGENT_ERROR_WORDS } from './error-words-agent';
import { CREATION_ERROR_WORDS } from './error-words-creation';
import { LIBRARY_ERROR_WORDS } from './error-words-library';
import { MEDIA_ERROR_WORDS } from './error-words-media';
import { PRODUCT_ERROR_WORDS } from './error-words-products';

/**
 * Plain-English causes and next steps (PRD 9.4) for domain error codes that
 * surface in chat smart cards (`ErrorCard`, `ErrorLine`, `GapFixCard`,
 * `ToolRunRow`). Feature-specific errors that already live in the renderer's
 * feature catalogues (`indexing-messages.ts`, `render-messages.ts`,
 * `download-messages.ts`, `hub-messages.ts`, `make-messages*.ts`,
 * `settings-errors.ts`) are resolved via `i18n.messages` in `errorMessage()`. The rest of each package's codes are in
 * `error-words-agent.ts`, `error-words-media.ts` and `error-words-library.ts` (FIX-ERRWORDS).
 */
export const DOMAIN_ERROR_MESSAGES: Readonly<Record<string, MessageDescriptor>> = {
  // @taalcut/models (chat-facing image, rate-limit, budget & local runtime errors)
  'errors.models.rate_limited': msg({
    id: 'errors.models.rate_limited',
    message: 'The model provider asked Taalcut to wait. Try again in a moment, or switch models.',
  }),
  'errors.models.privacy_blocked': msg({
    id: 'errors.models.privacy_blocked',
    message: 'Local-only mode is on, so Taalcut kept this on your Mac instead of sending it to the cloud.',
  }),
  'errors.models.budget_cap_exceeded': msg({
    id: 'errors.models.budget_cap_exceeded',
    message: 'This project reached its spending cap. Raise the cap or use a model on this Mac.',
  }),
  'errors.models.local_runtime_missing': msg({
    id: 'errors.models.local_runtime_missing',
    message: 'The on-device model isn’t downloaded yet. Download it in Settings › On this Mac.',
  }),
  'errors.models.local_runtime_failed': msg({
    id: 'errors.models.local_runtime_failed',
    message: 'The model on this Mac stopped unexpectedly. Try again.',
  }),
  'errors.models.local_out_of_memory': msg({
    id: 'errors.models.local_out_of_memory',
    message: 'This Mac ran out of memory for that model. Close other apps or switch to a smaller model.',
  }),
  'errors.models.image_no_provider': msg({
    id: 'errors.models.image_no_provider',
    message:
      'No connected image provider is available. Connect ChatGPT images or Grok, or add an image-provider API key in Settings › Accounts.',
  }),
  'errors.models.image_access_denied': msg({
    id: 'errors.models.image_access_denied',
    message:
      '{provider} denied image access for this account. Check the plan and image access in Settings › Accounts.',
  }),
  'errors.models.image_content_policy': msg({
    id: 'errors.models.image_content_policy',
    message: 'The image provider turned down that description. Try wording it differently.',
  }),
  'errors.models.image_failed': msg({
    id: 'errors.models.image_failed',
    message: 'Couldn’t make the image. Try again or pick another image model.',
  }),
  // UX3-AGT: `via: 'chatgpt'` when the ChatGPT plan's sign-in turned the model down (it runs only its own).
  'errors.models.unknown_model': msg({
    id: 'errors.models.unknown_model',
    message:
      '{via, select, chatgpt {ChatGPT didn’t accept the model {model}. Pick another in Settings › Models.} other {The model {model} isn’t available. Pick another in Settings › Models.}}',
  }),
  // FIX-ERRWORDS: a model's answer that ended badly. `{provider}` reads as people know it (errorValues: OpenAI).
  'errors.models.provider_error': msg({
    id: 'errors.models.provider_error',
    message:
      '{provider} ran into a problem, so the answer stopped. Try again, or pick another model in Settings › Models.',
  }),
  'errors.models.context_too_long': msg({
    id: 'errors.models.context_too_long',
    message:
      'This is more than the model can read at once. Start a new chat, or pick another model in Settings › Models.',
  }),
  'errors.models.content_filtered': msg({
    id: 'errors.models.content_filtered',
    message: '{provider}’s safety filter stopped the answer. Try asking in a different way.',
  }),
  'errors.models.bad_request': msg({
    id: 'errors.models.bad_request',
    message: '{provider} turned down the request. Try again, or pick another model in Settings › Models.',
  }),
  'errors.models.quota_exceeded': msg({
    id: 'errors.models.quota_exceeded',
    message: 'Your {provider} plan or credit is used up. Top it up, or use another model until it resets.',
  }),
  'errors.models.auth_expired': msg({
    id: 'errors.models.auth_expired',
    message: 'Your {provider} sign-in ran out while Taalcut was working. Try again, and Taalcut renews it.',
  }),
  'errors.models.model_unsuitable': msg({
    id: 'errors.models.model_unsuitable',
    message: 'That model can’t do this job. Pick another one in Settings › Models.',
  }),
  'errors.models.plan_required': msg({
    id: 'errors.models.plan_required',
    message:
      'Your {provider} plan doesn’t include {feature, select, music {music} voice {voices} other {this}}. Upgrade the plan, or add another service in Settings › Accounts.',
  }),
  'errors.models.music_plan_invalid': msg({
    id: 'errors.models.music_plan_invalid',
    message:
      'That music asks for more than the music service allows, so nothing was sent. Try a shorter or simpler track.',
  }),
  'errors.models.image_output_invalid': msg({
    id: 'errors.models.image_output_invalid',
    message: '{provider} sent back an image Taalcut couldn’t use. Try again.',
  }),
  'errors.models.translation_invalid': msg({
    id: 'errors.models.translation_invalid',
    message:
      'The model’s translation didn’t keep to the original, so it wasn’t used. Try again, or pick another model.',
  }),
  'errors.models.local_runtime_unavailable': msg({
    id: 'errors.models.local_runtime_unavailable',
    message:
      '{state, select, paused {On-device models pause while a video exports. Try again when the export is done.} not_installed {The on-device model isn’t downloaded yet. Try again once it is.} model_not_installed {The on-device model isn’t downloaded yet. Try again once it is.} insufficient_memory {There isn’t enough free memory for an on-device model. Quit other apps, or pick a cloud model.} other {On-device models aren’t ready yet. Try again in a moment.}}',
  }),

  // @taalcut/agent, @taalcut/tools & @taalcut/sandbox
  'errors.agent.run_already_active': msg({
    id: 'errors.agent.run_already_active',
    message: 'Taalcut is already working on a step in this chat. Wait for it to finish or stop it first.',
  }),
  'errors.agent.approval_expired': msg({
    id: 'errors.agent.approval_expired',
    message: 'That question timed out before it was answered. Ask Taalcut to try again.',
  }),
  'errors.agent.cost_denied': msg({
    id: 'errors.agent.cost_denied',
    message: 'Stopped before spending money on that step.',
  }),
  'errors.agent.consent_denied': msg({
    id: 'errors.agent.consent_denied',
    message: 'Stopped so those clips stayed on this Mac.',
  }),
  'errors.agent.soul_full': msg({
    id: 'errors.agent.soul_full',
    message: 'Your style preferences list is full. Remove an older rule before adding a new one.',
  }),
  'errors.tools.unknown_tool': msg({
    id: 'errors.tools.unknown_tool',
    message: 'The model asked for a tool Taalcut doesn’t have.',
  }),
  'errors.tools.invalid_input': msg({
    id: 'errors.tools.invalid_input',
    message: 'The model sent incomplete instructions for that step. Try again.',
  }),
  'errors.sandbox.motion_disabled': msg({
    id: 'errors.sandbox.motion_disabled',
    message: 'Motion design is off. Turn it on in Settings to create animated graphics.',
  }),
  'errors.sandbox.compile_failed': msg({
    id: 'errors.sandbox.compile_failed',
    message: 'Couldn’t build that animated graphic. Ask Taalcut to try a simpler design.',
  }),
  'errors.sandbox.render_failed': msg({
    id: 'errors.sandbox.render_failed',
    message: 'Couldn’t render that animated graphic. Try again.',
  }),
  // UX3-MAC: the sandbox is macOS's (sandbox-exec); off a Mac every run is this (KIT_PLATFORM_WORDS has its words).
  'errors.sandbox.unavailable': msg({
    id: 'errors.sandbox.unavailable',
    message:
      'macOS’s sandbox for this step didn’t start, so Taalcut didn’t run it. Restart this Mac, then try again.',
  }),

  // @taalcut/audio, @taalcut/templates, @taalcut/transfer & @taalcut/desktop
  'errors.audio.no_speech': msg({
    id: 'errors.audio.no_speech',
    message: 'Couldn’t hear any speech in this video to turn into captions.',
  }),
  'errors.audio.voice_not_configured': msg({
    id: 'errors.audio.voice_not_configured',
    message: 'Add an ElevenLabs or OpenAI key in Settings › Accounts to make a voice-over.',
  }),
  'errors.audio.voice_failed': msg({
    id: 'errors.audio.voice_failed',
    message: 'Couldn’t create the voice-over. Try again or pick another voice.',
  }),
  'errors.audio.music_failed': msg({
    id: 'errors.audio.music_failed',
    message: 'Couldn’t prepare the music track. Try again or pick another track.',
  }),
  'errors.templates.invalid_url': msg({
    id: 'errors.templates.invalid_url',
    message: 'That link doesn’t look like a supported Reel or video address.',
  }),
  'errors.templates.fetch_failed': msg({
    id: 'errors.templates.fetch_failed',
    message: 'Couldn’t download that reference video. Check the link or choose a video file on your Mac.',
  }),
  'errors.templates.too_long': msg({
    id: 'errors.templates.too_long',
    message: 'That reference video is too long. Pick a short reel under three minutes.',
  }),
  'errors.templates.breakdown_failed': msg({
    id: 'errors.templates.breakdown_failed',
    message: 'Couldn’t break down that reference video into shots. Try another video.',
  }),
  // LRN1-STY: a style profile's summary.
  'errors.templates.style_summary_empty': msg({
    id: 'errors.templates.style_summary_empty',
    message: '{model} looked at the videos but wrote nothing Taalcut could keep. Try again.',
  }),
  'errors.transfer.pairing_expired': msg({
    id: 'errors.transfer.pairing_expired',
    message: 'The QR code expired. Show a new code and scan it again.',
  }),
  'errors.transfer.upload_failed': msg({
    id: 'errors.transfer.upload_failed',
    message:
      'The clip transfer from your phone was interrupted. Keep both devices on the same Wi-Fi and try again.',
  }),
  'errors.desktop.keychain_unavailable': msg({
    id: 'errors.desktop.keychain_unavailable',
    message: 'macOS Keychain is locked or unavailable. Unlock your Keychain, then try again.',
  }),
  // LNX1-SHL: Linux without GNOME Keyring or KWallet; safeStorage would keep the key in the clear, so nothing is saved.
  'errors.desktop.keyring_unavailable': msg({
    id: 'errors.desktop.keyring_unavailable',
    message:
      'Taalcut keeps sign-ins and keys in your system keyring, and this session has none. Install or unlock GNOME Keyring or KWallet, then restart Taalcut.',
  }),
  // UX3-MAC: the lan process off a Mac builds no cable bridge; only Linux and Windows ever show it.
  'errors.desktop.cable_unsupported': msg({
    id: 'errors.desktop.cable_unsupported',
    message: 'Bringing clips in over a cable isn’t on this computer yet. Send them over Wi-Fi instead.',
  }),
  ...AGENT_ERROR_WORDS,
  ...CREATION_ERROR_WORDS,
  ...PRODUCT_ERROR_WORDS,
  ...MEDIA_ERROR_WORDS,
  ...LIBRARY_ERROR_WORDS,
};
