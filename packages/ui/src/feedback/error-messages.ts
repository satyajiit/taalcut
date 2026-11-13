// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { I18n, MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import type { FixAction, TaalcutError } from '@taalcut/core';
import { providerLabel } from '../cards/labels';
import { DOMAIN_ERROR_MESSAGES } from './domain-error-messages';

/**
 * The words for every error code (TaalcutError.messageKey is 'errors.<code>')
 * and every fix button (FixAction.labelKey). One sentence that names the cause
 * and, where it helps, what to do (PRD 9.4). A package that defines an error
 * adds its message here; codes without one show the generic message.
 */
export const ERROR_MESSAGES: Readonly<Record<string, MessageDescriptor>> = {
  'errors.core.unknown': msg({
    id: 'errors.core.unknown',
    message: 'Something went wrong. Try again, and if it keeps happening, restart Taalcut.',
  }),
  'errors.core.validation': msg({
    id: 'errors.core.validation',
    message: 'Taalcut got something it could not read. Try again.',
  }),
  // Names the thing when the error says what it was (params.entity), so you know which one.
  'errors.core.not_found': msg({
    id: 'errors.core.not_found',
    message:
      '{entity, select, source {That folder is no longer here.} project {That project is no longer here.} conversation {That chat is no longer here.} asset {That clip is no longer here.} artifact {That file is no longer here.} notice {That licence notice is no longer here.} other {That is no longer here.}} It may have been moved or deleted.',
  }),
  'errors.core.project_editing': msg({ id: 'errors.core.project_editing', message: 'AI is editing this project. Wait for it to finish, or press Stop in chat before making changes.' }),
  'errors.core.editing_stopped': msg({ id: 'errors.core.editing_stopped', message: 'This edit was stopped. Committed changes are kept; you can undo them or send a new request.' }),
  'errors.core.cancelled': msg({ id: 'errors.core.cancelled', message: 'Stopped before it finished.' }),
  'errors.core.timeout': msg({
    id: 'errors.core.timeout',
    message: 'This took too long and was stopped. Try again.',
  }),
  'errors.core.process_restarted': msg({
    id: 'errors.core.process_restarted',
    message: 'Part of Taalcut restarted while working on this. Try again.',
  }),
  'errors.core.not_implemented': msg({
    id: 'errors.core.not_implemented',
    message: 'This is not in Taalcut yet.',
  }),
  'errors.core.card_unsupported': msg({
    id: 'errors.core.card_unsupported',
    message: 'This card needs a newer version of Taalcut.',
  }),
  'errors.core.event_stream_overflow': msg({
    id: 'errors.core.event_stream_overflow',
    message: 'Updates arrived faster than Taalcut could show them. Reopen this view to catch up.',
  }),
  'errors.core.conflict': msg({
    id: 'errors.core.conflict',
    message: 'Something else changed this at the same time. Reload it and try again.',
  }),
  ...DOMAIN_ERROR_MESSAGES,
  // REF1: an old chat can still hold this stop from before the download warning was dropped (its fix,
  // reference.showWarning, is retired: fixOn shows none). Nothing raises it now.
  'errors.templates.acknowledgement_required': msg({
    id: 'errors.templates.acknowledgement_required',
    message: 'This reel stopped at a step Taalcut no longer asks for. Send the link again.',
  }),
};

/**
 * Errors whose sentence depends on what is missing (`params.name`): `<messageKey>.<name, spaces as underscores>` when
 * the catalogue has it, else the plain sentence. Render's `render.media_missing` names 'reference audio',
 * 'generated music' or 'music track', or a clip by its id (REF1; the renderer holds the words).
 */
const KEYED_BY_NAME: ReadonlySet<string> = new Set(['errors.render.media_missing']);

const byNameKey = (messageKey: string, name: string) => `${messageKey}.${name.trim().replace(/\s+/g, '_')}`;

/**
 * The same errors when the backend knows the missing thing's name
 * (`params.name`, e.g. the folder "Diwali 2025"): the name is shown as written.
 */
export const NAMED_ERROR_MESSAGES: Readonly<Record<string, MessageDescriptor>> = {
  'errors.core.not_found': msg({
    id: 'errors.core.not_found.named',
    message:
      '{entity, select, source {The folder “{name}” is no longer here.} project {The project “{name}” is no longer here.} conversation {The chat “{name}” is no longer here.} asset {The clip “{name}” is no longer here.} artifact {The file “{name}” is no longer here.} other {“{name}” is no longer here.}} It may have been moved or deleted.',
  }),
};

