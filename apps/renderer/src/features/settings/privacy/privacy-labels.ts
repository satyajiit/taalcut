// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Privacy's words for core's enums (SENT_KINDS, OTHER_NETWORK_FLOWS), owned by the catalogue. */
import type { I18n, MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import type { OTHER_NETWORK_FLOWS, SENT_KINDS } from '@taalcut/core';

export const SENT_KIND_LABELS: Readonly<Record<(typeof SENT_KINDS)[number], MessageDescriptor>> = {
  messages: msg`messages`,
  'tool-results': msg`tool results`,
  frames: msg`video frames`,
  audio: msg`audio`,
  transcripts: msg`transcripts`,
  prompts: msg`prompts`,
  memory: msg`your memory`,
};

type Flow = (typeof OTHER_NETWORK_FLOWS)[number];

/** A flow's name, what it sends, and (where one is owed) a second line about it. */
interface FlowWords {
  readonly name: MessageDescriptor;
  readonly sends: MessageDescriptor;
  readonly more?: MessageDescriptor;
}

export const FLOW_LABELS: Readonly<Record<Flow, FlowWords>> = {
  'update-checks': {
    name: msg`Update checks`,
    sends: msg`Sends the app’s version, nothing of yours.`,
    // electron-updater's staging id (security review SB-21): random, in <userData>/.updaterId, sent as
    // x-user-staging-id on every check; main's update logger drops the lines that print it.
    more: msg`Each check also sends a random ID made for this Mac, so a new version can reach some Macs first. It isn’t linked to you or your files, and Taalcut doesn’t log it.`,
  },
  'component-downloads': {
    name: msg`Model and component downloads`,
    sends: msg`Downloads what runs on this Mac. Sends nothing of yours.`,
  },
  'reference-links': {
    name: msg`Reference links`,
    sends: msg`Downloads a reel you paste, to read how it’s cut.`,
  },
  telemetry: { name: msg`Telemetry`, sends: msg`Only when you turn it on, under Help improve Taalcut.` },
  'crash-reports': {
    name: msg`Crash reports`,
    sends: msg`Only when you turn them on, under Help improve Taalcut.`,
  },
  feedback: { name: msg`Feedback`, sends: msg`Only when you send it, with what you chose to attach.` },
  'stock-media': {
    name: msg`Stock media`,
    sends: msg`Only when you search for stock footage or music: sends your search words.`,
  },
  'template-hub': {
    name: msg`Template hub`,
    sends: msg`Downloads shared templates. Sends a template only when you share it.`,
  },
};

/**
 * A short list in this language's way ("a, b, c": a unit list, no "and" to translate); the pseudo-locale
 * has no list data, so English joins it.
 */
export function listOf(i18n: I18n, items: readonly string[]): string {
  const locale = i18n.locale === 'en-XA' ? 'en' : i18n.locale;
  return new Intl.ListFormat(locale, { type: 'unit', style: 'short' }).format(items);
}
