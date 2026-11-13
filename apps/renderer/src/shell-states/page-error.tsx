// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · pre-emit critique: P5 H5 E4 S5 R5 V4
 * Hallmark · component: page error (a page that failed, inside the shell) · genre: atmospheric studio app (chrome
 * modern-minimal) · system: DESIGN.md v0.3 "Message pages" + v0.4 (UX1: errors stay in the page) · the message
 * pages' one implementation (shell/plain-message.tsx, UX4) on the page's column: Kaatu (80 px, bashful, then
 * idle), a heading, one sentence that names the cause, and the way on as words: the fix (Reload the page, or the
 * error's own), Go back (with no history, back to the page's own area: B23), and Report this for a bug. The window bar, the sidebar and ⌘K stay: only this page failed.
 * states (each action, a button set as a link): default (underlined; the fix in primary-strong, the others ink-2)
 *   · hover (thicker underline, ink) · focus (base ring, instant) · active (pressed: ink) · disabled (n/a: each is
 *   always possible) · loading (Reload: aria-busy while the page loads again) · error (a reload that fails lands
 *   here again, with the new cause) · success (the page shows) */
import { Trans, useLingui } from '@lingui/react/macro';
import { errorMessage, fixLabel, fixOn, useHostPlatform } from '@taalcut/ui';
import { useRouter, useRouterState, type ErrorComponentProps } from '@tanstack/react-router';
import { useEffect, useId, useState } from 'react';
import { fixCommand } from '../backend/fix-command';
import { useCommand } from '../backend/use-command';
import { openFeedback } from '../features/feedback/feedback-state';
import { PlainMessage } from '../shell/plain-message';
import { useAreaWayOn } from './area-way-on';
import { pageErrorCause, type PageErrorCause } from './page-error-cause';
import { pagePlace } from './page-place';

const LINK =
  'cursor-pointer text-md font-medium underline decoration-1 underline-offset-4 hover:decoration-2 aria-busy:cursor-progress';
const FIX = `${LINK} text-primary-strong`;
const QUIET = `${LINK} text-ink-2 hover:text-ink active:text-ink`;

function useWords(cause: PageErrorCause) {
  const { t, i18n } = useLingui();
  switch (cause.kind) {
    case 'code':
      return {
        title: t`Part of this page didn’t load`,
        sentence: t`Taalcut couldn’t read this page’s code. Reload the page to fetch it again. Your work is saved.`,
      };
    case 'known':
      return { title: t`This page didn’t load`, sentence: errorMessage(i18n, cause.error) };
    case 'bug':
      return {
        title: t`This page hit a bug`,
        sentence: t`Something in Taalcut went wrong while showing it. Your work is saved. Reload the page, or go back.`,
      };
  }
}

/**
 * A page that failed while loading or showing (the router's defaultErrorComponent, so every page has its own
 * boundary): the message takes the page's place and nothing else moves. Names the cause and offers Reload and
 * Back; a bug can be reported with its code. The error goes to the console for developers, never on screen.
 */
export function PageError({ error, reset }: ErrorComponentProps) {
  const { t, i18n } = useLingui();
  const router = useRouter();
  const command = useCommand();
  const headingId = useId();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const [reloading, setReloading] = useState(false);
  const cause = pageErrorCause(error);
  const words = useWords(cause);
  const place = pagePlace(pathname);
  const platform = useHostPlatform();
  const fix = cause.kind === 'known' ? fixOn(cause.error.fix, platform) : undefined;
  // With no history to go back to, the way on is the page's own area (B23), else the chat.
  const home = useAreaWayOn();
  useEffect(() => console.error(error), [error]);

  const reload = async () => {
    // Missing code comes back only with the window's own reload; anything else, the page loads again in place.
    if (cause.kind === 'code') return window.location.reload();
    setReloading(true);
    reset();
    await router.invalidate();
    setReloading(false);
  };
  const back = () => {
    if (router.history.canGoBack()) router.history.back();
    else void router.navigate({ to: home.to });
  };

  return (
    // The message pages' one implementation (shell/plain-message.tsx), in the page's place on its column.
    <PlainMessage
      inShell
      alert
      headingId={headingId}
      section={{ 'data-slot': 'page-error', 'data-cause': cause.kind, 'data-error-code': cause.error.code }}
      // The page's own heading says what happened; the bar keeps saying where you are.
      {...(place.title ? { name: i18n._(place.title) } : {})}
      title={words.title}
      sentence={words.sentence}
      link={
        <>
          {fix ? (
            <button
              type="button"
              className={FIX}
              aria-busy={command.pending || undefined}
              onClick={() => void command.run(fixCommand(fix))}
            >
              {fixLabel(i18n, fix)}
            </button>
          ) : (
            <button
              type="button"
              className={FIX}
              aria-busy={reloading || undefined}
              onClick={() => void reload()}
            >
              <Trans>Reload the page</Trans>
            </button>
          )}
          {fix ? (
            <button type="button" className={QUIET} onClick={() => void reload()}>
              <Trans>Reload the page</Trans>
            </button>
          ) : null}
          <button type="button" className={QUIET} onClick={back}>
            {router.history.canGoBack() ? t`Go back` : home.label}
          </button>
          {cause.kind === 'bug' ? (
            <button type="button" className={QUIET} onClick={() => openFeedback(cause.error)}>
              <Trans>Report this</Trans>
            </button>
          ) : null}
        </>
      }
    />
  );
}
