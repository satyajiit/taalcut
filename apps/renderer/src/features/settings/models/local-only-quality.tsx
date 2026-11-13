// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · pre-emit critique: P4 H4 E4 S4 R5 V4
 * Hallmark · component: models, Local only's effect · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.3 · an info notice at the top of Settings › Models while Local only is on (P3-B10, G27):
 *   one sentence, then each job it changes as its quality chip (simpler: neutral; off: warning), and the way to
 *   change it (Privacy, where the switch lives). Nothing when Local only is off or changes nothing.
 * states: n/a (status text and one link: default · hover (underline) · focus (base ring) · active)
 */
import { Trans, useLingui } from '@lingui/react/macro';
import type { ModuleQuality } from '@taalcut/core';
import { VERB_ICONS } from '@taalcut/ui';
import { Link } from '@tanstack/react-router';
import { Notice } from '../fields';
import { changedJobs, QualityChip } from '../privacy/quality-labels';

export function LocalOnlyQuality({ quality }: { quality: readonly ModuleQuality[] }) {
  const { t } = useLingui();
  const changed = changedJobs(quality);
  if (changed.length === 0) return null;
  return (
    <Notice
      tone="info"
      role="status"
      action={
        <Link
          to="/settings/privacy"
          className="inline-flex items-center gap-1 rounded-sm type-label-sm text-primary-strong underline-offset-4 hover:underline active:text-ink-2"
        >
          <Trans>Local only in Privacy</Trans>
          <VERB_ICONS.next aria-hidden className="size-3.5" />
        </Link>
      }
    >
      <span className="flex flex-col gap-2.5">
        <span>
          <Trans>Local only is on, so these jobs work differently on this Mac:</Trans>
        </span>
        <span role="list" aria-label={t`What Local only changes`} className="flex flex-wrap gap-1.5">
          {changed.map((each) => (
            <span role="listitem" key={each.module}>
              <QualityChip quality={each} />
            </span>
          ))}
        </span>
      </span>
    </Notice>
  );
}
