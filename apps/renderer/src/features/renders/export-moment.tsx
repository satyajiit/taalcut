// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Impeccable · Operate (a brand moment) · component: an export's end, with Kaatu (UX4) · system: DESIGN.md v0.6 +
 *   UX4 (KaatuMoment)
 * the moment an export ends, said once with Kaatu beside one line, never over the poster or any footage: finished
 *   (Kaatu grins; "<name> is ready to post."; Show in Finder, then Make another, which starts the next video in a
 *   chat) or failed (Kaatu looks bashful; "<name> didn't finish." and its cause, read out as an alert; Try again).
 *   REF1: when the cause is that the template no longer keeps its reel, the action is "Get the reel's video and
 *   music" (templates.fetchMedia), then the page's Try again (Exports exports again; the dialog starts over); a
 *   failed fetch adds its own cause
 *   Exports shows it for an export that ends while you watch; the export dialog shows it when the one it follows
 *   ends. One moment on a screen, and a dismiss where the page keeps it
 * states: success · failure · failure for a reel no longer kept (getting it: the button spins; it failed: the cause)
 *   · the buttons' own (default, hover, focus, active, loading while Finder answers)
 */
import { Trans, useLingui } from '@lingui/react/macro';
import { callRpc, type RenderSnapshot, type TaalcutError } from '@taalcut/core';
import { Button, errorMessage, KaatuMoment, UserContent, VERB_ICONS } from '@taalcut/ui';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useBackend } from '../../backend/backend';
import { reelToFetch } from './reel-to-fetch';

export interface ExportMomentProps {
  /** The export that ended: ready, or failed. */
  render: Pick<RenderSnapshot, 'name' | 'status' | 'error'>;
  onReveal: () => void | Promise<unknown>;
  onRetry: () => void | Promise<unknown>;
  /** Where the page keeps the moment until it is put away (Exports). */
  onDismiss?: () => void;
  /** "Make another" leaves for a chat; a dialog closes first. */
  onLeave?: () => void;
  className?: string;
}

export function ExportMoment({
  render,
  onReveal,
  onRetry,
  onDismiss,
  onLeave,
  className,
}: ExportMomentProps) {
  const { t, i18n } = useLingui();
  const backend = useBackend();
  const [busy, setBusy] = useState<'reveal' | 'retry' | 'reel' | null>(null);
  const [fetchFailed, setFetchFailed] = useState<TaalcutError | null>(null);
  const reel = reelToFetch(render.error);
  const press = async (key: 'reveal' | 'retry' | 'reel', run: () => void | Promise<unknown>) => {
    setBusy(key);
    try {
      await run();
    } finally {
      setBusy(null);
    }
  };
  const name = <UserContent translate="no">{render.name}</UserContent>;
  const dismiss = onDismiss ? { onDismiss } : {};
  // The reel first, then the same export again.
  const getReel = async () => {
    if (!reel) return;
    const got = await callRpc(backend.templates.fetchMedia({ id: reel }));
    setFetchFailed(got.ok ? null : got.error);
    if (got.ok) await onRetry();
  };
  if (render.status === 'failed')
    return (
      <KaatuMoment
        tone="failure"
        className={className}
        action={
          reel ? (
            <Button
              size="sm"
              icon={VERB_ICONS.download}
              loading={busy === 'reel'}
              onClick={() => void press('reel', getReel)}
              data-slot="export-get-reel"
            >
              {busy === 'reel' ? t`Getting the reel’s video and music` : t`Get the reel’s video and music`}
            </Button>
          ) : (
            <Button
              size="sm"
              icon={VERB_ICONS.retry}
              loading={busy === 'retry'}
              onClick={() => void press('retry', onRetry)}
            >
              {t`Try again`}
            </Button>
          )
        }
        {...dismiss}
      >
        <Trans>{name} didn’t finish.</Trans>{' '}
        {render.error ? errorMessage(i18n, render.error) : t`No reason came back. Export it again.`}
        {fetchFailed ? ` ${errorMessage(i18n, fetchFailed)}` : null}
      </KaatuMoment>
    );
  return (
    <KaatuMoment
      tone="success"
      className={className}
      action={
        <span className="flex shrink-0 flex-wrap items-center gap-2">
          <Button
            size="sm"
            icon={VERB_ICONS.reveal}
            loading={busy === 'reveal'}
            onClick={() => void press('reveal', onReveal)}
          >
            {t`Show in Finder`}
          </Button>
          <Button asChild size="sm" variant="ghost" icon={VERB_ICONS.makeVideo}>
            <Link to="/chat" onClick={onLeave}>
              {t`Make another`}
            </Link>
          </Button>
        </span>
      }
      {...dismiss}
    >
      <Trans>{name} is ready to post.</Trans>
    </KaatuMoment>
  );
}
