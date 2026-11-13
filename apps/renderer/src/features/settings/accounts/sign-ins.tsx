// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: sign-ins (UX4) · genre: atmospheric studio app (chrome modern-minimal) · system: DESIGN.md
 *   v0.6 + UX4 (_orch/ux4/specs/design-set.md "One row")
 * Accounts › Subscriptions: ChatGPT first (the screen's one marigold fill), then the plans behind the kit's
 *   WarningCard; every plan is one SettingRow (the provider's mark, the plan's name, its state as a chip, its one
 *   action), its warning card opening under it with the kit's Collapse. First run lists the same rows, each in a
 *   frame of its own (SubscriptionRow without `inList`).
 * states: default · hover/focus/active (the buttons') · disabled (another call on its way) · loading (the pressed
 *   button spins; ChatGPT waits on the browser with a polite line) · success (Signed in, its chip; the frame's
 *   polite line) · error (the frame's notice)
 */
import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
import type { AccountsState, WarnedLogin } from '@taalcut/core';
import {
  Button,
  Chip,
  Collapse,
  PageSection,
  ProviderLogo,
  VERB_ICONS,
  cn,
  useAcknowledgement,
} from '@taalcut/ui';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { BrowserLink } from '../../../chat/external-link';
import { useServices } from '../../../services/provider';
import { SUBSCRIPTION_NAMES } from '../providers';
import { SettingRow, SettingRows } from '../rows';
import { SETTINGS_ICONS } from '../settings-icons';
import { RiskWarning } from './risk-warning';
import { ChatGptImagesRow } from './chatgpt-images-row';

// OpenAI's Sign in with ChatGPT guidelines fix these three phrases (PRD 8.3); first run uses them too.
export const CONTINUE = msg({
  message: 'Continue with ChatGPT',
  comment: 'OpenAI’s required button text. Use OpenAI’s own translation for this language, word for word.',
});
export const USING_PLAN = msg({
  message: 'Using ChatGPT plan',
  comment: 'OpenAI’s required status text. Use OpenAI’s own translation for this language, word for word.',
});
export const MANAGE_USAGE = msg({
  message: 'Manage usage',
  comment: 'OpenAI’s required link text. Use OpenAI’s own translation for this language, word for word.',
});

export interface SignInActions {
  signIn(provider: string, acknowledgedAt?: number): Promise<void>;
  signOut(provider: string): Promise<void>;
  pending: string | null;
}

/** A provider's mark in a row's leading slot, on the same 32 px column as the registry's glyphs. */
export function ProviderMark({ provider }: { provider: string }) {
  return (
    <span className="flex size-8 shrink-0 items-center justify-center">
      <ProviderLogo provider={provider} size="md" />
    </span>
  );
}

/** The ChatGPT plan as one row: Continue with ChatGPT, or Using ChatGPT plan with Manage usage and Sign out. */
export function ChatGptRow({ state, actions }: { state: AccountsState; actions: SignInActions }) {
  const { i18n } = useLingui();
  const busy = actions.pending === 'openai-codex';
  const signedIn = state.chatgpt.signedIn;
  return (
    <SettingRow
      data-provider="openai-codex"
      icon={<ProviderMark provider="openai-codex" />}
      title={<Trans>ChatGPT Plus, Pro &amp; Team</Trans>}
      description={
        signedIn ? (
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="text-ink">{i18n._(USING_PLAN)}</span>
            <BrowserLink href={state.chatgpt.manageUsageUrl}>{i18n._(MANAGE_USAGE)}</BrowserLink>
          </span>
        ) : busy ? (
          <span role="status">
            <Trans>Finish signing in in your browser, then come back.</Trans>
          </span>
        ) : (
          <Trans>Included with your existing OpenAI subscription.</Trans>
        )
      }
      status={
        signedIn ? (
          <Chip tone="success">
            <Trans>Signed in</Trans>
          </Chip>
        ) : null
      }
      control={
        signedIn ? (
          <Button
            variant="ghost"
            size="sm"
            icon={VERB_ICONS.signOut}
            disabled={actions.pending !== null}
            onClick={() => void actions.signOut('openai-codex')}
          >
            <Trans>Sign out</Trans>
          </Button>
        ) : (
          <Button
            variant="primary"
            icon={VERB_ICONS.signIn}
            loading={busy}
            disabled={actions.pending !== null && !busy}
            onClick={() => void actions.signIn('openai-codex')}
          >
            {i18n._(CONTINUE)}
          </Button>
        )
      }
    />
  );
}

/** Continue with ChatGPT (P1-F3): the default sign-in. Tokens stay in main; the page only learns "signed in". */
export function ChatGptSignIn({ state, actions }: { state: AccountsState; actions: SignInActions }) {
  return (
    <PageSection
      icon={SETTINGS_ICONS.subscriptions}
      title={<Trans>ChatGPT</Trans>}
      description={
        <Trans>
          Use the models in your ChatGPT plan. You sign in on chatgpt.com in your browser; Taalcut never sees
          your password.
        </Trans>
      }
    >
      <SettingRows>
        <ChatGptRow state={state} actions={actions} />
        <ChatGptImagesRow state={state} actions={actions} />
      </SettingRows>
    </PageSection>
  );
}

/** Claude, Copilot and Grok plans (P1-F6): each behind the warning card, never the default. */
export function SubscriptionSignIns({
  state,
  actions,
  onUseApiKey,
  openWarning,
}: {
  state: AccountsState;
  actions: SignInActions;
  onUseApiKey: (provider: WarnedLogin) => void;
  /** A warning's feature: open that plan's warning card (settings.openSignInWarning). */
  openWarning?: string | undefined;
}) {
  return (
    <PageSection
      icon={SETTINGS_ICONS.subscriptions}
      title={<Trans>Other subscriptions</Trans>}
      description={
        <Trans>
          Use a Claude, GitHub Copilot or Grok plan. Review how each connection uses your account before signing in.
        </Trans>
      }
    >
      <SettingRows>
        {state.subscriptions.map((sub) => (
          <SubscriptionRow
            inList
            key={sub.provider}
            subscription={sub}
            actions={actions}
            onUseApiKey={onUseApiKey}
            warningRequested={openWarning === sub.warning.feature}
          />
        ))}
      </SettingRows>
    </PageSection>
  );
}

export type Subscription = AccountsState['subscriptions'][number];

/**
 * One plan. The first sign-in shows the warning card; once this terms version
 * is acknowledged, signing in again goes straight to the browser, sending the
 * first acknowledgement's time.
 */
export function SubscriptionRow({
  subscription: sub,
  actions,
  onUseApiKey,
  warningRequested,
  inList = false,
}: {
  subscription: Subscription;
  actions: SignInActions;
  onUseApiKey: (provider: WarnedLogin) => void;
  warningRequested: boolean;
  /** A row of a SettingRows list (Settings); otherwise a frame of its own (first run's list). */
  inList?: boolean;
}) {
  const { i18n } = useLingui();
  const store = useServices().acknowledgements;
  const ack = useAcknowledgement(store, sub.warning.feature, sub.warning.termsVersion);
  const [warningOpen, setWarningOpen] = useState(false);
  const panel = useId();
  const row = useRef<HTMLLIElement>(null);
  // Asked for from outside (an error's "Review the warning" fix): open it and bring it into view.
  useEffect(() => {
    if (!warningRequested || sub.signedIn) return;
    setWarningOpen(true);
    row.current?.scrollIntoView?.({ block: 'center' });
  }, [warningRequested, sub.signedIn]);
  const service = i18n._(SUBSCRIPTION_NAMES[sub.provider] ?? msg`this service`);
  const busy = actions.pending === sub.provider;
  const signIn = async () => {
    // record() keeps the first acknowledgement, so this is the time the user said "I understand".
    const acknowledgement = await ack.acknowledge();
    await actions.signIn(sub.provider, acknowledgement.acknowledgedAt);
  };
  const open = warningOpen && !sub.signedIn;
  let control: ReactNode;
  if (sub.signedIn)
    control = (
      <Button
        variant="ghost"
        size="sm"
        icon={VERB_ICONS.signOut}
        disabled={actions.pending !== null}
        onClick={() => void actions.signOut(sub.provider)}
      >
        <Trans>Sign out of {service}</Trans>
      </Button>
    );
  else
    control = (
      <Button
        size="sm"
        variant="secondary"
        icon={VERB_ICONS.signIn}
        data-provider={sub.provider}
        loading={busy}
        disabled={actions.pending !== null && !busy}
        aria-expanded={ack.status === 'acknowledged' ? undefined : open}
        aria-controls={ack.status === 'acknowledged' ? undefined : panel}
        onClick={() => (ack.status === 'acknowledged' ? void signIn() : setWarningOpen(true))}
      >
        <Trans>Sign in to {service}</Trans>
      </Button>
    );
  return (
    <li
      ref={row}
      data-slot="subscription-row"
      className={cn(
        'flex flex-col',
        inList
          ? 'border-t border-rule-subtle first:border-t-0'
          : 'overflow-hidden rounded-lg border border-rule-subtle bg-raised',
      )}
    >
      <SettingRow
        as="div"
        icon={<ProviderMark provider={sub.provider} />}
        title={service}
        status={
          sub.signedIn ? (
            <Chip tone="success">
              <Trans>Signed in</Trans>
            </Chip>
          ) : null
        }
        control={control}
        className="border-t-0"
      />
      <Collapse id={panel} open={open}>
        <div className="px-3 pt-1 pb-3">
          {open ? (
            <RiskWarning
              provider={sub.provider}
              warning={sub.warning}
              service={service}
              store={store}
              onAcknowledged={() => {
                setWarningOpen(false);
                void signIn();
              }}
              onSaferChoice={() => {
                setWarningOpen(false);
                onUseApiKey(sub.provider);
              }}
              onCancel={() => setWarningOpen(false)}
            />
          ) : null}
        </div>
      </Collapse>
    </li>
  );
}
