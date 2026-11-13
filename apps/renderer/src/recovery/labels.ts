// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Plain words for what the recovery report names by id: background job kinds
 * and saved commands. The ids themselves only show in developer builds.
 */
import type { I18n, MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { translateKey } from '../features/settings/model-messages';

const JOB_KINDS: Readonly<Record<string, MessageDescriptor>> = {
  'media.probe': msg`Reading a video’s details`,
  'media.extractFrame': msg`Taking a still from a video`,
  'media.selectEncoder': msg`Choosing how to encode`,
  'media.proxy': msg`Making an editing copy of a video`,
  'vision.index': msg`Looking through a video`,
};

/** By the first part of a command's name, when the command has no words of its own. */
const COMMAND_AREAS: Readonly<Record<string, MessageDescriptor>> = {
  timeline: msg`A change to the timeline`,
  library: msg`A change to your library`,
  settings: msg`A change to settings`,
  models: msg`A change to the models`,
};

const SOME_JOB = msg`A background job`;
const SOME_CHANGE = msg`A change`;

export function jobKindLabel(i18n: I18n, kind: string): string {
  return i18n._(JOB_KINDS[kind] ?? SOME_JOB);
}

/** The command's own label ('commands.<name>') when it has one, else what it changed. */
export function commandLabel(i18n: I18n, name: string): string {
  const area = COMMAND_AREAS[name.split('.')[0] ?? ''] ?? SOME_CHANGE;
  return translateKey(i18n, `commands.${name}`, area);
}
