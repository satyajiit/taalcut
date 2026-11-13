// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A fake of main's accounts service. Like the real one, it never keeps or
 * returns a key: setApiKey records only that a key exists and whether the
 * fake provider would accept it (keys containing "bad" fail the test).
 */
import {
  type TaalcutError,
  CHATGPT_PROVIDER,
  CHATGPT_IMAGE_PROVIDER,
  INSTAGRAM_PROVIDER,
  INSTAGRAM_WARNING,
  WARNED_LOGINS,
  type AccountsState,
  type LocalServerKind,
  type SignInWarning,
  type WarnedLogin,
} from '@taalcut/core';
import { watched, type Watched } from './watch';

export const API_KEY_PROVIDERS = [
  'openai',
  'anthropic',
  'google',
  'openrouter',
  'xai',
  'elevenlabs',
  'cloudflare-workers-ai',
] as const;

type Check = { at: number; ok: boolean; errorCode?: string };

const hasCredentials = (url: string) => {
  try {
    const parsed = new URL(url);
    return parsed.username !== '' || parsed.password !== '';
  } catch {
    return false;
  }
};

/** As models' SIGN_IN_OPTIONS declares them (packages/models/src/signin/options.ts). */
const card = (name: string): SignInWarning => ({
  feature: `signin.${name}`,
  termsVersion: '2026-10-12',
  titleKey: `models.warning.${name}.title`,
  bodyKey: `models.warning.${name}.body`,
  riskKey: `models.warning.${name}.risk`,
});
/** Round P3-3: the service's own usage page for a plan, as main's fixed table has it (none for xAI's). */
const USAGE_PAGES: Partial<Record<WarnedLogin, string>> = {
  anthropic: 'https://claude.ai/settings/usage',
  'github-copilot': 'https://github.com/settings/copilot',
};

const WARNINGS: Record<WarnedLogin, SignInWarning> = {
  anthropic: card('claude'),
  'github-copilot': card('copilot'),
  xai: card('grok'),
};

export interface FakeAccounts {
  readonly watch: Watched<AccountsState>;
  signIn(provider: string, acknowledgedAt?: number): Promise<AccountsState | TaalcutError>;
  signOut(provider: string): AccountsState;
  setApiKey(provider: string, key: string): AccountsState | TaalcutError;
  testApiKey(provider: string): Check | TaalcutError;
  removeApiKey(provider: string): AccountsState;
  /** Providers with a key or sign-in, as main's credentials.configured() answers (the ChatGPT plan serves OpenAI). */
  configured(): ReadonlySet<string>;
  setLocalServer(kind: LocalServerKind, baseUrl: string | null): AccountsState | TaalcutError;
  testLocalServer(kind: LocalServerKind): (Check & { models?: number }) | TaalcutError;
}

const error = (code: string, params?: Record<string, string>): TaalcutError => ({
  code,
  messageKey: `errors.${code}`,
  ...(params ? { params } : {}),
  retryable: false,
});

