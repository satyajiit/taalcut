// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: a background job's bar · genre: atmospheric studio app · system: DESIGN.md v0.3
 * background work runs neutral (DESIGN.md, Running): an ink-3 fill on the hover track, scaled with transform, never
 *   violet. One bar for the model downloads, the sidebar's "Getting ready" and a cable import.
 * states: n/a (a progressbar, not a control: its value is the state)
 * motion: the fill's transform (--dur-short, --ease-out); reduced motion: base.css stops it moving
 */

/** Its accessible name: the element that names the job, or the words. */
type BarName = { labelledBy: string; label?: never } | { label: string; labelledBy?: never };

/** A background job's progress, 0 to 1. `thin` is the sidebar's hairline. */
export function JobBar({ fraction, thin = false, ...name }: BarName & { fraction: number; thin?: boolean }) {
  return (
    <div
      role="progressbar"
      aria-labelledby={name.labelledBy}
      aria-label={name.label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(fraction * 100)}
      className={`relative ${thin ? 'h-0.5' : 'h-1'} overflow-hidden rounded-pill bg-hover`}
    >
      <span
        className="absolute inset-0 origin-left rounded-pill bg-ink-3 transition-transform duration-(--dur-short) ease-(--ease-out)"
        style={{ transform: `scaleX(${fraction})` }}
      />
    </div>
  );
}
