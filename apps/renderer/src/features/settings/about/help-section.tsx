// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · pre-emit critique: P4 H4 E4 S4 R5 V4
 * Hallmark · component: settings, feedback and setup · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.6 + UX4 · three SettingRows on About (P3-B14, P3-B3): Send feedback (the P2-X7 dialog;
 *   on the beta it says notes shape what comes next), crash reports as a fact with "Change in Privacy" (the
 *   switch lives in one place, Privacy › Help improve Taalcut), and Run setup again (onboarding.reset, then first
 *   run). Secondary buttons only: About's one marigold fill belongs to the beta terms when they open.
 * states: default · hover/focus/active (Button, the link's underline) · disabled (Run setup again while it runs)
 *   · loading (Run setup again spins) · error (the cause under the list) · success (first run opens; the reset is
 *   undoable with ⌘Z like any command) · Local only (crash reports "paused", said why)
 */
import { Trans, useLingui } from '@lingui/react/macro';
import { ONBOARDING_COMMANDS, type TaalcutError } from '@taalcut/core';
import { Button, ErrorLine, PageSection, VERB_ICONS } from '@taalcut/ui';
import { Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useBackend } from '../../../backend/backend';
import { useCommand } from '../../../backend/use-command';
import { useRpcStream } from '../../../backend/use-rpc';
import { openFeedback } from '../../feedback/feedback-state';
import { useUpdateState } from '../../updates/use-updates';
import { HELP_IMPROVE_ANCHOR } from '../privacy/help-improve';
import { SettingRow, SettingRows } from '../rows';
import { SETTINGS_ICONS } from '../settings-icons';

function CrashReportsFact() {
  const backend = useBackend();
  const privacy = useRpcStream((signal) => backend.privacy.changed(undefined, { signal }), [backend]);
  const data = privacy.data;
  if (!data) return <Trans>Crash reports are set in Privacy.</Trans>;
  if (data.switches.crashReports && data.localOnly)
    return <Trans>Crash reports are on, and paused while Local only is on.</Trans>;
  return data.switches.crashReports ? (
    <Trans>
      Crash reports are on: when Taalcut crashes, the error and where in the code, with paths and names
      removed. Never a memory dump or your media.
    </Trans>
  ) : (
    <Trans>Crash reports are off. Nothing is sent when Taalcut crashes.</Trans>
  );
}

/** Settings › General › About › Feedback and setup (P3-B14's in-app feedback and crash-report opt-in, P3-B3's re-run). */
export function HelpSection() {
  const { t } = useLingui();
  const navigate = useNavigate();
  const command = useCommand({ toast: false });
  const updates = useUpdateState();
  const [failed, setFailed] = useState<TaalcutError | null>(null);
  const beta = updates.data?.channel === 'beta' || updates.data?.choice === 'beta';
  const alpha = updates.data?.channel === 'alpha';

  const runSetupAgain = async () => {
    setFailed(null);
    const result = await command.run({ name: ONBOARDING_COMMANDS.reset, payload: {} });
    if (!result.ok) return setFailed(result.error);
    await navigate({ to: '/onboarding' });
  };

  return (
    <PageSection
      title={<Trans>Feedback and setup</Trans>}
      icon={SETTINGS_ICONS.feedback}
      description={<Trans>Tell us what broke, choose what you share, or go through first run again.</Trans>}
    >
      <SettingRows aria-label={t`Feedback and setup`}>
        <SettingRow
          title={<Trans>Send feedback</Trans>}
          description={
            beta || alpha ? (
              <Trans>
                You’re on an early version, so your notes shape what comes next. A debug bundle goes with them
                only if you add one.
              </Trans>
            ) : (
              <Trans>
                Tell us what broke or what you’d like. A debug bundle goes with it only if you add one.
              </Trans>
            )
          }
          control={
            <Button
              size="sm"
              variant="secondary"
              icon={SETTINGS_ICONS.feedback}
              onClick={() => openFeedback()}
            >
              <Trans>Send feedback…</Trans>
            </Button>
          }
        />
        <SettingRow
          title={<Trans>Crash reports</Trans>}
          description={<CrashReportsFact />}
          control={
            <Link
              to="/settings/privacy/sharing"
              hash={HELP_IMPROVE_ANCHOR}
              className="inline-flex items-center gap-1 rounded-sm type-label-sm text-primary-strong underline-offset-4 hover:underline active:text-ink-2"
            >
              <Trans>Change in Privacy</Trans>
              <VERB_ICONS.next aria-hidden className="size-3.5" />
            </Link>
          }
        />
        <SettingRow
          title={<Trans>Run setup again</Trans>}
          description={
            <Trans>
              First run again: how Taalcut thinks, this Mac, your videos. Your projects, clips and settings
              stay as they are.
            </Trans>
          }
          control={
            <Button
              size="sm"
              variant="secondary"
              icon={VERB_ICONS.retry}
              loading={command.pending}
              onClick={() => void runSetupAgain()}
            >
              <Trans>Run setup again</Trans>
            </Button>
          }
        />
      </SettingRows>
      {failed ? <ErrorLine error={failed} /> : null}
    </PageSection>
  );
}
