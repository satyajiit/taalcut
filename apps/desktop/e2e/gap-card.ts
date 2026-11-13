// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FIX-ASK's gaps question in the make flow's journeys (make-flow*.e2e.ts, mcp-journey.e2e.ts). The run asks on the
 * gapFix card, before render, when the cast leaves a shot with no clip, is unsure of the opening clip or of a clip
 * under the template's text, or is unsure of more than a fifth of its clips. The card opens with Taalcut's proposals
 * chosen, and the person takes them. A cast that raises none of these goes on without asking. Each journey says what
 * going on looks like for it: by default the "Ready to export" card, or else the step it waits for next, such as a
 * render running or an edit asked for.
 */
import { expect, type Locator } from '@playwright/test';

const EVERY_MS = 250;

/** The gapFix card while the run asks (after the answer it is a step panel, without `data-asking`). */
export const askingGapCard = (transcript: Locator) =>
  transcript.locator('[data-card-type="gapFix"][data-asking]');

const readyCards = (transcript: Locator) =>
  transcript
    .getByRole('listitem')
    .filter({ has: transcript.page().getByRole('heading', { name: 'Ready to export' }) });

/**
 * Takes the gapFix card's proposals once it asks, or returns once `wentOn` says the run went on without asking (by
 * default, a "Ready to export" card in the transcript). Throws after `timeout` with neither.
 */
export async function takeGapProposals(
  transcript: Locator,
  timeout: number,
  wentOn: () => boolean | Promise<boolean> = async () => (await readyCards(transcript).count()) > 0,
): Promise<'taken' | 'not asked'> {
  const deadline = Date.now() + timeout;
  for (;;) {
    const asking = askingGapCard(transcript);
    if ((await asking.count()) > 0) {
      await asking
        .last()
        .getByRole('button', { name: /^Fix \d+ gaps?$/ })
        .click();
      await expect(asking).toHaveCount(0, { timeout });
      return 'taken';
    }
    if (await wentOn()) return 'not asked';
    if (Date.now() > deadline) {
      throw new Error(`No gaps question, and the run didn't go on, in ${timeout} ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, EVERY_MS));
  }
}
