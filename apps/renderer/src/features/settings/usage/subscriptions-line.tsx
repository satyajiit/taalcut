// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: Usage › Subscriptions · genre: atmospheric studio app (chrome modern-minimal)
 *   · system: DESIGN.md v0.6 + UX4 (PageSection, SettingRow)
 * a plan's own quota isn't readable by apps, so each signed-in plan is one setting row: "Using ChatGPT plan" with
 *   OpenAI's Manage usage link (PRD 8.3, OpenAI's exact words), and each warned subscription the same way, with its
 *   service's usage page when main knows one (round P3-3), else saying its usage is on its own site. Every link
 *   opens in the browser through main (BrowserLink). Only when something is signed in.
 * states: default · hover/focus (the link's underline and the base ring) · active/disabled/loading (n/a)
 *   · error (nothing: the section stays out) · success (the rows) · empty (no section)
 */
import { Trans, useLingui } from '@lingui/react/macro';
import { CONCEPT_ICONS, Glyph, PageSection } from '@taalcut/ui';
import { useBackend } from '../../../backend/backend';
import { useRpcStream } from '../../../backend/use-rpc';
import { MANAGE_USAGE, USING_PLAN } from '../accounts/sign-ins';
import { SUBSCRIPTION_NAMES } from '../providers';
import { BrowserLink } from '../../../chat/external-link';
import { SettingRow, SettingRows } from '../rows';
import { SETTINGS_ICONS } from '../settings-icons';

export function SubscriptionsLine() {
  const { t, i18n } = useLingui();
  const backend = useBackend();
  const accounts = useRpcStream((signal) => backend.accounts.changed(undefined, { signal }), [backend]);
  const state = accounts.data;
  if (!state) return null;
  const plans = state.subscriptions.filter((sub) => sub.signedIn);
  if (!state.chatgpt.signedIn && plans.length === 0) return null;
  // Signed in: the success glyph with the words, in the glyph column every setting row keeps.
  const signedIn = (
    <span className="flex size-8 items-center justify-center">
      <Glyph icon={CONCEPT_ICONS.success} className="text-success-strong" />
    </span>
  );
  return (
    <PageSection
      title={<Trans>Subscriptions</Trans>}
      icon={SETTINGS_ICONS.subscriptions}
      description={
        <Trans>A plan’s own limit isn’t shared with other apps. Each service shows it on its site.</Trans>
      }
    >
      <SettingRows aria-label={t`Plans you signed in with`}>
        {state.chatgpt.signedIn ? (
          <SettingRow
            icon={signedIn}
            title={i18n._(USING_PLAN)}
            control={<BrowserLink href={state.chatgpt.manageUsageUrl}>{i18n._(MANAGE_USAGE)}</BrowserLink>}
          />
        ) : null}
        {plans.map((plan) => {
          const known = SUBSCRIPTION_NAMES[plan.provider];
          const name = known ? i18n._(known) : plan.provider;
          return (
            <SettingRow
              key={plan.provider}
              icon={signedIn}
              title={<Trans>Using your {name} plan</Trans>}
              {...(plan.usageUrl ? {} : { description: <Trans>Its usage is on {name}’s own site.</Trans> })}
              control={
                plan.usageUrl ? (
                  <BrowserLink href={plan.usageUrl}>
                    <Trans>Usage on {name}’s site</Trans>
                  </BrowserLink>
                ) : null
              }
            />
          );
        })}
      </SettingRows>
    </PageSection>
  );
}
