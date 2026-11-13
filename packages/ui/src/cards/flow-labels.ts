// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { I18n, MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import type { FlowStepStatus, OpeningPath } from '@taalcut/core';

/**
 * The words for a flow's steps: skills declare a `labelKey`, flows seed plan
 * steps and cards with it, and the window says it in the user's language with
 * no model call (agent SPEC section 13). Explicit ids: the skills name them.
 */
export const FLOW_STEP_LABELS: Readonly<Record<string, MessageDescriptor>> = {
  'skills.templates.analyst': msg({ id: 'skills.templates.analyst', message: 'Read the reel' }),
  'skills.timeline.librarian': msg({ id: 'skills.timeline.librarian', message: 'Pick your clips' }),
  'skills.timeline.caster': msg({ id: 'skills.timeline.caster', message: 'Pick your clips' }),
  'skills.timeline.editor': msg({ id: 'skills.timeline.editor', message: 'Cut it to the beat' }),
  // AGT2: the step that makes the video, checks it against the reel and fixes it.
  'skills.timeline.maker': msg({ id: 'skills.timeline.maker', message: 'Make it and check it' }),
  'skills.agent.brief': msg({ id: 'skills.agent.brief', message: 'Plan the video' }),
  'skills.agent.gaps': msg({ id: 'skills.agent.gaps', message: 'Fill missing shots' }),
  'skills.voice.director': msg({
    id: 'skills.voice.director',
    message: 'Record and place the voice-over',
  }),
  'skills.render.designer': msg({
    id: 'skills.render.designer',
    message: 'Design the motion graphics',
  }),
  'skills.render.reviewer': msg({
    id: 'skills.render.reviewer',
    message: 'Check the finished video',
  }),
  'skills.render.export': msg({ id: 'skills.render.export', message: 'Export' }),
  // The agent's own keys: a flow's export step, and a model turn with no skill (packages/agent flows.ts).
  'flows.step.export': msg({ id: 'flows.step.export', message: 'Export' }),
  'flows.step.voiceFinalize': msg({
    id: 'flows.step.voiceFinalize',
    message: 'Finish the voice-over',
  }),
  'flows.step.model': msg({ id: 'flows.step.model', message: 'The next step' }),
  // EDT1-CMT: the Editor's run through "Send N comments to Taalcut" (packages/agent comments/comment-run.ts).
  'flows.step.comments': msg({ id: 'flows.step.comments', message: 'Work through your comments' }),
};

const A_STEP = msg`A step`;

/** A step's name from its key; an unknown key reads "A step" (a newer agent, an older window). */
export function flowStepLabel(i18n: I18n, key: string | undefined): string {
  if (!key) return i18n._(A_STEP);
  const known = FLOW_STEP_LABELS[key];
  if (known) return i18n._(known);
  return key in i18n.messages ? i18n._(key) : i18n._(A_STEP);
}

/** A flow step's status in words (always beside its mark, so colour is never the only signal). */
export const FLOW_STATUS_LABELS: Readonly<Record<FlowStepStatus, MessageDescriptor>> = {
  waiting: msg`Waiting`,
  running: msg`Working on it`,
  ready: msg`Ready`,
  updating: msg`Updating with your change`,
  failed: msg`Didn’t work`,
  skipped: msg`Skipped`,
};

/** The four ways in (packages/ui SPEC, openingChoices): the word, and one line on what it does. */
export const OPENING_WORDS: Readonly<
  Record<OpeningPath, { name: MessageDescriptor; line: MessageDescriptor }>
> = {
  library: {
    name: msg`Use my library`,
    line: msg`Taalcut proposes a video from your newest clips.`,
  },
  reference: {
    name: msg`Paste a reel`,
    line: msg`Copy the cuts and beats of a reel you like.`,
  },
  template: {
    name: msg`Start from a template`,
    line: msg`Cut your clips to a template you saved, or a format.`,
  },
  describe: {
    name: msg`Just describe it`,
    line: msg`Say what you want, in your own words.`,
  },
};

/** First run's template row (P3-B3): it opens the starter grid instead of the template list. */
export const STARTER_WORDS: { name: MessageDescriptor; line: MessageDescriptor } = {
  name: msg({ id: 'onboarding.firstVideo.starter.title', message: 'Start from a starter template' }),
  line: msg({
    id: 'onboarding.firstVideo.starter.body',
    message: 'No reel needed. Pick a shape, and Taalcut fills it with your clips.',
  }),
};

/** What the user's message says when a choice starts a flow: shown as their message, in their language. */
export const OPENING_MESSAGES: Readonly<Record<Exclude<OpeningPath, 'describe'>, MessageDescriptor>> = {
  library: msg`Make a video from my latest clips`,
  reference: msg`Make a video like this reel`,
  template: msg`Make a video with this template`,
};

/** Why a way in can't run now (an openingChoices card's `unavailable[].reasonKey`). */
export const OPENING_REASONS: Readonly<Record<string, MessageDescriptor>> = {
  'opening.reference.localOnly': msg({
    id: 'opening.reference.localOnly',
    message: 'Paste a reel needs the internet. Drop a file instead.',
  }),
  'opening.library.empty': msg({
    id: 'opening.library.empty',
    message: 'Add a folder or your phone first.',
  }),
  'opening.template.none': msg({
    id: 'opening.template.none',
    message: 'No templates yet. Paste a reel to make one.',
  }),
  'opening.busy': msg({ id: 'opening.busy', message: 'Taalcut is working on something. Wait or stop it.' }),
  // The agent's: a flow whose skills or export tool this build doesn't have yet (packages/agent tool-step.ts).
  'flows.unavailable.notInstalled': msg({
    id: 'flows.unavailable.notInstalled',
    message: 'Not in this version of Taalcut yet.',
  }),
};

const UNAVAILABLE = msg`Not available right now.`;

export function openingReason(i18n: I18n, key: string): string {
  const known = OPENING_REASONS[key];
  if (known) return i18n._(known);
  return key in i18n.messages ? i18n._(key) : i18n._(UNAVAILABLE);
}

/** Reasons that turn a way off only in part: Local only keeps the file way into Paste a reel. */
export const PARTIAL_REASONS: ReadonlySet<string> = new Set(['opening.reference.localOnly']);

/** A way's name and its line; first run calls the template way "Start from a starter template" (P3-B3). */
export function openingWords(
  i18n: I18n,
  path: OpeningPath,
  starters: boolean,
): { name: string; line: string } {
  const source = starters && path === 'template' ? STARTER_WORDS : OPENING_WORDS[path];
  return { name: i18n._(source.name), line: i18n._(source.line) };
}
