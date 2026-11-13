// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: unavailable fix line (P3-B8) · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.3 · a fix the agent couldn't offer, in one quiet line: what and why ("Stock video needs your
 *   Pexels key in Settings → Accounts"), and the settings page that clears it as a ghost link-button
 * states: default · the button's hover/active/focus-visible (the kit's Button) · disabled/loading/error/success: n/a
 *   (it only navigates)
 * pre-emit critique: P5 H5 E4 S5 R5 V4 */
import { useLingui } from '@lingui/react/macro';
import type { GapFixKind } from '@taalcut/core';
import { CircleSlash } from 'lucide-react';
import { Button } from '#components/button';
import type { GapFixReason } from './gap-types';
import { REASON_SETTINGS, reasonWords } from './gap-words';

export interface UnavailableLineProps {
  kind: GapFixKind;
  reason: GapFixReason;
  onSettings?: (section: 'accounts' | 'models' | 'privacy' | 'usage') => void;
}

export function UnavailableLine({ kind, reason, onSettings }: UnavailableLineProps) {
  const { t, i18n } = useLingui();
  const section = REASON_SETTINGS[reason];
  const labels = {
    accounts: t`Open Accounts`,
    models: t`Open Models`,
    privacy: t`Open Privacy`,
    usage: t`Open Usage`,
  };
  return (
    <p
      data-slot="gap-unavailable"
      data-kind={kind}
      data-reason={reason}
      className="m-0 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-2"
    >
      <CircleSlash aria-hidden className="size-4 shrink-0 text-ink-3" />
      <span className="min-w-0">{i18n._(reasonWords(kind, reason))}</span>
      {section && onSettings ? (
        <Button size="sm" variant="ghost" className="h-8 px-2" onClick={() => onSettings(section)}>
          {labels[section]}
        </Button>
      ) : null}
    </p>
  );
}
