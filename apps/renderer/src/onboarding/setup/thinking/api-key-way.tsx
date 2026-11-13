// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: onboarding, use an API key · genre: atmospheric studio app · system: DESIGN.md v0.3
 * the provider (the five most used, then More…), a password field, Test and save: the key travels to main once,
 *   into the keychain, and never comes back; the field empties after. Where to get a key opens in the browser.
 * states: default · hover/focus/active (fields, Button) · disabled (offline: the line says why; Test and save
 *   until a key is typed) · loading (Test and save spins through save and test) · error (the field marked, the
 *   cause and its fix under it, aria-describedby) · success ("Key works · OpenAI", announced)
 */
import { Trans, useLingui } from '@lingui/react/macro';
import { callRpc, type AccountsState } from '@taalcut/core';
import { Button, Input, ProviderLogo, Select } from '@taalcut/ui';
import { CircleCheck } from 'lucide-react';
import { useId, useState, type FormEvent } from 'react';
import { useBackend } from '../../../backend/backend';
import { describeError, describeErrorCode } from '../../../features/settings/model-messages';
import { providerName } from '../../../features/settings/providers';
import { BrowserLink } from '../../../chat/external-link';

/** The providers most people have a key for, first; the rest under More. */
const FIRST = ['openai', 'anthropic', 'google', 'xai', 'openrouter'] as const;

/** Where each provider hands out keys (opened in the browser). */
const KEY_PAGES: Readonly<Record<string, string>> = {
  openai: 'https://platform.openai.com/api-keys',
  anthropic: 'https://console.anthropic.com/settings/keys',
  google: 'https://aistudio.google.com/apikey',
  xai: 'https://console.x.ai',
  openrouter: 'https://openrouter.ai/keys',
};

/** Test and save: the key goes to main's keychain once, then its test; the page keeps neither. */
function useKeyTest(provider: string, onWorks: () => void) {
  const { i18n } = useLingui();
  const backend = useBackend();
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!key.trim()) return;
    setBusy(true);
    setProblem(null);
    const saved = await callRpc(backend.accounts.setApiKey({ provider, key: key.trim() }));
    // The key has gone to main's keychain; the page doesn't keep it.
    setKey('');
    if (!saved.ok) {
      setBusy(false);
      setProblem(describeError(i18n, saved.error));
      return;
    }
    const tested = await callRpc(backend.accounts.testApiKey({ provider }));
    setBusy(false);
    if (!tested.ok) setProblem(describeError(i18n, tested.error));
    else if (!tested.value.ok) setProblem(describeErrorCode(i18n, tested.value.errorCode));
    else onWorks();
  };
  return { key, setKey, busy, problem, setProblem, submit };
}

/** The provider: the five most used first, the rest under More. */
function ProviderSelect({
  id,
  provider,
  providers,
  disabled,
  onChange,
}: {
  id: string;
  provider: string;
  providers: readonly string[];
  disabled: boolean;
  onChange: (provider: string) => void;
}) {
  const { t, i18n } = useLingui();
  const name = (each: string) => providerName(i18n, each) ?? each;
  const more = providers.filter((p) => !(FIRST as readonly string[]).includes(p));
  return (
    <Select
      id={id}
      value={provider}
      disabled={disabled}
      leading={<ProviderLogo provider={provider} size="sm" />}
      onChange={(event) => onChange(event.target.value)}
    >
      {FIRST.filter((p) => providers.includes(p)).map((p) => (
        <option key={p} value={p}>
          {name(p)}
        </option>
      ))}
      {more.length > 0 ? (
        <optgroup label={t`More…`}>
          {more.map((p) => (
            <option key={p} value={p}>
              {name(p)}
            </option>
          ))}
        </optgroup>
      ) : null}
    </Select>
  );
}

/** Where to get a key, in the browser. */
function KeyPageLink({ page, providerLabel }: { page: string; providerLabel: string }) {
  return (
    <BrowserLink href={page}>
      <Trans>Get a key from {providerLabel}</Trans>
    </BrowserLink>
  );
}

/** Under the fields: the problem and its fix, or "Key works · OpenAI". */
function KeyMessage({
  id,
  problem,
  works,
  providerLabel,
}: {
  id: string;
  problem: string | null;
  works: boolean;
  providerLabel: string;
}) {
  const { t } = useLingui();
  return (
    <p id={id} role={problem ? 'alert' : 'status'} className="m-0 min-h-[1lh] text-sm">
      {problem ? (
        <span className="text-danger-strong">{problem}</span>
      ) : works ? (
        <span className="flex items-center gap-1.5 font-medium text-ink">
          <CircleCheck aria-hidden className="size-4 text-success-strong" />
          {t({ id: 'onboarding.thinking.apiKey.works', message: 'Key works' })} · {providerLabel}
        </span>
      ) : null}
    </p>
  );
}

export function ApiKeyWay({
  state,
  online,
  initialProvider,
  onWorks,
}: {
  state: AccountsState;
  online: boolean;
  /** Set when the warning card's safer choice led here. */
  initialProvider?: string | null | undefined;
  onWorks: () => void;
}) {
  const { t, i18n } = useLingui();
  const ids = { provider: useId(), key: useId(), message: useId() };
  const providers = state.apiKeys.map((row) => row.provider);
  const [provider, setProvider] = useState<string>(
    initialProvider && providers.includes(initialProvider) ? initialProvider : 'openai',
  );
  const { key, setKey, busy, problem, setProblem, submit } = useKeyTest(provider, onWorks);
  const row = state.apiKeys.find((each) => each.provider === provider);
  const works = !!row?.configured && row.lastCheck?.ok === true;
  const page = KEY_PAGES[provider];
  const providerLabel = providerName(i18n, provider) ?? provider;
  return (
    <form onSubmit={(event) => void submit(event)} className="flex max-w-xl flex-col gap-3">
      {online ? null : (
        <p className="m-0 text-sm text-ink-2">
          {t({ id: 'onboarding.thinking.offline', message: 'Connect to the internet to sign in.' })}
        </p>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,13rem)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-1.5">
          <label htmlFor={ids.provider} className="text-sm font-medium text-ink">
            <Trans>Provider</Trans>
          </label>
          <ProviderSelect
            id={ids.provider}
            provider={provider}
            providers={providers}
            disabled={busy}
            onChange={(next) => {
              setProvider(next);
              setProblem(null);
            }}
          />
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <label htmlFor={ids.key} className="text-sm font-medium text-ink">
            <Trans>API key</Trans>
          </label>
          <Input
            id={ids.key}
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={key}
            disabled={busy || !online}
            status={problem ? 'error' : works ? 'success' : undefined}
            aria-describedby={ids.message}
            onChange={(event) => setKey(event.target.value)}
          />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Button
          type="submit"
          variant="secondary"
          data-action="test-key"
          loading={busy}
          disabled={!online || !key.trim()}
        >
          {t({ id: 'onboarding.thinking.apiKey.test', message: 'Test and save' })}
        </Button>
        {page ? <KeyPageLink page={page} providerLabel={providerLabel} /> : null}
      </div>
      <KeyMessage id={ids.message} problem={problem} works={works} providerLabel={providerLabel} />
    </form>
  );
}
