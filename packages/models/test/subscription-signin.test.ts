// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P1-F6 done when: Claude, GitHub Copilot and Grok sign-ins run pi-ai's flows
 * only after the user acknowledged the current version of the feature's
 * warning card; without it they refuse with a typed error whose fix opens the
 * card. Runs offline: the real flows are started but never reach a provider.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  createMemoryAcknowledgementStore,
  disableNetwork,
  MODELS_MESSAGES_EN,
  OPEN_WARNING_CARD_COMMAND,
  signInOption,
  type NetworkGuard,
} from '@taalcut/models';
import { createAccountsHarness, type AccountsHarness } from './support/accounts';

let h: AccountsHarness | undefined;
let guard: NetworkGuard | undefined;
afterEach(async () => {
  guard?.restore();
  guard = undefined;
  await h?.close();
  h = undefined;
});

const GATED = [
  ['anthropic', 'signin.claude'],
  ['github-copilot', 'signin.copilot'],
  ['xai', 'signin.grok'],
] as const;

describe('warning-gated subscription sign-ins (P1-F6)', () => {
  it.each(GATED)(
    '%s refuses without an acknowledgement store, pointing at the warning card',
    async (provider, feature) => {
      const opened: string[] = [];
      h = await createAccountsHarness({ openExternal: (url) => void opened.push(url) });
      const result = await h.broker.signIn(provider);
      const termsVersion = signInOption(provider)!.warning!.termsVersion;
      expect(result).toEqual({
        ok: false,
        error: {
          code: 'models.acknowledgement_required',
          messageKey: 'errors.models.acknowledgement_required',
          retryable: false,
          params: { provider, feature, termsVersion },
          fix: {
            command: OPEN_WARNING_CARD_COMMAND,
            labelKey: 'fix.reviewSignInWarning',
            payload: { feature, termsVersion },
          },
        },
      });
      expect(opened).toEqual([]);
    },
  );

  it('only the current terms version counts', async () => {
    const acknowledgements = createMemoryAcknowledgementStore();
    await acknowledgements.record('signin.claude', '2020-01-01', Date.now());
    h = await createAccountsHarness({ acknowledgements });
    expect(await h.broker.signIn('anthropic')).toMatchObject({
      ok: false,
      error: { code: 'models.acknowledgement_required' },
    });
  });

  it('after acknowledgement, starts the Claude browser sign-in (no network needed to get that far)', async () => {
    const acknowledgements = createMemoryAcknowledgementStore();
    const opened: string[] = [];
    h = await createAccountsHarness({ acknowledgements, openExternal: (url) => void opened.push(url) });
    const card = signInOption('anthropic')!.warning!;
    expect(await h.broker.acknowledge(card.feature, card.termsVersion)).toEqual({
      ok: true,
      value: undefined,
    });
    expect(acknowledgements.records).toEqual([
      { feature: 'signin.claude', termsVersion: card.termsVersion, at: expect.any(Number) },
    ]);

    guard = disableNetwork();
    const signingIn = h.broker.signIn('anthropic');
    while (opened.length === 0) await new Promise((r) => setTimeout(r, 5));
    const url = new URL(opened[0]!);
    expect(`${url.origin}${url.pathname}`).toBe('https://claude.ai/oauth/authorize');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('scope')).toContain('user:sessions:claude_code');
    h.broker.cancelSignIn('anthropic');
    expect(await signingIn).toMatchObject({ ok: false, error: { code: 'core.cancelled' } });
    // Only the callback server's own loopback lookup was touched; nothing went off the machine.
    expect(guard.blocked.filter((b) => !b.includes('127.0.0.1'))).toEqual([]);
  });

  it.each([
    ['github-copilot', 'signin.copilot'],
    ['xai', 'signin.grok'],
  ] as const)('after acknowledgement, %s goes on to its device-code flow', async (provider, feature) => {
    const acknowledgements = createMemoryAcknowledgementStore();
    h = await createAccountsHarness({ acknowledgements });
    await h.broker.acknowledge(feature, signInOption(provider)!.warning!.termsVersion);
    guard = disableNetwork();
    // Offline, the device-code request is the first thing that fails: the gate let it through.
    const result = await h.broker.signIn(provider);
    expect(result).toMatchObject({ ok: false, error: { code: 'models.sign_in_failed' } });
    expect(guard.blocked.length).toBeGreaterThan(0);
  });

  it('has warning-card copy that says plainly the Claude sign-in poses as Claude Code', () => {
    for (const [provider] of GATED) {
      const card = signInOption(provider)!.warning!;
      for (const key of [card.titleKey, card.bodyKey, card.riskKey, card.acceptKey])
        expect(MODELS_MESSAGES_EN[key]).toBeTruthy();
    }
    const claude = MODELS_MESSAGES_EN['models.warning.claude.body']!;
    expect(claude).toContain('presents itself to Anthropic as Claude Code');
    expect(MODELS_MESSAGES_EN['models.warning.copilot.body']).toContain('VS Code');
    expect(signInOption('openai')!.warning).toBeUndefined();
  });

  it('lists every sign-in option in statuses, none connected', async () => {
    h = await createAccountsHarness();
    const statuses = await h.broker.statuses();
    expect(statuses.ok && statuses.value.map((s) => [s.provider, s.signedIn])).toEqual([
      ['openai', false],
      ['openai-codex-images', false],
      ['anthropic', false],
      ['github-copilot', false],
      ['xai', false],
    ]);
  });
});
