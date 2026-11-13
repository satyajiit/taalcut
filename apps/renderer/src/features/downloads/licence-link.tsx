// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: a part's licence link · genre: atmospheric studio app · system: DESIGN.md v0.5 (UX2)
 * UX2-DOWNLOADER round 3: every part on this Mac keeps its licence notice in its folder, verified against the
 *   manifest; Settings › Models' job rows and Settings › About's installed parts link it. A quiet text link at the
 *   end of the row's small line: ink-2 words on a rule-strong underline (reference, not the page's action: no
 *   marigold); "Licence" for one part, "Licences" with a chevron for a job of several, opening a menu of its parts
 *   with each one's SPDX id. Its name says whose ("Licence for whisper.cpp"): the word shows, screen readers read
 *   the whole phrase, the part's name in it kept out of translation. The notice opens in the Mac's text viewer,
 *   through main (files.openNotice): the window names the part, never a path.
 * states: default (ink-2, rule-strong underline) · hover (ink, ink underline) · focus (base ring, instant, rounded) ·
 *   active (ink-3 while pressed; a menu's trigger stays ink while its menu is open) · disabled n/a (only a part that is here has one) · loading (ink-3, the progress
 *   cursor, aria-busy, clicks ignored while main opens it) · error (danger-strong words and underline; the row's
 *   ErrorLine says why under it) · success (silent: the viewer comes forward, the error goes)
 * motion: colour only (--dur-micro, --ease-out); reduced motion: base.css
 * contrast: ink-2 on canvas or raised ≥ 7:1; ink-3 while loading ≥ 4.5:1; danger-strong ≥ 4.5:1
 * pre-emit critique: P5 H4 E4 S5 R5 V4 · slop subset: pass (1-7, 10-19, 22-27, 37-38a, 40-41 via axe, 46-49)
 */
import { Trans, useLingui } from '@lingui/react/macro';
import { callRpc, type Component, type TaalcutError } from '@taalcut/core';
import {
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  ErrorLine,
} from '@taalcut/ui';
import { ChevronDown } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import { useBackend } from '../../backend/backend';

const LINK_CLASS = cn(
  'inline-flex cursor-pointer items-center gap-0.5 rounded-sm text-xs font-medium whitespace-nowrap text-ink-2',
  'underline decoration-rule-strong underline-offset-2',
  'transition-[color,text-decoration-color] duration-(--dur-micro) ease-(--ease-out)',
  'hover:text-ink hover:decoration-ink active:text-ink-3 active:decoration-ink-3',
  // A menu's trigger while its menu is open (Radix's data-state).
  'data-[state=open]:text-ink data-[state=open]:decoration-ink',
  'data-[notice=loading]:cursor-progress data-[notice=loading]:text-ink-3',
  'data-[notice=error]:text-danger-strong data-[notice=error]:decoration-danger-strong',
);

/** Opens a row's licence notices: which one main is opening, and why the last one didn't open. */
export interface NoticeOpener {
  /** The part whose notice main is opening. */
  readonly opening: string | null;
  readonly error: TaalcutError | null;
  /** Counts the failures, so a new one's error line starts over. */
  readonly failures: number;
  open(componentId: string): void;
  /** Opens the last one asked for again (Try again on a retryable error). */
  retry(): void;
}

/** One per row: its link and its error line share it. */
export function useNoticeOpener(): NoticeOpener {
  const backend = useBackend();
  const [opening, setOpening] = useState<string | null>(null);
  const [error, setError] = useState<TaalcutError | null>(null);
  const [failures, setFailures] = useState(0);
  const last = useRef<string | null>(null);
  const open = useCallback(
    (componentId: string) => {
      last.current = componentId;
      setOpening(componentId);
      void callRpc(backend.files.openNotice({ componentId })).then((result) => {
        setOpening(null);
        setError(result.ok ? null : result.error);
        if (!result.ok) setFailures((count) => count + 1);
      });
    },
    [backend],
  );
  const retry = useCallback(() => {
    if (last.current) open(last.current);
  }, [open]);
  return { opening, error, failures, open, retry };
}

/** Why the notice didn't open, as one line under the row. */
export function NoticeError({ opener, className }: { opener: NoticeOpener; className?: string }) {
  if (!opener.error) return null;
  return (
    <ErrorLine key={opener.failures} error={opener.error} onRetry={opener.retry} className={className} />
  );
}

/** While main opens a notice, or after one didn't open (the row's ErrorLine says why). */
type LinkState = 'loading' | 'error' | undefined;

export interface LicenceLinkProps {
  /** The row's parts; only the ones whose notice is on this Mac are linked. */
  readonly parts: readonly Component[];
  /** The row's name ("Speech"): whose licences a menu of several lists. */
  readonly label: string;
  readonly opener: NoticeOpener;
}

/** "Licences" for a job of several parts here: a menu of them, each with its SPDX id. */
function LicenceMenu({
  here,
  label,
  opener,
  state,
}: {
  here: readonly Component[];
  label: string;
  opener: NoticeOpener;
  state: LinkState;
}) {
  const { t } = useLingui();
  return (
    // Not modal: the page stays as it is under the menu (no aria-hidden over it, WCAG 4.1.2), as other row menus.
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        data-slot="licence-link"
        data-notice={state}
        aria-busy={state === 'loading' || undefined}
        aria-label={t`Licences for ${label}`}
        className={LINK_CLASS}
      >
        <Trans>Licences</Trans>
        <ChevronDown aria-hidden className="size-3 shrink-0 text-ink-3" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-56">
        <DropdownMenuLabel>{label}</DropdownMenuLabel>
        {here.map((part) => (
          <DropdownMenuItem
            key={part.id}
            data-component={part.id}
            onSelect={() => {
              if (state !== 'loading') opener.open(part.id);
            }}
          >
            <span translate="no" className="min-w-0 flex-1 truncate">
              {part.name}
            </span>
            <span translate="no" className="text-xs text-ink-3">
              {part.licence}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** "Licence" for one part here, "Licences" and a menu of them for several; nothing while none is here. */
export function LicenceLink({ parts, label, opener }: LicenceLinkProps) {
  const here = parts.filter((part) => part.notice);
  const state: LinkState = opener.opening !== null ? 'loading' : opener.error ? 'error' : undefined;
  const only = here.length === 1 ? here[0] : undefined;
  if (here.length > 1) return <LicenceMenu here={here} label={label} opener={opener} state={state} />;
  if (!only) return null;
  const name = only.name;
  return (
    <button
      type="button"
      data-slot="licence-link"
      data-notice={state}
      aria-busy={state === 'loading' || undefined}
      className={LINK_CLASS}
      onClick={() => {
        if (state !== 'loading') opener.open(only.id);
      }}
    >
      {/* Whose: the word shows, the whole phrase is the name screen readers read (one message, so each language
          orders it its own way). The part's name is the manifest's, kept out of translation (translate="no"), so it
          is in this content, never in an aria-label. */}
      <span aria-hidden="true">
        <Trans>Licence</Trans>
      </span>
      <span className="sr-only">
        <Trans>
          Licence for <span translate="no">{name}</span>
        </Trans>
      </span>
    </button>
  );
}
