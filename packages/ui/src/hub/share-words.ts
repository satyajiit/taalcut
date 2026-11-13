// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The Share view's problems in words (U3): where each one is ("Slot 4, description") and what the hub's content
 * rules found there (core's HUB_CONTENT_RULES ids, plus tooLarge, notNfc and schema). Paths come from
 * hub.shareCheck; values never do.
 */
import type { I18n, MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import type { ShareCheck } from '@taalcut/core';

export type ShareProblem = ShareCheck['problems'][number];

const RULE_WORDS: Readonly<Record<string, MessageDescriptor>> = {
  url: msg`It has a web address in it.`,
  www: msg`It has a web address in it.`,
  domain: msg`It names a website.`,
  email: msg`It has an email address in it.`,
  handle: msg`It has an @handle in it.`,
  phone: msg`It has a phone number in it.`,
  path: msg`It has a file path in it.`,
  encoded: msg`It has encoded data in it.`,
  dataUri: msg`It has embedded data in it.`,
  control: msg`It has hidden characters in it.`,
  notNfc: msg`It has characters written in an unusual way.`,
  tooLarge: msg`The template is too large to share.`,
  schema: msg`The hub can’t read this part.`,
};

const SLOT_FIELDS: Readonly<Record<string, MessageDescriptor>> = {
  text: msg`description`,
  subject: msg`subject`,
  place: msg`place`,
  name: msg`name`,
};

const DOCUMENT_FIELDS: Readonly<Record<string, MessageDescriptor>> = {
  name: msg`Name`,
  description: msg`Description`,
  handle: msg`Handle`,
  tags: msg`Tags`,
  language: msg`Language`,
  style: msg`The look`,
  text: msg`A text box`,
};

export function problemWords(i18n: I18n, problem: ShareProblem): string {
  return i18n._(RULE_WORDS[problem.rule] ?? msg`The hub can’t take this part.`);
}

/** "Slot 4, description", "Name", "The template". */
export function problemPlace(i18n: I18n, problem: ShareProblem): string {
  if (problem.slotIndex !== null) {
    const slot = i18n.number(problem.slotIndex + 1);
    const field = SLOT_FIELDS[problem.field];
    if (!field) return i18n._(msg`Slot ${slot}`);
    const what = i18n._(field);
    return i18n._(msg`Slot ${slot}, ${what}`);
  }
  const top = problem.path.split('.')[0] ?? '';
  const place =
    top === 'structure' ? DOCUMENT_FIELDS[problem.path.split('.')[1] ?? ''] : DOCUMENT_FIELDS[top];
  return i18n._(place ?? msg`The template`);
}

/** Problems that sit in the form's own fields, by field, for the field's own line. */
export function formFieldOf(problem: ShareProblem): 'name' | 'description' | 'handle' | 'tags' | null {
  if (problem.slotIndex !== null) return null;
  const top = problem.path.split('.')[0];
  return top === 'name' || top === 'description' || top === 'handle' || top === 'tags' ? top : null;
}
