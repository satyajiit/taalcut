// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The export dialog's steps (UX4): one decision each, in the order a person makes them, then a summary before
 * Export. Each step holds sections from sections/index.ts; a step none of whose sections this export shows is
 * skipped, decided once when the dialog opens so nothing moves while you're in it. "For another editor" isn't a
 * step: it is another destination, folded under the first.
 */
import { msg } from '@lingui/core/macro';
import type { MessageDescriptor } from '@lingui/core';
import type { ExportSectionId } from './sections';

export type ExportStepId = 'destination' | 'sound' | 'captions' | 'framing' | 'credits' | 'summary';

export interface ExportStep {
  readonly id: ExportStepId;
  /** Its name in the steps row and its heading. */
  readonly name: MessageDescriptor;
  /** The heading, where it says more than the name. */
  readonly heading?: MessageDescriptor;
  /** One line under the heading: what the step decides. */
  readonly line: MessageDescriptor;
  /** The sections it shows, in order; the summary has none of its own. */
  readonly sections: readonly ExportSectionId[];
}

export const EXPORT_STEPS: readonly ExportStep[] = [
  {
    id: 'destination',
    name: msg`Where it’s going`,
    line: msg`Taalcut fits the file to the app you pick: its length, its size and where its buttons sit.`,
    sections: ['where'],
  },
  {
    id: 'sound',
    name: msg`Sound`,
    line: msg`What plays under your clips, and how it sits with the voice.`,
    sections: ['music', 'voice'],
  },
  {
    id: 'captions',
    name: msg`Captions`,
    line: msg`Words on screen, from what’s said in the clips.`,
    sections: ['captions'],
  },
  {
    id: 'framing',
    name: msg`Framing`,
    line: msg`Clips shot in another shape, fitted to this one.`,
    sections: ['reframe'],
  },
  {
    id: 'credits',
    name: msg`Credits`,
    heading: msg`Credits and labels`,
    line: msg`What goes with the post: who to credit, and how the AI parts are labelled.`,
    sections: ['aiLabel', 'credits'],
  },
  {
    id: 'summary',
    name: msg`Summary`,
    heading: msg`Ready to export`,
    line: msg`Check it once. Taalcut checks the video again before it’s saved.`,
    sections: [],
  },
];

/** The steps this export shows: every step with a section on screen, and always the first and the summary. */
export function shownSteps(sections: readonly ExportSectionId[]): readonly ExportStep[] {
  return EXPORT_STEPS.filter(
    (step) =>
      step.id === 'destination' ||
      step.id === 'summary' ||
      step.sections.some((section) => sections.includes(section)),
  );
}
