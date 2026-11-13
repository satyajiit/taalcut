// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · pre-emit critique: P4 H4 E4 S4 R5 V4
 * Hallmark · component: the update dialog · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.3 · the kit's dialog (overlay surface, 2xl radius, scrim, its enter fade): "Taalcut 0.3.0 is
 *   ready", when it came out (Intl), What's new as the release's own text in a sunken scroll well (never a card in
 *   the dialog), then Later (secondary)
 *   and Restart now (the dialog's one marigold fill). Nothing opens it by itself mid-task: About, the sidebar item,
 *   or the next launch after a Later.
 * states: default · hover/focus/active (Button; Restart now takes focus on open) · disabled (Later while
 *   restarting) · loading (Restart now spins: main is quitting) · error (main refused: the cause above the
 *   buttons, UpdateErrorLine) · success (the app quits; nothing to show) · no notes ("This update came without notes.")
 * contrast: pass (kit tokens: ink-2 on overlay 7:1, primary-ink on primary)
 */
import { Trans, useLingui } from '@lingui/react/macro';
import type { TaalcutError } from '@taalcut/core';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@taalcut/ui';
import { useId, useRef, useState } from 'react';
import { ReleaseNotes } from './release-notes';
import { closeUpdateDialog, takeReturnFocus, useUpdateDialogOpen } from './update-dialog-state';
import { UpdateErrorLine } from './update-error-line';
import { rememberLater } from './update-later';
import { useInstallNow, type ReadyUpdate } from './use-updates';

/** The staged update's dialog: release notes, Restart now and Later. The root mounts one (UpdateHost). */
export function UpdateDialog({ ready }: { ready: ReadyUpdate | null }) {
  const open = useUpdateDialogOpen();
  const close = (later: boolean) => {
    if (later && ready) rememberLater(ready.version);
    closeUpdateDialog();
  };
  return (
    <Dialog open={open && ready !== null} onOpenChange={(next) => (next ? undefined : close(true))}>
      {ready ? <ReadyContent ready={ready} onLater={() => close(true)} /> : null}
    </Dialog>
  );
}

function ReadyContent({ ready, onLater }: { ready: ReadyUpdate; onLater: () => void }) {
  const { t, i18n } = useLingui();
  const install = useInstallNow();
  const [failed, setFailed] = useState<TaalcutError | null>(null);
  const restart = useRef<HTMLButtonElement>(null);
  const notesHeading = useId();
  const version = ready.version;
  const released =
    ready.releaseDate === undefined ? null : i18n.date(new Date(ready.releaseDate), { dateStyle: 'long' });
  const notes = ready.notes?.trim() ?? '';

  const restartNow = async () => {
    setFailed(null);
    const result = await install.run();
    if (!result.ok) setFailed(result.error);
  };

  return (
    <DialogContent
      className="max-w-xl"
      onOpenAutoFocus={(event) => {
        event.preventDefault();
        restart.current?.focus();
      }}
      onCloseAutoFocus={(event) => {
        // Opened from a button, a menu or the launch: focus goes back where it was, never to the page's top.
        event.preventDefault();
        takeReturnFocus()?.focus();
      }}
    >
      <DialogHeader>
        <DialogTitle>
          <Trans>
            Taalcut <span translate="no">{version}</span> is ready
          </Trans>
        </DialogTitle>
        <DialogDescription>
          {released && ready.releaseDate !== undefined ? (
            <Trans>
              Released{' '}
              <time dateTime={new Date(ready.releaseDate).toISOString()} className="font-sans">
                {released}
              </time>
              . It installs when you restart Taalcut.
            </Trans>
          ) : (
            <Trans>It installs when you restart Taalcut.</Trans>
          )}
        </DialogDescription>
      </DialogHeader>
      <section aria-labelledby={notesHeading} className="flex min-h-0 flex-col gap-2">
        <h3 id={notesHeading} className="m-0 text-sm font-semibold text-ink">
          <Trans>What’s new</Trans>
        </h3>
        {notes ? (
          // A long release scrolls inside the dialog; the box is focusable so the keyboard can scroll it.
          <div
            role="region"
            tabIndex={0}
            aria-label={t`Release notes`}
            className="max-h-[min(50vh,22rem)] overflow-y-auto rounded-lg border border-rule-subtle bg-well px-4 py-3"
          >
            <ReleaseNotes notes={notes} className="flex flex-col gap-3" />
          </div>
        ) : (
          <p className="m-0 text-sm text-ink-3">
            <Trans>This update came without notes.</Trans>
          </p>
        )}
      </section>
      {failed ? <UpdateErrorLine error={failed} /> : null}
      <DialogFooter>
        <Button variant="secondary" disabled={install.pending} onClick={onLater}>
          <Trans>Later</Trans>
        </Button>
        <Button ref={restart} variant="primary" loading={install.pending} onClick={() => void restartNow()}>
          <Trans>Restart now</Trans>
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
