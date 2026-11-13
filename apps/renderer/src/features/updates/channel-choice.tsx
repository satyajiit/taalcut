// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · pre-emit critique: P4 H4 E4 S4 R5 V4
 * Hallmark · component: update channel choice · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.6 + UX4 · its own section on Settings › General › Updates: two choice rows in one raised list,
 *   Stable and Beta, each with one line on what it means (the kit's Radio: arrows move and choose, the words are the
 *   hit area). Beta asks for the beta terms first: the three plain lines open under its row (Collapse) with Agree
 *   and switch to Beta (the screen's one marigold fill) and Cancel. Moving back to Stable says the app stays on its
 *   beta until a newer stable ships. A team build shows its channel as a fact, not a choice.
 * states: default · hover · focus (the radio's ring) · active · checked (selected wash) · disabled (while a switch
 *   runs) · loading (the chosen row spins; Agree spins) · error (the cause under the list) · success (a polite
 *   announcement; the radios show the new channel)
 * parts: channel-parts.tsx (a row, the beta terms step, a team build), use-channel-switch.ts (what choosing does)
 * contrast: pass (ink and ink-2 on raised and on selected)
 */
import { Trans, useLingui } from '@lingui/react/macro';
import type { PublicUpdateChannel, UpdateState } from '@taalcut/core';
import { PageSection } from '@taalcut/ui';
import { SETTINGS_ICONS } from '../settings/settings-icons';
import { ChoiceRows } from '../settings/radio-row';
import { ChannelRow, TeamChannel } from './channel-parts';
import { UpdateErrorLine } from './update-error-line';
import { isPrerelease } from './update-words';
import { useChannelSwitch } from './use-channel-switch';

const CHANNELS: readonly PublicUpdateChannel[] = ['stable', 'beta'];

/** Settings › General › Updates' channel: Stable or Beta on a public build (updates.setChannel, person-only, undoable). */
export function ChannelChoice({ state }: { state: UpdateState }) {
  const { t } = useLingui();
  const choice = useChannelSwitch(state);

  if (state.channel === null) return null;
  if (state.channel === 'internal' || state.channel === 'alpha')
    return (
      <PageSection title={<Trans>Which updates you get</Trans>} icon={SETTINGS_ICONS.updates}>
        <TeamChannel channel={state.channel} />
      </PageSection>
    );

  const stayingOnBeta = choice.current === 'stable' && isPrerelease(state.version);
  const version = state.version;
  return (
    <PageSection title={<Trans>Which updates you get</Trans>} icon={SETTINGS_ICONS.updates}>
      <ChoiceRows
        aria-label={t`Update channel`}
        loading={choice.pending !== null}
        value={choice.shown ?? undefined}
        onValueChange={(next) => {
          const channel = CHANNELS.find((option) => option === next);
          if (channel) choice.choose(channel);
        }}
      >
        {CHANNELS.map((channel) => (
          <ChannelRow
            key={channel}
            channel={channel}
            pending={choice.pending}
            askingTerms={choice.askingTerms}
            onAgree={() => void choice.agree()}
            onCancel={choice.cancelTerms}
          />
        ))}
      </ChoiceRows>
      {stayingOnBeta ? (
        <p className="m-0 max-w-prose type-body text-ink-2">
          <Trans>
            Taalcut stays on <span translate="no">{version}</span> until a stable version newer than it comes
            out. Nothing is uninstalled.
          </Trans>
        </p>
      ) : null}
      {choice.failed ? <UpdateErrorLine error={choice.failed} /> : null}
      <p aria-live="polite" className="sr-only">
        {choice.announcement}
      </p>
    </PageSection>
  );
}
