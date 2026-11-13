// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · pre-emit critique: P4 H4 E4 S4 R5 V4
 * Hallmark · page: Settings › General › Updates (UX4: its own page, out of About) · genre: atmospheric studio app
 *   (chrome modern-minimal) · system: DESIGN.md v0.6 + UX4
 * the page's line says what updates do; then the rollback notice when the last update went back (info tone, one
 *   plain sentence, Send a report while crash reports are on), the status row in a raised hairline frame, then the
 *   channel choice as its own section. No motion of its own beyond the channel's terms (Collapse).
 * states: loading (the named skeleton of the status row) · error (LoadError, Try again) · off · up to date · checking · downloading · ready ·
 *   update error · rolled back · team build · public build (Stable or Beta)
 */
import { Trans, useLingui } from '@lingui/react/macro';
import { Button, Skeleton } from '@taalcut/ui';
import { useBackend } from '../../backend/backend';
import { useRpcStream } from '../../backend/use-rpc';
import { openFeedback } from '../feedback/feedback-state';
import { BoneRows, type BoneRowShape } from '../settings/bones';
import { LoadError, Notice } from '../settings/fields';
import { GeneralViews } from '../settings/general/general-views';
import { SettingsPage } from '../settings/settings-page';
import { ChannelChoice } from './channel-choice';
import { UpdateStatus } from './update-status';
import { useUpdateState } from './use-updates';

const UPDATE_BONES: readonly BoneRowShape[] = [
  { title: '26%', lines: ['40%'], control: 'button', icon: true },
];

/** The anchor a link to the status can name (it is the top of the page now). */
export const UPDATES_ANCHOR = 'updates';

function RollbackNotice({ from, to }: { from: string; to: string }) {
  const backend = useBackend();
  const privacy = useRpcStream((signal) => backend.privacy.changed(undefined, { signal }), [backend]);
  // A report needs crash reports on, and Local only off (it pauses them).
  const canReport = privacy.data?.switches.crashReports === true && privacy.data.localOnly === false;
  return (
    <Notice
      tone="info"
      role="status"
      action={
        canReport ? (
          <Button size="sm" variant="secondary" onClick={() => openFeedback()}>
            <Trans>Send a report</Trans>
          </Button>
        ) : undefined
      }
    >
      <span>
        <Trans>
          The update to <span translate="no">{to}</span> didn’t start, so Taalcut went back to{' '}
          <span translate="no">{from}</span>. Nothing was lost.
        </Trans>
      </span>
    </Notice>
  );
}

/** Settings › General › Updates (P3-B9, P3-B14): what the updater is doing, and Stable or Beta. */
export function UpdatesSettings() {
  const { t } = useLingui();
  const state = useUpdateState();
  const data = state.data;
  return (
    <SettingsPage
      title={t`General`}
      detail={t`Updates`}
      views={<GeneralViews current="updates" />}
      description={
        <Trans>
          Taalcut downloads updates in the background and installs them when you restart. Nothing interrupts
          your work.
        </Trans>
      }
    >
      <div id={UPDATES_ANCHOR} className="flex scroll-mt-24 flex-col gap-4">
        {!data && state.status === 'error' ? (
          <LoadError error={state.error} what={<Trans>Updates didn’t load.</Trans>} />
        ) : null}
        <Skeleton
          name="settings-updates"
          loading={!data && state.status !== 'error'}
          fixture={<BoneRows rows={UPDATE_BONES} />}
        >
          {data ? (
            <div className="flex flex-col gap-4">
              {data.lastRollback ? (
                <RollbackNotice from={data.lastRollback.from} to={data.lastRollback.to} />
              ) : null}
              <div
                data-slot="update-status"
                data-status={data.status.kind}
                className="overflow-hidden rounded-lg border border-rule-subtle bg-raised"
              >
                <UpdateStatus state={data} />
              </div>
            </div>
          ) : null}
        </Skeleton>
      </div>
      {data ? <ChannelChoice state={data} /> : null}
    </SettingsPage>
  );
}
