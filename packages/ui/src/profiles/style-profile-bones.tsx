// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: style profile bones (LRN1-STY) · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.4 · StyleProfileSummary's loading shape, drawn by hand because its page isn't on the bones
 *   capture list: the same raised section and hairline, the title and "Measured from" lines, the eight facts in the
 *   same 2 / 4 column grid, three exemplar rows with a 9:16 first frame, and the paragraph with its "Written" line.
 *   Bones are tc-bone on hover grey, like the captured ones, so the section keeps its place when the answer comes
 * states: one (loading), announced once as "Loading"
 */
import { useLingui } from '@lingui/react/macro';
import { cn } from '../lib/cn';

const BONE = 'tc-bone block rounded-sm bg-hover';

function FactBones() {
  return (
    <span className="flex flex-col gap-1.5">
      <span className={cn(BONE, 'h-3 w-20')} />
      <span className={cn(BONE, 'h-5 w-16')} />
      <span className={cn(BONE, 'h-3 w-28 max-w-full')} />
    </span>
  );
}

function ExemplarBones() {
  return (
    <span className="flex items-center gap-3 rounded-md border border-rule p-2">
      <span className={cn(BONE, 'h-16 w-9 shrink-0')} />
      <span className="flex flex-1 flex-col gap-1.5">
        <span className={cn(BONE, 'h-4 w-3/4')} />
        <span className={cn(BONE, 'h-3 w-1/2')} />
      </span>
    </span>
  );
}

/** The summary's shape while it loads: the host's Skeleton fallback. */
export function StyleProfileBones() {
  const { t } = useLingui();
  return (
    <div
      data-slot="style-profile-bones"
      className="flex flex-col gap-4 rounded-lg border border-rule bg-raised p-4 shadow-xs"
    >
      <span className="sr-only" role="status">
        {t`Loading`}
      </span>
      <span aria-hidden className="flex flex-col gap-1.5">
        <span className={cn(BONE, 'h-5 w-72 max-w-full')} />
        <span className={cn(BONE, 'h-3 w-36')} />
      </span>
      <span aria-hidden className="grid grid-cols-2 gap-x-6 gap-y-4 lg:grid-cols-4">
        {Array.from({ length: 8 }, (_, index) => (
          <FactBones key={index} />
        ))}
      </span>
      <span aria-hidden className="flex flex-col gap-2">
        <span className={cn(BONE, 'h-4 w-32')} />
        <span className="grid grid-cols-1 gap-2 lg:grid-cols-3">
          {Array.from({ length: 3 }, (_, index) => (
            <ExemplarBones key={index} />
          ))}
        </span>
      </span>
      <span aria-hidden className="flex flex-col gap-2 ps-5.5">
        <span className={cn(BONE, 'h-4 w-full max-w-[65ch]')} />
        <span className={cn(BONE, 'h-4 w-full max-w-[65ch]')} />
        <span className={cn(BONE, 'h-4 w-1/3')} />
        <span className={cn(BONE, 'mt-1 h-3 w-72 max-w-full')} />
      </span>
    </div>
  );
}