export const FIX_LABELS: Readonly<Record<string, MessageDescriptor>> = {
  'fix.retry': msg({ id: 'fix.retry', message: 'Try again' }),
  'fix.openSettings': msg({ id: 'fix.openSettings', message: 'Open Settings' }),
  'fix.openAccounts': msg({ id: 'fix.openAccounts', message: 'Open Accounts' }),
  'fix.openModels': msg({ id: 'fix.openModels', message: 'Choose a model' }),
  'fix.openPrivacy': msg({ id: 'fix.openPrivacy', message: 'Go to Privacy' }),
  'fix.openUsage': msg({ id: 'fix.openUsage', message: 'Open Spending' }),
  'fix.openComponents': msg({ id: 'fix.openComponents', message: 'Open On this Mac' }),
  'fix.openStorageSettings': msg({ id: 'fix.openStorageSettings', message: 'Open Storage Settings' }),
  'fix.openExternalAgents': msg({ id: 'fix.openExternalAgents', message: 'Open External agents' }),
  'fix.chooseFolder': msg({ id: 'fix.chooseFolder', message: 'Choose another folder' }),
  'fix.addFolder': msg({ id: 'fix.addFolder', message: 'Add a folder' }),
  'fix.reload': msg({ id: 'fix.reload', message: 'Reload' }),
  'fix.signIn': msg({ id: 'fix.signIn', message: 'Sign in' }),
  'fix.reviewSignInWarning': msg({ id: 'fix.reviewSignInWarning', message: 'Read the warning' }),
  // Fix actions core defines (core SPEC 14.7): the reference warnings, and System Settings' Files and Folders.
  'fix.openReferenceAudioWarning': msg({ id: 'fix.openReferenceAudioWarning', message: 'Read and decide' }),
  /**
   * @deprecated REF1: the reel-download warning is gone and nothing offers this fix. An old chat's stored error may
   * still name it; fixOn shows no button for it. The words stay for builds that still do.
   */
  'fix.showReferenceWarning': msg({ id: 'fix.showReferenceWarning', message: 'Read the warning' }),
  'fix.openFilesAndFolders': msg({ id: 'fix.openFilesAndFolders', message: 'Open Files and Folders' }),
};

const GENERIC_FIX = msg({ id: 'fix.default', message: 'Fix it' });

/**
 * An error's parameters as its sentence shows them: `provider` by the name people know it by (models' errors carry
 * the id, `openai`; the sentence says OpenAI, and ChatGPT for the plan's sign-in). The rest as they are.
 */
export function errorValues(i18n: I18n, params: TaalcutError['params']): Record<string, unknown> | undefined {
  const provider = params?.['provider'];
  return typeof provider === 'string' ? { ...params, provider: providerLabel(i18n, provider) } : params;
}

/** The error's sentence in the current language; the generic message for codes without words yet. */
export function errorMessage(i18n: I18n, error: TaalcutError): string {
  const name = error.params?.['name'];
  if (typeof name === 'string' && name.trim() !== '' && KEYED_BY_NAME.has(error.messageKey)) {
    const keyed = byNameKey(error.messageKey, name);
    if (keyed in i18n.messages) return i18n._(keyed, errorValues(i18n, error.params));
  }
  const named =
    typeof name === 'string' && name.trim() !== '' ? NAMED_ERROR_MESSAGES[error.messageKey] : undefined;
  const descriptor = named ?? ERROR_MESSAGES[error.messageKey];
  const values = errorValues(i18n, error.params);
  if (descriptor) return i18n._({ ...descriptor, values });
  if (error.messageKey in i18n.messages) return i18n._(error.messageKey, values);
  return i18n._(ERROR_MESSAGES['errors.core.unknown'] ?? GENERIC_FIX);
}

/** The fix button's label; "Fix it" when the key has no words yet. */
export function fixLabel(i18n: I18n, fix: FixAction): string {
  const descriptor = FIX_LABELS[fix.labelKey];
  if (descriptor) return i18n._(descriptor);
  if (fix.labelKey in i18n.messages) return i18n._(fix.labelKey);
  return i18n._(GENERIC_FIX);
}
