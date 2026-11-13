// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: retirement-notices · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.2 · a warning line (icon + sentence + one fix), no yellow box
 * states: default · hover · focus · active · disabled (busy)
 */
import { msg } from '@lingui/core/macro';
import { Plural, Trans, useLingui } from '@lingui/react/macro';
import { Button } from '@taalcut/ui';
import type { ModelChoice, ModelSettings, RetirementNotice } from '@taalcut/core';
import { formatIsoDate } from '../../shared/format';
import { Notice } from '../fields';
import { translateKey } from '../model-messages';
import { choiceKey, modelName, type OptionsByModule } from './model-options';

const JOB = msg`this job`;

/**
 * The deprecation watcher's notices (PRD 8.4): a model the user relies on is
 * about to stop working, or has. One fix: switch to the replacement now.
 */
export function RetirementNotices({
  settings,
  options,
  busy,
  onSwitch,
}: {
  settings: ModelSettings;
  options: OptionsByModule | undefined;
  busy: boolean;
  onSwitch: (notice: RetirementNotice, replacement: ModelChoice) => void;
}) {
  const { i18n } = useLingui();
  const seen = new Set<string>();
  const notices = settings.retirements.filter((n) => {
    const key = `${n.module}:${choiceKey(n.choice)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (notices.length === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      {notices.map((notice) => {
        const labelKey = settings.modules.find((m) => m.module === notice.module)?.labelKey ?? '';
        const job = translateKey(i18n, labelKey, JOB);
        const model = modelName(options, notice.choice);
        const replacement = notice.replacement ? modelName(options, notice.replacement) : null;
        const date = formatIsoDate(i18n, notice.retiresOn);
        const days = notice.daysLeft;
        const retired = days <= 0;
        return (
          <Notice
            key={`${notice.module}:${choiceKey(notice.choice)}`}
            tone="warning"
            action={
              notice.replacement && !retired ? (
                <Button size="sm" disabled={busy} onClick={() => onSwitch(notice, notice.replacement!)}>
                  <Trans>Switch now</Trans>
                </Button>
              ) : undefined
            }
          >
            <p className="m-0 font-medium">
              {retired ? (
                <Trans>
                  <span translate="no">{model}</span> stopped working on{' '}
                  <time dateTime={notice.retiresOn} className="font-sans">
                    {date}
                  </time>
                  .
                </Trans>
              ) : (
                <Trans>
                  <span translate="no">{model}</span> stops working on{' '}
                  <time dateTime={notice.retiresOn} className="font-sans">
                    {date}
                  </time>{' '}
                  (<Plural value={days} one="in # day" other="in # days" />
                  ).
                </Trans>
              )}
            </p>
            <p className="m-0 text-ink-2">
              {replacement ? (
                retired ? (
                  <Trans>
                    “{job}” now uses <span translate="no">{replacement}</span> instead.
                  </Trans>
                ) : (
                  <Trans>
                    Taalcut moves “{job}” to <span translate="no">{replacement}</span> a week before. Switch
                    now to try it first.
                  </Trans>
                )
              ) : (
                <Trans>Choose another model for “{job}” under Advanced.</Trans>
              )}
            </p>
          </Notice>
        );
      })}
    </div>
  );
}
