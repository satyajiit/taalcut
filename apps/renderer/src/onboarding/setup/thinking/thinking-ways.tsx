// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: onboarding, the four ways to think as rows · genre: atmospheric studio app
 * system: DESIGN.md v0.3 · each way's row (name, one line, its icon; ChatGPT carries "Recommended") and its
 *   panel; a way that works says what it is now on its row. Offline, the cloud ways say why instead of their line.
 * states: see thinking-setup.tsx (the rows are WayList's: default · hover · focus · active · open · done ·
 *   unavailable)
 */
import type { MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react/macro';
import type { AccountsState, OnboardingBranch, PrivacyOverview, WarnedLogin } from '@taalcut/core';
import { ProviderLogo, useHostPlatform } from '@taalcut/ui';
import { KeyRound, Layers } from 'lucide-react';
import type { ReactNode } from 'react';
import { USING_PLAN } from '../../../features/settings/accounts/sign-ins';
import { providerName, SUBSCRIPTION_NAMES } from '../../../features/settings/providers';
import type { Way } from '../way-list';
import { ApiKeyWay } from './api-key-way';
import { ChatGptWay } from './chatgpt-way';
import { LocalOnlyWay } from './local-only-way';
import { SubscriptionWay } from './subscription-way';
import type { ThinkingWorks } from './thinking-state';

export type ThinkingWay = NonNullable<OnboardingBranch['thinking']>;

/** What the rows need from the step. */
export interface WaysInput {
  readonly accounts: AccountsState;
  readonly privacy: PrivacyOverview;
  readonly works: ThinkingWorks;
  readonly online: boolean;
  /** The key the warning card's safer choice asked for, if it did. */
  readonly saferKey: string | null;
  /** A cloud way works: what to announce. */
  cloudReady(done: string): void;
  announce(line: string): void;
  /** The warning card's safer choice: an API key for this plan's provider. */
  saferKeyFor(provider: WarnedLogin): void;
}

interface RowWords {
  readonly title: MessageDescriptor;
  readonly line: MessageDescriptor;
  readonly icon: ReactNode;
  readonly chip?: MessageDescriptor;
}

/** The four ways of PRD 9.1, in order: their words and icons. */
/** The words that name the Mac, off a Mac (UX3): the same rows, for "this computer". */
const COMPUTER_WORDS: Partial<Record<ThinkingWay, Partial<RowWords>>> = {
  'api-key': {
    line: msg({
      id: 'onboarding.thinking.apiKey.body.computer',
      message: 'Pay the provider for what you use. The key stays in this computer’s keyring.',
    }),
  },
  'local-only': {
    title: msg({
      id: 'onboarding.thinking.local.title.computer',
      message: 'Keep everything on this computer',
    }),
    line: msg({
      id: 'onboarding.thinking.local.body.computer',
      message: 'Nothing leaves this computer. Some results are simpler.',
    }),
  },
};

const ROWS: ReadonlyArray<readonly [ThinkingWay, RowWords]> = [
  [
    'chatgpt',
    {
      title: msg({ id: 'onboarding.thinking.chatgpt.title', message: 'Continue with ChatGPT' }),
      line: msg({
        id: 'onboarding.thinking.chatgpt.body',
        message: 'Use your ChatGPT plan. No API key needed.',
      }),
      chip: msg({ id: 'onboarding.thinking.recommended', message: 'Recommended' }),
      icon: <ProviderLogo provider="openai-codex" size="sm" framed={false} />,
    },
  ],
  [
    'subscription',
    {
      title: msg({ id: 'onboarding.thinking.subscription.title', message: 'Use another subscription' }),
      line: msg({
        id: 'onboarding.thinking.subscription.body',
        message: 'Claude, Copilot or Grok. Read the warning first.',
      }),
      icon: <Layers />,
    },
  ],
  [
    'api-key',
    {
      title: msg({ id: 'onboarding.thinking.apiKey.title', message: 'Use an API key' }),
      line: msg({
        id: 'onboarding.thinking.apiKey.body',
        message: 'Pay the provider for what you use. The key stays in your Mac’s keychain.',
      }),
      icon: <KeyRound />,
    },
  ],
  [
    'local-only',
    {
      title: msg({ id: 'onboarding.thinking.local.title', message: 'Keep everything on this Mac' }),
      line: msg({
        id: 'onboarding.thinking.local.body',
        message: 'Nothing leaves this Mac. Some results are simpler.',
      }),
      icon: <ProviderLogo provider="local" size="sm" framed={false} />,
    },
  ],
];

type WayParts = Pick<Way<ThinkingWay>, 'done' | 'panel'>;

/** What each way adds to its words: what it is now when it already works, and its panel. */
function useWayParts(input: WaysInput): Record<ThinkingWay, WayParts> {
  const { t, i18n } = useLingui();
  const mac = useHostPlatform() === 'mac';
  const { accounts, privacy, works, online, cloudReady } = input;
  const plan = works.subscription ? SUBSCRIPTION_NAMES[works.subscription] : undefined;
  const signedInPlan = plan ? i18n._(plan) : works.subscription;
  const keyName = works.apiKey ? (providerName(i18n, works.apiKey) ?? works.apiKey) : null;
  return {
    chatgpt: {
      ...(works.chatgpt ? { done: i18n._(USING_PLAN) } : {}),
      panel: (
        <ChatGptWay
          state={accounts}
          online={online}
          onSignedIn={() => cloudReady(t`Signed in. Taalcut now uses your ChatGPT plan.`)}
        />
      ),
    },
    subscription: {
      ...(signedInPlan ? { done: t`Signed in to ${signedInPlan}` } : {}),
      panel: (
        <SubscriptionWay
          state={accounts}
          online={online}
          onSignedIn={() => cloudReady(t`Signed in.`)}
          onUseApiKey={input.saferKeyFor}
        />
      ),
    },
    'api-key': {
      ...(keyName ? { done: t`Key works · ${keyName}` } : {}),
      panel: (
        <ApiKeyWay
          state={accounts}
          online={online}
          initialProvider={input.saferKey}
          onWorks={() => cloudReady(t`Key works. Taalcut can use it now.`)}
        />
      ),
    },
    'local-only': {
      ...(privacy.localOnly ? { done: t`Local only is on` } : {}),
      panel: (
        <LocalOnlyWay
          privacy={privacy}
          onOn={() =>
            input.announce(
              mac
                ? t`Local only is on. Nothing leaves this Mac.`
                : t`Local only is on. Nothing leaves this computer.`,
            )
          }
        />
      ),
    },
  };
}

/** The four ways as rows. Offline: the cloud ways say why on their rows; Local only stays. */
export function useThinkingWays(input: WaysInput): Way<ThinkingWay>[] {
  const { t, i18n } = useLingui();
  const mac = useHostPlatform() === 'mac';
  const parts = useWayParts(input);
  const offline = input.online
    ? undefined
    : t({ id: 'onboarding.thinking.offline', message: 'Connect to the internet to sign in.' });
  return ROWS.map(([id, rowWords]) => {
    const words = mac ? rowWords : { ...rowWords, ...COMPUTER_WORDS[id] };
    const way: Way<ThinkingWay> = {
      id,
      title: i18n._(words.title),
      line: i18n._(words.line),
      icon: words.icon,
      ...(words.chip ? { chip: i18n._(words.chip) } : {}),
      ...parts[id],
    };
    return offline && id !== 'local-only' && !way.done ? { ...way, unavailable: offline } : way;
  });
}
