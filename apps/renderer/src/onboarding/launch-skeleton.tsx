// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* component: the launch skeleton · genre: atmospheric studio app · system: DESIGN.md v0.4 +
 *   _orch/ux4/specs/design-onb.md
 * what the window shows while Taalcut reads where first run got to: still bones in the shape of the screen that
 *   will open. After first run that is the app (the real sidebar, and the chat start's heading, ways and composer as
 *   bones); on a fresh Mac, the welcome in its frame (lockup, headline, words, Kaatu's line, the figure on a wide
 *   window, the actions at the foot: UX4). Shown only after a short wait, so a quick launch goes straight to its
 *   screen without a flash (v0.4, UX1).
 * states: loading only (aria-busy, announced once as "Loading"); the error is launch-error.tsx
 */
import { useLingui } from '@lingui/react/macro';
import { cn } from '@taalcut/ui';
import { useEffect, useState } from 'react';
import { Sidebar } from '../shell/sidebar';
import type { LaunchHint } from './launch-hint';

/** How long a launch waits before it shows bones: a quick answer never flashes them. */
export const LAUNCH_BONES_AFTER_MS = 150;

const Bone = ({ className }: { className: string }) => (
  <span aria-hidden className={cn('tc-bone block rounded-sm bg-hover', className)} />
);

/** The welcome's column (onboarding-frame.tsx's): the standard measure with the page gutter either side. */
const WELCOME_COLUMN =
  'mx-auto w-full max-w-[calc(var(--container-page-standard)+var(--spacing-page-gutter)*2)] px-page-gutter';

/**
 * The welcome's shape, in its frame: the lockup, three lines of headline, two of words, Kaatu and its line, the
 * figure beside them on a wide window; the actions standing still at the foot on a hairline.
 */
function SetupBones() {
  return (
    <div className="flex h-full flex-col">
      <div className="@container flex min-h-0 flex-1 items-center overflow-hidden">
        <div
          className={cn(
            WELCOME_COLUMN,
            'grid items-center gap-x-16 gap-y-12 py-10 @4xl:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]',
          )}
        >
          <div className="flex flex-col items-start gap-8">
            <Bone className="h-24 w-72 rounded-lg" />
            <div className="flex w-full flex-col gap-4">
              <div className="flex w-full flex-col gap-3">
                <Bone className="h-12 w-[min(26rem,80%)]" />
                <Bone className="h-12 w-[min(22rem,70%)]" />
                <Bone className="h-12 w-[min(24rem,75%)]" />
              </div>
              <div className="flex w-full flex-col gap-2">
                <Bone className="h-4 w-[min(32rem,85%)]" />
                <Bone className="h-4 w-[min(24rem,65%)]" />
              </div>
            </div>
            <div className="flex items-center gap-4">
              <Bone className="size-22 shrink-0 rounded-pill" />
              <Bone className="h-4 w-56" />
            </div>
          </div>
          <Bone className="hidden h-52 w-full rounded-xl @4xl:block" />
        </div>
      </div>
      <div className="shrink-0 border-t border-rule-subtle">
        <div className={cn(WELCOME_COLUMN, 'flex items-center justify-between gap-6 pt-4 pb-5')}>
          <div className="flex gap-2">
            <Bone className="h-10 w-36 rounded-md" />
            <Bone className="h-10 w-28 rounded-md" />
          </div>
          <Bone className="h-4 w-80" />
        </div>
      </div>
    </div>
  );
}

/** The app's shape: the sidebar itself (it reads nothing first run decides), and the chat start as bones. */
function AppBones() {
  return (
    <div className="flex h-full overflow-hidden bg-canvas text-ink">
      <Sidebar />
      <div className="flex min-w-0 flex-1 justify-center px-8 pt-28">
        <div className="flex w-full max-w-page-reading flex-col gap-6">
          <div className="flex items-start gap-5">
            <Bone className="size-16 shrink-0 rounded-lg" />
            <div className="flex flex-1 flex-col gap-3 pt-1">
              <Bone className="h-6 w-64" />
              <Bone className="h-4 w-[85%]" />
            </div>
          </div>
          <div className="flex flex-col">
            {[0, 1, 2, 3].map((row) => (
              <div
                key={row}
                className="flex items-start gap-3 border-t border-rule-subtle py-4 first:border-t-0"
              >
                <Bone className="size-4 shrink-0" />
                <div className="flex flex-1 flex-col gap-2">
                  <Bone className="h-4 w-40" />
                  <Bone className="h-3.5 w-64" />
                </div>
              </div>
            ))}
          </div>
          <Bone className="h-20 w-full rounded-2xl" />
        </div>
      </div>
    </div>
  );
}

/** Nothing for the first moments, then the bones of the screen this launch most likely opens on. */
export function LaunchSkeleton({ hint }: { hint: LaunchHint }) {
  const { t } = useLingui();
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setShown(true), LAUNCH_BONES_AFTER_MS);
    return () => clearTimeout(timer);
  }, []);
  return (
    <div data-slot="launch-skeleton" aria-busy="true" className="h-full">
      <span className="sr-only" role="status">
        {shown ? t`Loading` : ''}
      </span>
      {shown ? hint === 'app' ? <AppBones /> : <SetupBones /> : null}
    </div>
  );
}