export function createFakeAccounts(deps: { now: () => number; signInDelayMs?: number }): FakeAccounts {
  const signedIn = new Set<string>();
  const acknowledged = new Map<WarnedLogin, number>();
  let instagramAcknowledgedAt: number | undefined;
  /** provider → would the stored key work. The key itself is dropped at once. */
  const keys = new Map<string, boolean>();
  const keyChecks = new Map<string, Check>();
  // Bring-your-own servers start unused: Taalcut's own runtime needs none.
  const servers: Record<LocalServerKind, { baseUrl?: string; lastCheck?: Check & { models?: number } }> = {
    ollama: {},
    'lm-studio': {},
  };

  const state = (): AccountsState => ({
    chatgpt: {
      signedIn: signedIn.has(CHATGPT_PROVIDER),
      imagesSignedIn: signedIn.has(CHATGPT_IMAGE_PROVIDER),
      manageUsageUrl: 'https://chatgpt.com/codex/settings/usage',
    },
    subscriptions: WARNED_LOGINS.map((provider) => ({
      provider,
      signedIn: signedIn.has(provider),
      warning: WARNINGS[provider],
      ...(acknowledged.has(provider) ? { acknowledgedAt: acknowledged.get(provider) } : {}),
      ...(USAGE_PAGES[provider] ? { usageUrl: USAGE_PAGES[provider] } : {}),
    })),
    instagram: {
      signedIn: signedIn.has(INSTAGRAM_PROVIDER),
      ...(signedIn.has(INSTAGRAM_PROVIDER) ? { username: 'creator.studio' } : {}),
      warning: INSTAGRAM_WARNING,
      ...(instagramAcknowledgedAt !== undefined ? { acknowledgedAt: instagramAcknowledgedAt } : {}),
    },
    apiKeys: API_KEY_PROVIDERS.map((provider) => ({
      provider,
      configured: keys.has(provider),
      ...(keyChecks.has(provider) ? { lastCheck: keyChecks.get(provider) } : {}),
    })),
    localServers: (Object.keys(servers) as LocalServerKind[]).map((kind) => ({
      kind,
      ...(servers[kind].baseUrl ? { baseUrl: servers[kind].baseUrl } : {}),
      ...(servers[kind].lastCheck ? { lastCheck: servers[kind].lastCheck } : {}),
    })),
    stockKeys: [],
  });
  const watch = watched(state);
  const changed = () => {
    watch.notify();
    return state();
  };
  const isWarned = (p: string): p is WarnedLogin => (WARNED_LOGINS as readonly string[]).includes(p);
  const isKeyProvider = (p: string) => (API_KEY_PROVIDERS as readonly string[]).includes(p);

  return {
    watch,
    async signIn(provider, acknowledgedAt) {
      if (isWarned(provider)) {
        if (acknowledgedAt === undefined) return error('models.acknowledgement_required', { provider });
        acknowledged.set(provider, acknowledgedAt);
      } else if (provider === INSTAGRAM_PROVIDER) {
        if (acknowledgedAt === undefined) return error('models.acknowledgement_required', { provider });
        instagramAcknowledgedAt = acknowledgedAt;
      }
      // The real flow waits for the browser to come back to the local callback.
      await new Promise((resolve) => setTimeout(resolve, deps.signInDelayMs ?? 250));
      signedIn.add(provider);
      return changed();
    },
    signOut(provider) {
      signedIn.delete(provider);
      return changed();
    },
    setApiKey(provider, key) {
      if (!isKeyProvider(provider)) return error('core.not_found', { entity: 'provider', id: provider });
      keys.set(provider, !key.includes('bad'));
      keyChecks.delete(provider);
      return changed();
    },
    testApiKey(provider) {
      const works = keys.get(provider);
      if (works === undefined) return error('models.not_configured', { provider });
      const check = { at: deps.now(), ok: works, ...(works ? {} : { errorCode: 'models.auth_invalid' }) };
      keyChecks.set(provider, check);
      watch.notify();
      return check;
    },
    removeApiKey(provider) {
      keys.delete(provider);
      keyChecks.delete(provider);
      return changed();
    },
    configured() {
      const ids = new Set<string>(keys.keys());
      for (const provider of signedIn) {
        ids.add(provider);
        if (provider === CHATGPT_PROVIDER) ids.add('openai');
      }
      return ids;
    },
    setLocalServer(kind, baseUrl) {
      // As models does: settings aren't a secret store, so no user name or password in the address.
      if (baseUrl && hasCredentials(baseUrl))
        return error('models.endpoint_has_credentials', { field: 'baseUrl' });
      servers[kind] = baseUrl ? { baseUrl } : {};
      return changed();
    },
    testLocalServer(kind) {
      if (!servers[kind].baseUrl) return error('models.not_configured', { provider: kind });
      // The fake Ollama answers with three models; LM Studio isn't running.
      const check =
        kind === 'ollama'
          ? { at: deps.now(), ok: true, models: 3 }
          : { at: deps.now(), ok: false, errorCode: 'models.provider_unavailable' };
      servers[kind] = { ...servers[kind], lastCheck: check };
      watch.notify();
      return check;
    },
  };
}
