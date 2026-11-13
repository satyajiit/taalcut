// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The English for the i18n keys @taalcut/models sends (profiles, modules,
 * tiers, hardware notes) and the models package's error keys (the UI kit
 * owns errors.core.*). Profiles and
 * modules carry keys, never English (models SPEC), so the renderer owns the
 * words. Explicit ids: the backend names them.
 */
import type { I18n, MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import type { TaalcutError } from '@taalcut/core';
import {
  ERROR_MESSAGES,
  errorValues,
  HOST_PLATFORMS,
  platformWordsById,
  type HostPlatform,
} from '@taalcut/ui';
import { PLATFORM_WORDS } from '../../i18n/platform-words';
import { IMPORT_ERROR_MESSAGES } from '../library/imports/import-errors';
import { SETTINGS_ERROR_MESSAGES } from './settings-errors';

export const KEYED_MESSAGES: readonly MessageDescriptor[] = [
  msg({ id: 'models.profile.fast-cheap.label', message: 'Fast and cheap' }),
  msg({
    id: 'models.profile.fast-cheap.description',
    message: 'Quick, low-cost models. Good for drafts and simple edits.',
  }),
  // "Balanced" is a thinking level in the composer now (Quick, Balanced, Deep, Max): the profile is "Everyday".
  msg({ id: 'models.profile.balanced.label', message: 'Everyday' }),
  msg({
    id: 'models.profile.balanced.description',
    message: 'Good results at a fair price. Right for most videos.',
  }),
  msg({ id: 'models.profile.best-quality.label', message: 'Best quality' }),
  msg({
    id: 'models.profile.best-quality.description',
    message: 'The strongest models. Slower, and each video costs more.',
  }),
  // "Local only" is Privacy's switch (UX1, M9): the profile that picks this Mac's models is named for where they run.
  msg({ id: 'models.profile.local-only.label', message: 'On this Mac' }),
  msg({
    id: 'models.profile.local-only.description',
    message: 'Every job uses the models on this Mac. Lower quality, and no AI voice or images.',
  }),

  msg({ id: 'models.module.agent.label', message: 'Agent' }),
  msg({
    id: 'models.module.agent.description',
    message: 'Plans your video, makes the edits and talks with you.',
  }),
  msg({ id: 'models.module.router.label', message: 'Quick decisions' }),
  msg({ id: 'models.module.router.description', message: 'Decides which tool to use next. Small and fast.' }),
  msg({ id: 'models.module.vision.label', message: 'Seeing your clips' }),
  // EAR1-I5: sound sent through vision has a standing consent of its own (agent consentKey), named in Privacy.
  msg({ id: 'models.module.vision.audio.label', message: 'Hearing your sound' }),
  msg({
    id: 'models.module.vision.description',
    message: 'Describes what is in each shot, so the right clip lands in the right place.',
  }),
  msg({ id: 'models.module.embeddings.label', message: 'Clip search' }),
  msg({
    id: 'models.module.embeddings.description',
    message: 'Finds clips that match what a moment needs. Always runs on this Mac.',
  }),
  msg({ id: 'models.module.speech.label', message: 'Captions from speech' }),
  msg({ id: 'models.module.speech.description', message: 'Turns what people say into captions.' }),
  msg({ id: 'models.module.voice.label', message: 'Voice-over' }),
  msg({ id: 'models.module.voice.description', message: 'Reads your script out loud.' }),
  msg({ id: 'models.module.music.label', message: 'Music and sound' }),
  msg({ id: 'models.module.music.description', message: 'Finds or makes music and sound effects.' }),
  msg({ id: 'models.module.images.label', message: 'Image making' }),
  msg({ id: 'models.module.images.description', message: 'Makes images for titles, covers and gaps.' }),

  msg({ id: 'models.tier.minimum.label', message: 'Minimum' }),
  msg({ id: 'models.tier.recommended.label', message: 'Recommended' }),
  msg({ id: 'models.tier.high.label', message: 'High' }),
  // Raised on an Intel Mac only (models' assessHardware); off a Mac it never fires.
  msg({
    id: 'models.hardware.not_apple_silicon',
    message:
      'This Mac has an Intel chip, so the models that need Apple silicon are off. Cloud models still work.',
  }),
  msg({ id: 'models.hardware.macos_too_old', message: 'Taalcut needs macOS 14 or later for some features.' }),
  // Linux and Windows (LNX1): the counterpart of macos_too_old.
  msg({ id: 'models.hardware.os_too_old', message: 'Taalcut needs Ubuntu 22.04 or later.' }),
  // Any OS: words that hold for a Mac and a PC alike.
  msg({
    id: 'models.hardware.memory_low',
    message: 'There’s less than 8 GB of memory, so more work goes to cloud models.',
  }),
  msg({
    id: 'models.hardware.disk_low',
    message: 'Less than 20 GB is free. Free up space so models can download.',
  }),
  msg({
    id: 'models.hardware.no_gpu_for_local_models',
    message:
      'Taalcut found no graphics chip it can run models on, so local models run on the processor and more work goes to cloud models.',
  }),
  // LNX1: NVIDIA below 580, which CUDA 13 needs; the models run on the CPU meanwhile, with the reason.
  msg({
    id: 'models.hardware.gpu_driver_old',
    message:
      'The NVIDIA driver is older than version 580, so local models can’t use CUDA. Update the driver to run them on the GPU.',
  }),
  // models' CPU reason, shown in its own words when a backend sends the key (the Mac's; settings-platform-words.ts
  // has this computer's).
  msg({
    id: 'models.compute.cpuReason.hardware_lacks_backend',
    message: 'This Mac has no GPU this model can use.',
  }),
  msg({ id: 'models.note.local_lower_quality', message: 'Lower quality' }),

  // The warning cards for subscription sign-ins (models' messages-en.ts, P1-F6).
  msg({ id: 'models.warning.claude.title', message: 'Using your Claude plan in Taalcut' }),
  msg({
    id: 'models.warning.claude.body',
    message:
      'Anthropic sells Claude Pro and Max for its own apps. To use your plan here, Taalcut signs in the way Claude Code does, and every request tells Anthropic it comes from Claude Code.',
  }),
  msg({
    id: 'models.warning.claude.risk',
    message:
      'Anthropic’s terms may not allow this. Anthropic could block these requests or limit your account. An Anthropic API key, a ChatGPT plan or a local model avoids this.',
  }),
  msg({ id: 'models.warning.copilot.title', message: 'Using your GitHub Copilot plan in Taalcut' }),
  msg({
    id: 'models.warning.copilot.body',
    message:
      'GitHub built this sign-in for Copilot Chat in VS Code. To use your plan here, Taalcut signs in the same way, and every request tells GitHub it comes from Copilot Chat in VS Code.',
  }),
  msg({
    id: 'models.warning.copilot.risk',
    message:
      'GitHub’s terms may not allow this. GitHub could block these requests or limit your Copilot access. A GitHub Models or OpenAI API key avoids this.',
  }),
  msg({ id: 'models.warning.grok.title', message: 'Using SuperGrok or X Premium in Taalcut' }),
  msg({
    id: 'models.warning.grok.body',
    message:
      'This sign-in uses xAI’s device sign-in as another app registered it, not one made for Taalcut. xAI hasn’t said whether other apps may use SuperGrok or X Premium this way.',
  }),
  msg({
    id: 'models.warning.grok.risk',
    message: 'xAI could block these requests or limit your account. An xAI API key avoids this.',
  }),

  // errors.core.* are the UI kit's (ERROR_MESSAGES); these are the models package's.
  msg({ id: 'errors.models.hardware_probe_failed', message: 'Couldn’t read this Mac’s hardware.' }),
  // UX3-AGT: not "add a key": a ChatGPT or Gemini plan is a sign-in, and this also means a model nobody set up.
  msg({
    id: 'errors.models.not_configured',
    message: 'This model isn’t set up. Sign in or add a key for it in Accounts, then try again.',
  }),
  msg({
    id: 'errors.models.secret_store_failed',
    message: 'Couldn’t reach your Mac’s keychain, where Taalcut keeps your keys and sign-ins. Try again.',
  }),
  msg({ id: 'errors.models.auth_invalid', message: 'The key didn’t work. Check it, then add it again.' }),
  // FIX-ERRWORDS: no "it" to refer to in a chat, where a dropped stream ends with this; a local server's check
  // (describeErrorCode) has no parameters, so neither has this.
  msg({
    id: 'errors.models.provider_unavailable',
    message: 'The model didn’t answer, or the connection dropped. Try again in a moment.',
  }),
  msg({ id: 'errors.models.model_retired', message: 'That model has been retired. Pick another one.' }),
  msg({ id: 'errors.models.no_model_for_module', message: 'No model is set for this job.' }),
  msg({
    id: 'errors.models.endpoint_has_credentials',
    message:
      'Taalcut doesn’t keep passwords in server addresses. Remove the user name and password from the address, then try again.',
  }),
  msg({
    id: 'errors.models.endpoint_invalid',
    message: 'That isn’t an address Taalcut can use. Start it with http:// or https://, then try again.',
  }),
  msg({
    id: 'errors.models.acknowledgement_required',
    message: 'Read the warning and choose “I understand” first.',
  }),
  // FIX-ERRWORDS: signing in, keys, profiles and local servers. `{provider}` reads as people know it (errorValues).
  msg({
    id: 'errors.models.api_key_invalid',
    message: '{provider} didn’t accept this key. Check it, then add it again.',
  }),
  msg({ id: 'errors.models.sign_in_failed', message: 'Signing in to {provider} didn’t work. Try again.' }),
  msg({
    id: 'errors.models.sign_in_timeout',
    message: 'The {provider} sign-in wasn’t finished in time. Try again, and finish it in your browser.',
  }),
  msg({
    id: 'errors.models.sign_in_denied',
    message: 'Access to {provider} was declined, so Taalcut isn’t signed in. Sign in again and allow access.',
  }),
  msg({
    id: 'errors.models.sign_in_port_busy',
    message:
      'Another app is using port {port}, which the {provider} sign-in needs. Quit that app, then try again.',
  }),
  msg({
    id: 'errors.models.sign_in_required',
    message: 'Your {provider} sign-in has ended. Sign in again in Settings › Accounts.',
  }),
  msg({
    id: 'errors.models.sign_in_unsupported',
    message: '{provider} doesn’t offer sign-in. Add an API key instead.',
  }),
  // A local server's check keeps only the code (describeErrorCode), so no parameters.
  msg({
    id: 'errors.models.local_server_unreachable',
    message:
      'Couldn’t reach the model server. Check that it’s running and its address is right, then try again.',
  }),
  msg({
    id: 'errors.models.profile_invalid',
    message: 'That model profile isn’t valid. Check it, then save it again.',
  }),
  msg({
    id: 'errors.models.profile_not_found',
    message: 'That profile isn’t here any more. Choose another in Settings › Models.',
  }),
  msg({ id: 'errors.models.profile_store_failed', message: 'Couldn’t save your model settings. Try again.' }),
  msg({
    id: 'errors.models.unsupported_module',
    message: 'That job doesn’t run on a chat model. Pick its model in Settings › Models.',
  }),
];

/**
 * A key's words off a Mac (LNX1, UX3-MAC): the backend sends one key on every system, and the renderer knows where
 * it runs. The same pairs the catalogue is loaded through (i18n/platform-words.ts), so a caller that names the
 * platform gets this computer's words whichever catalogue is active.
 */
const OFF_MAC: ReadonlyMap<HostPlatform, ReadonlyMap<string, MessageDescriptor>> = new Map(
  HOST_PLATFORMS.map((platform) => [platform, platformWordsById(PLATFORM_WORDS, platform)]),
);

function offMac(key: string, platform: HostPlatform): MessageDescriptor | undefined {
  return OFF_MAC.get(platform)?.get(key);
}

const UNKNOWN = ERROR_MESSAGES['errors.core.unknown'] ?? msg`Something went wrong. Try again.`;

/** This file's own descriptors by id: their English stands in when a catalogue hasn't caught up yet. */
const KEYED_BY_ID: ReadonlyMap<string, MessageDescriptor> = new Map(
  [...KEYED_MESSAGES, ...SETTINGS_ERROR_MESSAGES, ...IMPORT_ERROR_MESSAGES].flatMap((descriptor) =>
    descriptor.id ? [[descriptor.id, descriptor] as const] : [],
  ),
);

/** A message for a key from the backend, or `fallback` when the catalogue doesn't have it. */
export function translateKey(
  i18n: I18n,
  key: string,
  fallback: MessageDescriptor,
  platform: HostPlatform = 'mac',
): string {
  const local = offMac(key, platform);
  if (local) return i18n._(local);
  return key in i18n.messages ? i18n._(key) : i18n._(fallback);
}

/** The plain sentence for an error (PRD 9.4: cause, then what to do). Never the developer detail. */
export function describeError(
  i18n: I18n,
  error: Pick<TaalcutError, 'messageKey' | 'params'>,
  platform: HostPlatform = 'mac',
): string {
  const descriptor = offMac(error.messageKey, platform) ?? ERROR_MESSAGES[error.messageKey];
  const values = errorValues(i18n, error.params);
  if (descriptor) return i18n._({ ...descriptor, values });
  if (error.messageKey in i18n.messages) return i18n._(error.messageKey, values);
  const keyed = KEYED_BY_ID.get(error.messageKey);
  return keyed ? i18n._({ ...keyed, values }) : i18n._(UNKNOWN);
}

/** The English sentence for an error code (for codes stored without the error, like a key check). */
export function describeErrorCode(i18n: I18n, code: string | undefined): string {
  return describeError(i18n, { messageKey: `errors.${code ?? 'core.unknown'}` });
}
