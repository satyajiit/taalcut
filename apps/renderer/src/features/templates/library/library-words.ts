// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The template library's words (P3-V14): sorts, lengths, the templates service's library errors (explicit ids:
 * the service names them by key), and a template's name as the page shows it (a starter's fork by the starter's
 * name in this language, since the service names the fork by the starter's id).
 */
import type { I18n, MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import type { TaalcutError, TemplateSort, TemplateSummary } from '@taalcut/core';
import { errorMessage } from '@taalcut/ui';
import { starterName } from '../../starters/starter-words';
import type { TemplateLength } from './template-search';

export const SORT_LABELS: Readonly<Record<TemplateSort, MessageDescriptor>> = {
  updated: msg`Recently changed`,
  name: msg`Name`,
  trend: msg`Trend date`,
  favourite: msg`Favourites first`,
  used: msg`Most used`,
};

/** Each sort's two directions in words, in the sort pill's menu. */
export const SORT_DIRECTION_WORDS: Readonly<
  Record<TemplateSort, Readonly<Record<'asc' | 'desc', MessageDescriptor>>>
> = {
  updated: { desc: msg`Newest first`, asc: msg`Oldest first` },
  name: { asc: msg`A to Z`, desc: msg`Z to A` },
  trend: { desc: msg`Newest first`, asc: msg`Oldest first` },
  favourite: { desc: msg`Favourites first`, asc: msg`Favourites last` },
  used: { desc: msg`Most used first`, asc: msg`Least used first` },
};

export const LENGTH_LABELS: Readonly<Record<TemplateLength, MessageDescriptor>> = {
  short: msg`Up to 15 seconds`,
  medium: msg`15 to 30 seconds`,
  long: msg`Over 30 seconds`,
};

const LIBRARY_ERRORS: Readonly<Record<string, MessageDescriptor>> = {
  'errors.templates.tag_invalid': msg({
    id: 'errors.templates.tag_invalid',
    message:
      '“{tag}” can’t be a tag. Use letters and numbers, with hyphens between words, up to 32 characters.',
  }),
  'errors.templates.folder_not_found': msg({
    id: 'errors.templates.folder_not_found',
    message: 'That folder is no longer here. It may have been deleted.',
  }),
  'errors.templates.folder_name_taken': msg({
    id: 'errors.templates.folder_name_taken',
    message: 'You already have a folder with that name. Choose another.',
  }),
  'errors.templates.import_invalid': msg({
    id: 'errors.templates.import_invalid',
    message: 'One of the files isn’t a Taalcut template Taalcut can read, so nothing was imported.',
  }),
  'errors.templates.style_not_found': msg({
    id: 'errors.templates.style_not_found',
    message: 'The look this template uses is no longer here. Export it without the look.',
  }),
};

/** One sentence for a failed library command: the service's own words, else the app's for its code. */
export function libraryErrorText(i18n: I18n, error: TaalcutError): string {
  const descriptor = LIBRARY_ERRORS[error.messageKey];
  return descriptor ? i18n._({ ...descriptor, values: error.params }) : errorMessage(i18n, error);
}

/** The name to show: the person's, or a starter fork's in this language while it still has the starter's id. */
export function templateName(i18n: I18n, summary: Pick<TemplateSummary, 'name' | 'provenance'>): string {
  const from = summary.provenance;
  if (from?.kind === 'starter' && summary.name === from.starterId)
    return starterName(i18n, `starters.${from.starterId}.name`);
  return summary.name;
}

/** Whether the name shown is the app's words (a starter's) rather than the person's (translated, not raw). */
export const isStarterName = (summary: Pick<TemplateSummary, 'name' | 'provenance'>) =>
  summary.provenance?.kind === 'starter' && summary.name === summary.provenance.starterId;
