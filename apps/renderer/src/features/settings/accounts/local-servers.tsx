// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: local-servers (UX4) · genre: atmospheric studio app (chrome modern-minimal) · system:
 *   DESIGN.md v0.6 + UX4 (_orch/ux4/specs/design-set.md "One row")
 * Accounts › Servers: optional, so it is a view of its own rather than a disclosure on the page everyone sees. One
 *   SettingRow per server (its mark, its name, In use when Taalcut uses it), its address form under it: the field
 *   and its buttons on one line, the hint under them; a refused address explains itself in the hint.
 * states: default · hover/focus/active (the buttons') · disabled (Use this server until the address changes) ·
 *   loading (Check connection spins) · error (the field's red edge and its cause; a failed check as a danger
 *   notice) · success (Connected, with how many models answered)
 */
import { Plural, Trans, useLingui } from '@lingui/react/macro';
import type { AccountsState, LocalServerKind } from '@taalcut/core';
import { Button, Chip, Input, PageSection, useHostPlatform, VERB_ICONS } from '@taalcut/ui';
import { useEffect, useId, useState, type FormEvent } from 'react';
import { Notice } from '../fields';
import { describeErrorCode } from '../model-messages';
import { providerName } from '../providers';
import { SettingRow, SettingRows } from '../rows';
import { SETTINGS_ICONS } from '../settings-icons';
import { ProviderMark } from './sign-ins';

type Server = AccountsState['localServers'][number];

/** Where each server usually listens; shown as a hint, never saved for the user. */
const USUAL_ADDRESS: Record<LocalServerKind, string> = {
  ollama: 'http://localhost:11434',
  'lm-studio': 'http://localhost:1234',
};

export interface LocalServerActions {
  /** baseUrl null stops using the server. Resolves to a translated error sentence, or null. */
  save(kind: LocalServerKind, baseUrl: string | null): Promise<string | null>;
  test(kind: LocalServerKind): Promise<void>;
  pending: string | null;
}

function ServerRow({ server, actions }: { server: Server; actions: LocalServerActions }) {
  const { i18n } = useLingui();
  const id = useId();
  const [url, setUrl] = useState(server.baseUrl ?? '');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setUrl(server.baseUrl ?? ''), [server.baseUrl]);
  const name = providerName(i18n, server.kind) ?? server.kind;
  const busy = actions.pending === server.kind;
  const check = server.lastCheck;
  const models = check?.models ?? 0;
  const usual = USUAL_ADDRESS[server.kind];

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(await actions.save(server.kind, url.trim()));
  }

  return (
    <li data-provider={server.kind} className="flex flex-col border-t border-rule-subtle first:border-t-0">
      <SettingRow
        as="div"
        className="border-t-0"
        icon={<ProviderMark provider={server.kind} />}
        title={name}
        status={
          server.baseUrl ? (
            <Chip tone="neutral">
              <Trans>In use</Trans>
            </Chip>
          ) : null
        }
      />
      <div className="flex flex-col gap-3 px-3 pb-3 ps-14">
        <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-url`} className="type-label text-ink">
            <Trans>{name} address</Trans>
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              id={`${id}-url`}
              type="url"
              required
              inputMode="url"
              spellCheck={false}
              value={url}
              placeholder={usual}
              status={error ? 'error' : undefined}
              aria-describedby={`${id}-hint`}
              onChange={(event) => {
                setUrl(event.target.value);
                setError(null);
              }}
              translate="no"
              className="min-w-0 flex-[1_1_16rem]"
            />
            <Button type="submit" disabled={busy || url.trim() === '' || url.trim() === server.baseUrl}>
              <Trans>Use this server</Trans>
            </Button>
            {server.baseUrl ? (
              <>
                <Button
                  loading={busy}
                  icon={VERB_ICONS.checkAgain}
                  onClick={() => void actions.test(server.kind)}
                >
                  <Trans>Check connection</Trans>
                </Button>
                <Button variant="ghost" disabled={busy} onClick={() => void actions.save(server.kind, null)}>
                  <Trans>Stop using {name}</Trans>
                </Button>
              </>
            ) : null}
          </div>
          <p
            id={`${id}-hint`}
            className={error ? 'm-0 type-meta text-danger-strong' : 'm-0 type-meta text-ink-2'}
          >
            {error ?? (
              <Trans>
                Usually <span translate="no">{usual}</span>
              </Trans>
            )}
          </p>
        </form>
        {check && server.baseUrl ? (
          <Notice tone={check.ok ? 'success' : 'danger'} role="status">
            {check.ok ? (
              <Plural
                value={models}
                one="Connected. # model is ready."
                other="Connected. # models are ready."
              />
            ) : (
              describeErrorCode(i18n, check.errorCode)
            )}
          </Notice>
        ) : null}
      </div>
    </li>
  );
}

/**
 * Optional: a model server the person already runs (Ollama, LM Studio). Taalcut runs its own models with nothing
 * to install, so this is a view of its own that most people never open (AGENTS.md, "Nothing for the user to
 * install").
 */
export function LocalServers({ state, actions }: { state: AccountsState; actions: LocalServerActions }) {
  const mac = useHostPlatform() === 'mac';
  return (
    <PageSection
      icon={SETTINGS_ICONS.servers}
      title={<Trans>Advanced: bring your own server</Trans>}
      description={
        mac ? (
          <Trans>
            Optional. Taalcut already runs models on this Mac, with nothing to install. If you run Ollama or
            LM Studio yourself, Taalcut can use its models too.
          </Trans>
        ) : (
          <Trans>
            Optional. Taalcut already runs models on this computer, with nothing to install. If you run Ollama
            or LM Studio yourself, Taalcut can use its models too.
          </Trans>
        )
      }
    >
      <SettingRows>
        {state.localServers.map((server) => (
          <ServerRow key={server.kind} server={server} actions={actions} />
        ))}
      </SettingRows>
    </PageSection>
  );
}
