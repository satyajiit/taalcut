// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The dials in the prompt (SPEC section 22): a short "# Your dials now" block, after SOUL.md and before the
 * operating rules, in the main prompt and in every skill's. It is built from the dials the run logged in
 * run.started and the stop lines SOUL.md itself defines, so a dial change applies from the next run, a run's
 * prompt never changes mid-run (the provider's prompt cache stays warm), and resume and replay rebuild it.
 * Model-facing text, not user-facing copy.
 */
import type { SoulDials } from '@taalcut/core';
import type { DialStop, Soul, SoulDial } from './soul-file';

const DIAL_LABEL: Readonly<Record<SoulDial, string>> = { tone: 'Tone', verbosity: 'Verbosity' };

/** The stop a dial is at, or undefined when the soul has no dial table or the stop is out of range. */
export function dialStop(soul: Pick<Soul, 'stops'>, dial: SoulDial, at: number): DialStop | undefined {
  return soul.stops?.[dial][at];
}

/** "Tone: crisp (4 of 5 toward professional)." */
function dialLine(soul: Soul, dial: SoulDial, at: number): string | undefined {
  const stops = soul.stops?.[dial];
  const stop = stops?.[at];
  const last = stops?.at(-1);
  if (!stops || !stop || !last) return undefined;
  return `${DIAL_LABEL[dial]}: ${stop.name} (${at + 1} of ${stops.length} toward ${last.name}).`;
}

/** The block for these dials, or undefined when the soul has no dial table (Phase 2's prompt). */
export function dialBlock(soul: Soul, dials: SoulDials): string | undefined {
  const tone = dialLine(soul, 'tone', dials.tone);
  const verbosity = dialLine(soul, 'verbosity', dials.verbosity);
  const toneStop = dialStop(soul, 'tone', dials.tone);
  const verbosityStop = dialStop(soul, 'verbosity', dials.verbosity);
  if (!tone || !verbosity || !toneStop || !verbosityStop) return undefined;
  return [
    '# Your dials now',
    `${tone} ${verbosity}`,
    `- ${DIAL_LABEL.tone}: ${toneStop.says}`,
    `- ${DIAL_LABEL.verbosity}: ${verbosityStop.says}`,
  ].join('\n');
}

/**
 * The soul as one run sees it: the file plus the block for the dials its run.started logged. A run started
 * without dials (an agent composed without them, a log from before Phase 3) gets the file alone.
 */
export function runSoul(soul: Soul, dials: SoulDials | undefined): Soul {
  const { dialBlock: _previous, ...file } = soul;
  const block = dials ? dialBlock(file, dials) : undefined;
  return block ? { ...file, dialBlock: block } : file;
}

/** What goes first in every system prompt: SOUL.md verbatim, then the run's dial block when it has one. */
export function personaParts(soul: Soul): string[] {
  return soul.dialBlock ? [soul.text, soul.dialBlock] : [soul.text];
}
